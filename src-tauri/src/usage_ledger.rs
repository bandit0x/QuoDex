//! QuoDex 自有的去重请求账本。
//!
//! 设计约束来自 `.scratch/token-usage/spec.md` 统计合同：
//! - 按稳定请求标识去重，fork、复制日志、重复导入、重启不得重复增加；
//! - ZCode 同一请求记录更新时更新原账目，不作为新请求追加；
//! - 账目只保存来源原始时间戳（毫秒），每日归档在读取时按当前本机时区重算，
//!   时区变更后以原始请求时间重新归档，不凭旧日桶相加。

use std::collections::BTreeMap;
use std::path::Path;

use chrono::{DateTime, FixedOffset, TimeZone, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

pub const SOURCE_CODEX: &str = "codex";
pub const SOURCE_ZCODE: &str = "zcode";

#[derive(Debug, Clone)]
pub struct UsageEvent {
    pub source: &'static str,
    pub request_key: String,
    /// 来源记录的原始时间戳（毫秒）：Codex 为 receipt.timestamp，ZCode 为 started_at。
    pub source_ts_ms: i64,
    pub total_tokens: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_input_tokens: i64,
    pub reasoning_tokens: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CodexUpsert {
    Inserted,
    Unchanged,
    /// 同一稳定标识出现不同计数：保留已有账目，不加入冲突值。
    Conflict,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ZcodeUpsert {
    Inserted,
    /// 合法记录更新：替换旧值。
    Updated,
    Unchanged,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct SourceScanState {
    /// 上次扫描的文件清单：路径 -> (长度, mtime_ms)，用于增量解析。
    #[serde(default)]
    pub files: BTreeMap<String, SourceFileStamp>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceFileStamp {
    pub len: u64,
    pub mtime_ms: i64,
}

pub struct UsageLedger {
    conn: Connection,
}

impl UsageLedger {
    pub fn open(path: &Path) -> Result<Self, crate::capacity::Diagnostic> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                crate::capacity::Diagnostic::new(
                    "QDU-707",
                    "统计记录无法保存；请检查本机存储空间与数据目录写入权限后重试",
                )
                .with_detail(error.to_string())
            })?;
        }
        let conn = Connection::open(path).map_err(open_diagnostic)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS usage_events (
                source TEXT NOT NULL,
                request_key TEXT NOT NULL,
                source_ts_ms INTEGER NOT NULL,
                total_tokens INTEGER NOT NULL,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                cached_input_tokens INTEGER NOT NULL DEFAULT 0,
                reasoning_tokens INTEGER NOT NULL DEFAULT 0,
                updated_at_ms INTEGER NOT NULL,
                PRIMARY KEY (source, request_key)
            );
            CREATE TABLE IF NOT EXISTS usage_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .map_err(open_diagnostic)?;
        Ok(Self { conn })
    }

    pub fn upsert_codex(&mut self, event: &UsageEvent) -> Result<CodexUpsert, crate::capacity::Diagnostic> {
        debug_assert_eq!(event.source, SOURCE_CODEX);
        let existing: Option<i64> = self
            .conn
            .query_row(
                "SELECT total_tokens FROM usage_events WHERE source = ?1 AND request_key = ?2",
                [event.source, event.request_key.as_str()],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })
            .map_err(write_diagnostic)?;
        match existing {
            None => {
                self.insert(event)?;
                Ok(CodexUpsert::Inserted)
            }
            Some(total) if total == event.total_tokens => Ok(CodexUpsert::Unchanged),
            Some(_) => Ok(CodexUpsert::Conflict),
        }
    }

    pub fn upsert_zcode(&mut self, event: &UsageEvent) -> Result<ZcodeUpsert, crate::capacity::Diagnostic> {
        debug_assert_eq!(event.source, SOURCE_ZCODE);
        let existing: Option<i64> = self
            .conn
            .query_row(
                "SELECT total_tokens FROM usage_events WHERE source = ?1 AND request_key = ?2",
                [event.source, event.request_key.as_str()],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })
            .map_err(write_diagnostic)?;
        match existing {
            None => {
                self.insert(event)?;
                Ok(ZcodeUpsert::Inserted)
            }
            Some(total) if total == event.total_tokens => Ok(ZcodeUpsert::Unchanged),
            Some(_) => {
                self.conn
                    .execute(
                        "UPDATE usage_events SET source_ts_ms = ?3, total_tokens = ?4, input_tokens = ?5,
                         output_tokens = ?6, cached_input_tokens = ?7, reasoning_tokens = ?8, updated_at_ms = ?9
                         WHERE source = ?1 AND request_key = ?2",
                        rusqlite::params![
                            event.source,
                            event.request_key,
                            event.source_ts_ms,
                            event.total_tokens,
                            event.input_tokens,
                            event.output_tokens,
                            event.cached_input_tokens,
                            event.reasoning_tokens,
                            now_ms(),
                        ],
                    )
                    .map_err(write_diagnostic)?;
                Ok(ZcodeUpsert::Updated)
            }
        }
    }

    fn insert(&mut self, event: &UsageEvent) -> Result<(), crate::capacity::Diagnostic> {
        self.conn
            .execute(
                "INSERT INTO usage_events (source, request_key, source_ts_ms, total_tokens, input_tokens,
                 output_tokens, cached_input_tokens, reasoning_tokens, updated_at_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    event.source,
                    event.request_key,
                    event.source_ts_ms,
                    event.total_tokens,
                    event.input_tokens,
                    event.output_tokens,
                    event.cached_input_tokens,
                    event.reasoning_tokens,
                    now_ms(),
                ],
            )
            .map_err(write_diagnostic)?;
        Ok(())
    }

    /// 按当前本机时区把账目归档为每日总量。时区变化后重算，不读旧日桶。
    pub fn daily_totals(
        &self,
        source: &str,
        offset: FixedOffset,
    ) -> Result<BTreeMap<String, i64>, crate::capacity::Diagnostic> {
        let mut statement = self
            .conn
            .prepare("SELECT source_ts_ms, total_tokens FROM usage_events WHERE source = ?1")
            .map_err(read_diagnostic)?;
        let rows = statement
            .query_map([source], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
            .map_err(read_diagnostic)?;
        let mut daily: BTreeMap<String, i64> = BTreeMap::new();
        for row in rows {
            let (ts_ms, total) = row.map_err(read_diagnostic)?;
            *daily.entry(local_day(ts_ms, offset)).or_insert(0) += total;
        }
        Ok(daily)
    }

    /// 每日已记录请求数，用于首次导入进度展示（可读的客观计数）。
    pub fn request_count(&self, source: &str) -> Result<u64, crate::capacity::Diagnostic> {
        let count: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM usage_events WHERE source = ?1",
                [source],
                |row| row.get(0),
            )
            .map_err(read_diagnostic)?;
        Ok(count.max(0) as u64)
    }

    pub fn meta_get(&self, key: &str) -> Result<Option<String>, crate::capacity::Diagnostic> {
        let value = self
            .conn
            .query_row(
                "SELECT value FROM usage_meta WHERE key = ?1",
                [key],
                |row| row.get::<_, String>(0),
            )
            .map(Some)
            .or_else(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })
            .map_err(read_diagnostic)?;
        Ok(value)
    }

    pub fn meta_set(&mut self, key: &str, value: &str) -> Result<(), crate::capacity::Diagnostic> {
        self.conn
            .execute(
                "INSERT INTO usage_meta (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [key, value],
            )
            .map_err(write_diagnostic)?;
        Ok(())
    }
}

/// 毫秒时间戳 -> 本机时区日期（YYYY-MM-DD）。
pub fn local_day(ts_ms: i64, offset: FixedOffset) -> String {
    offset
        .timestamp_millis_opt(ts_ms)
        .single()
        .map(|moment: DateTime<FixedOffset>| moment.date_naive().format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| Utc.timestamp_millis_opt(ts_ms).single().map(|moment| moment.date_naive().format("%Y-%m-%d").to_string()).unwrap_or_default())
}

pub fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn open_diagnostic(error: rusqlite::Error) -> crate::capacity::Diagnostic {
    crate::capacity::Diagnostic::new(
        "QDU-707",
        "统计记录无法保存；请检查本机存储空间与数据目录写入权限后重试",
    )
    .with_detail(error.to_string())
}

fn write_diagnostic(error: rusqlite::Error) -> crate::capacity::Diagnostic {
    crate::capacity::Diagnostic::new(
        "QDU-707",
        "统计记录无法保存；请检查本机存储空间与数据目录写入权限后重试",
    )
    .with_detail(error.to_string())
}

fn read_diagnostic(error: rusqlite::Error) -> crate::capacity::Diagnostic {
    crate::capacity::Diagnostic::new(
        "QDU-707",
        "统计记录无法读取；请重启 QuoDex 后重试",
    )
    .with_detail(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ledger() -> UsageLedger {
        let unique = now_ms();
        let path = std::env::temp_dir().join(format!("quodex-ledger-test-{unique}.sqlite"));
        UsageLedger::open(&path).expect("open ledger")
    }

    fn codex_event(key: &str, ts_ms: i64, total: i64) -> UsageEvent {
        UsageEvent {
            source: SOURCE_CODEX,
            request_key: format!("codex:thread:{key}"),
            source_ts_ms: ts_ms,
            total_tokens: total,
            input_tokens: total - 10,
            output_tokens: 10,
            cached_input_tokens: 0,
            reasoning_tokens: 0,
        }
    }

    fn zcode_event(id: &str, ts_ms: i64, total: i64) -> UsageEvent {
        UsageEvent {
            source: SOURCE_ZCODE,
            request_key: format!("zcode:db:{id}"),
            source_ts_ms: ts_ms,
            total_tokens: total,
            input_tokens: total - 5,
            output_tokens: 5,
            cached_input_tokens: 0,
            reasoning_tokens: 0,
        }
    }

    const OFFSET: FixedOffset = FixedOffset::east_opt(8 * 3600).unwrap();

    #[test]
    fn repeated_import_and_restart_do_not_double_count() {
        let mut ledger = ledger();
        let event = codex_event("resp_1", 1_791_000_000_000, 100);
        assert_eq!(ledger.upsert_codex(&event).unwrap(), CodexUpsert::Inserted);
        // 同一账本重复导入
        assert_eq!(ledger.upsert_codex(&event).unwrap(), CodexUpsert::Unchanged);
        // 重启后重新打开账本，再次导入同一条记录
        let path = std::env::temp_dir().join(format!("quodex-ledger-reopen-{}.sqlite", now_ms()));
        let mut reopened = UsageLedger::open(&path).unwrap();
        assert_eq!(reopened.upsert_codex(&event).unwrap(), CodexUpsert::Inserted);
        drop(reopened);
        let mut reopened = UsageLedger::open(&path).unwrap();
        assert_eq!(reopened.upsert_codex(&event).unwrap(), CodexUpsert::Unchanged);
        let daily = reopened.daily_totals(SOURCE_CODEX, OFFSET).unwrap();
        assert_eq!(daily.len(), 1);
        assert_eq!(*daily.values().next().unwrap(), 100);
    }

    #[test]
    fn codex_conflict_keeps_first_and_does_not_add() {
        let mut ledger = ledger();
        let first = codex_event("resp_2", 1_791_000_000_000, 100);
        assert_eq!(ledger.upsert_codex(&first).unwrap(), CodexUpsert::Inserted);
        let replay = codex_event("resp_2", first.source_ts_ms, 250);
        assert_eq!(ledger.upsert_codex(&replay).unwrap(), CodexUpsert::Conflict);
        let daily = ledger.daily_totals(SOURCE_CODEX, OFFSET).unwrap();
        assert_eq!(daily.values().sum::<i64>(), 100);
    }

    #[test]
    fn zcode_record_update_replaces_old_value() {
        let mut ledger = ledger();
        let first = zcode_event("req_1", 1_791_000_000_000, 100);
        assert_eq!(ledger.upsert_zcode(&first).unwrap(), ZcodeUpsert::Inserted);
        assert_eq!(ledger.upsert_zcode(&first).unwrap(), ZcodeUpsert::Unchanged);
        let updated = zcode_event("req_1", first.source_ts_ms, 180);
        assert_eq!(ledger.upsert_zcode(&updated).unwrap(), ZcodeUpsert::Updated);
        let daily = ledger.daily_totals(SOURCE_ZCODE, OFFSET).unwrap();
        assert_eq!(daily.values().sum::<i64>(), 180);
        assert_eq!(ledger.request_count(SOURCE_ZCODE).unwrap(), 1);
    }

    #[test]
    fn daily_totals_bucket_by_local_offset_not_utc() {
        let mut ledger = ledger();
        // 2026-10-07 01:30 +08:00 = 2026-10-06 17:30 UTC：本机时区已跨日，UTC 未跨日。
        let ts = 1_791_307_800_000i64;
        assert_eq!(local_day(ts, OFFSET), "2026-10-07", "local offset must decide the day");
        assert_eq!(local_day(ts, FixedOffset::east_opt(0).unwrap()), "2026-10-06");
        ledger.upsert_zcode(&zcode_event("tz_1", ts, 42)).unwrap();
        let daily = ledger.daily_totals(SOURCE_ZCODE, OFFSET).unwrap();
        assert_eq!(daily.get("2026-10-07"), Some(&42));
        let utc_daily = ledger.daily_totals(SOURCE_ZCODE, FixedOffset::east_opt(0).unwrap()).unwrap();
        assert_eq!(utc_daily.get("2026-10-06"), Some(&42), "UTC bucketing must differ");
        assert_eq!(utc_daily.get("2026-10-07"), None);
    }

    #[test]
    fn meta_roundtrip_and_request_count() {
        let mut ledger = ledger();
        assert_eq!(ledger.meta_get("missing").unwrap(), None);
        ledger.meta_set("codex.collection_start_day", "2026-10-06").unwrap();
        ledger.meta_set("codex.collection_start_day", "2026-10-05").unwrap();
        assert_eq!(
            ledger.meta_get("codex.collection_start_day").unwrap().as_deref(),
            Some("2026-10-05")
        );
        assert_eq!(ledger.request_count(SOURCE_CODEX).unwrap(), 0);
    }
}

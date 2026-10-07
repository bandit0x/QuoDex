//! 用量统计编排：来源读取 → 去重账本 → 快照（本机只读接口消费）。
//!
//! 规则来自 `.scratch/token-usage/spec.md`：
//! - 首次启动导入现存历史，之后周期性增量采集并补采关闭期间仍留存的数据；
//! - "最早留存记录"（earliestDay）与"持续采集起点"（collectionStartDay）分别说明；
//!   只有处于持续采集起点之后的日期才允许把无记录解释为真实零；
//! - 读取失败保留账本数据并标过期；来源互不影响。

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Mutex, RwLock};
use std::time::Duration;

use chrono::{Local, Offset, TimeZone};
use serde::Serialize;

use crate::capacity::Diagnostic;
use crate::usage_ledger::{
    CodexUpsert, SourceScanState, UsageEvent, UsageLedger, SOURCE_CODEX, SOURCE_ZCODE,
};
use crate::usage_sources::{
    codex_sessions_dir, scan_codex_sessions, scan_zcode_usage, zcode_db_identity, zcode_db_path,
};

const REFRESH_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub files_total: usize,
    pub files_done: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSourceSnapshot {
    /// backfill = 启动后补采中；ready = 本轮读取成功；failed = 本轮读取失败。
    pub state: &'static str,
    pub last_success_at_ms: Option<i64>,
    /// 最早一条已留存记录的日期：只能证明记录起点，不证明此前或其后完整。
    pub earliest_day: Option<String>,
    /// QuoDex 自己开始持续采集的日期：此后无记录的日子才是已确认零。
    pub collection_start_day: Option<String>,
    pub request_count: u64,
    pub daily: BTreeMap<String, i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<ImportProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<Diagnostic>,
}

impl UsageSourceSnapshot {
    fn empty(state: &'static str) -> Self {
        Self {
            state,
            last_success_at_ms: None,
            earliest_day: None,
            collection_start_day: None,
            request_count: 0,
            daily: BTreeMap::new(),
            progress: None,
            diagnostic: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub generated_at_ms: i64,
    pub codex: UsageSourceSnapshot,
    pub zcode: UsageSourceSnapshot,
}

struct ImportProgressFlags {
    importing_codex: AtomicBool,
    importing_zcode: AtomicBool,
    codex_files_total: AtomicUsize,
    codex_files_done: AtomicUsize,
}

pub struct UsageService {
    home: PathBuf,
    ledger_path: PathBuf,
    ledger: Mutex<Option<UsageLedger>>,
    /// Codex rollout 文件增量状态；持久化到账本 meta，重启后避免全量重扫。
    codex_scan_state: Mutex<SourceScanState>,
    snapshot: RwLock<UsageSnapshot>,
    open_diagnostic: Mutex<Option<Diagnostic>>,
    progress: ImportProgressFlags,
}

impl UsageService {
    pub fn new(home: PathBuf, ledger_path: PathBuf) -> Self {
        let service = Self {
            home,
            ledger_path,
            ledger: Mutex::new(None),
            codex_scan_state: Mutex::new(SourceScanState::default()),
            snapshot: RwLock::new(UsageSnapshot {
                generated_at_ms: crate::usage_ledger::now_ms(),
                codex: UsageSourceSnapshot::empty("backfill"),
                zcode: UsageSourceSnapshot::empty("backfill"),
            }),
            open_diagnostic: Mutex::new(None),
            progress: ImportProgressFlags {
                importing_codex: AtomicBool::new(true),
                importing_zcode: AtomicBool::new(true),
                codex_files_total: AtomicUsize::new(0),
                codex_files_done: AtomicUsize::new(0),
            },
        };
        service.rebuild_snapshot_from_ledger(false);
        service
    }

    pub fn snapshot(&self) -> UsageSnapshot {
        let mut snapshot = self.snapshot.read().expect("usage snapshot lock").clone();
        // 导入进度动态读取：状态一旦 ready/failed 就不再展示进度。
        if self.progress.importing_codex.load(Ordering::Relaxed) && snapshot.codex.state == "backfill" {
            snapshot.codex.progress = Some(ImportProgress {
                files_total: self.progress.codex_files_total.load(Ordering::Relaxed),
                files_done: self.progress.codex_files_done.load(Ordering::Relaxed),
            });
        }
        if self.progress.importing_zcode.load(Ordering::Relaxed) && snapshot.zcode.state == "backfill" {
            snapshot.zcode.progress = Some(ImportProgress { files_total: 0, files_done: 0 });
        }
        snapshot
    }

    fn with_ledger<T>(
        &self,
        body: impl FnOnce(&mut UsageLedger) -> Result<T, Diagnostic>,
    ) -> Result<T, Diagnostic> {
        let mut guard = self.ledger.lock().expect("usage ledger lock");
        if guard.is_none() {
            match UsageLedger::open(&self.ledger_path) {
                Ok(ledger) => {
                    if let Ok(state) = ledger.meta_get("codex.scan_state") {
                        if let Some(parsed) = state
                            .and_then(|text| serde_json::from_str::<SourceScanState>(&text).ok())
                        {
                            *self.codex_scan_state.lock().expect("scan state lock") = parsed;
                        }
                    }
                    *guard = Some(ledger);
                }
                Err(diagnostic) => {
                    *self.open_diagnostic.lock().expect("open diagnostic lock") = Some(diagnostic.clone());
                    return Err(diagnostic);
                }
            }
        }
        body(guard.as_mut().expect("ledger present"))
    }

    /// 从账本重建数字（每日桶、起点、请求数）。
    ///
    /// `fresh_states = false`（构造时）：两来源处于 backfill 补采态；
    /// `fresh_states = true`（单轮采集后）：保留本轮已确定的 ready/failed 状态、
    /// 成功时间与诊断，只刷新账本派生的数字。
    fn rebuild_snapshot_from_ledger(&self, fresh_states: bool) {
        let open_failure = self.open_diagnostic.lock().expect("lock").clone();
        let previous = self.snapshot.read().expect("usage snapshot lock").clone();
        let ledger_view = self.with_ledger(|ledger| {
            let offset = local_offset();
            Ok((
                ledger.daily_totals(SOURCE_CODEX, offset)?,
                ledger.daily_totals(SOURCE_ZCODE, offset)?,
                ledger.request_count(SOURCE_CODEX)?,
                ledger.request_count(SOURCE_ZCODE)?,
                ledger.meta_get("codex.collection_start_day")?,
                ledger.meta_get("zcode.collection_start_day")?,
            ))
        });
        let mut codex = if fresh_states { previous.codex.clone() } else { UsageSourceSnapshot::empty("backfill") };
        let mut zcode = if fresh_states { previous.zcode.clone() } else { UsageSourceSnapshot::empty("backfill") };
        match ledger_view {
            Ok((codex_daily, zcode_daily, codex_count, zcode_count, codex_start, zcode_start)) => {
                codex.earliest_day = codex_daily.keys().next().cloned();
                codex.collection_start_day = codex_start;
                codex.daily = codex_daily;
                codex.request_count = codex_count;
                zcode.earliest_day = zcode_daily.keys().next().cloned();
                zcode.collection_start_day = zcode_start;
                zcode.daily = zcode_daily;
                zcode.request_count = zcode_count;
            }
            Err(diagnostic) => {
                codex.state = "failed";
                zcode.state = "failed";
                codex.diagnostic = Some(diagnostic.clone());
                zcode.diagnostic = Some(diagnostic);
            }
        }
        if let Some(diagnostic) = open_failure {
            codex.state = "failed";
            zcode.state = "failed";
            codex.diagnostic = Some(diagnostic.clone());
            zcode.diagnostic = Some(diagnostic);
        }
        codex.progress = None;
        zcode.progress = None;
        let snapshot = UsageSnapshot {
            generated_at_ms: crate::usage_ledger::now_ms(),
            codex,
            zcode,
        };
        *self.snapshot.write().expect("usage snapshot lock") = snapshot;
    }

    /// 单轮采集：先 ZCode（快），再 Codex（逐文件上报进度）。
    /// 任何来源失败都不清空账本数据，只置 failed 并保留上一轮成功时间。
    pub fn refresh(&self) {
        self.progress.importing_zcode.store(true, Ordering::Relaxed);
        self.refresh_zcode();
        self.progress.importing_zcode.store(false, Ordering::Relaxed);
        self.progress.importing_codex.store(true, Ordering::Relaxed);
        self.progress.codex_files_done.store(0, Ordering::Relaxed);
        self.refresh_codex();
        self.progress.importing_codex.store(false, Ordering::Relaxed);
        self.rebuild_snapshot_from_ledger(true);
    }

    fn refresh_zcode(&self) {
        let db_path = zcode_db_path(&self.home);
        match scan_zcode_usage(&db_path) {
            Ok(records) => {
                let identity = zcode_db_identity(&db_path);
                let events: Vec<UsageEvent> = records
                    .into_iter()
                    .map(|record| UsageEvent {
                        source: SOURCE_ZCODE,
                        request_key: format!("zcode:{identity}:{}", record.id),
                        source_ts_ms: record.started_at_ms,
                        total_tokens: record.total_tokens,
                        input_tokens: record.input_tokens,
                        output_tokens: record.output_tokens,
                        cached_input_tokens: record.cached_input_tokens,
                        reasoning_tokens: record.reasoning_tokens,
                    })
                    .collect();
                let count = events.len();
                let write = self.with_ledger(|ledger| {
                    for event in &events {
                        ledger.upsert_zcode(event)?;
                    }
                    let today = local_day_now();
                    if ledger.meta_get("zcode.collection_start_day")?.is_none() {
                        ledger.meta_set("zcode.collection_start_day", &today)?;
                    }
                    Ok(())
                });
                self.apply_source_result(SOURCE_ZCODE, write, count as u64);
            }
            Err(diagnostic) => {
                self.record_source_failure(SOURCE_ZCODE, maybe_history_missing(diagnostic, self.ledger_has(SOURCE_ZCODE)));
            }
        }
    }

    fn refresh_codex(&self) {
        let sessions_dir = codex_sessions_dir(&self.home);
        let mut scan_state = self.codex_scan_state.lock().expect("scan state lock").clone();
        // 先探测文件总数供进度展示；目录缺失时报告 701。
        let mut conflicts = 0u64;
        let ledger_has_codex = self.ledger_has(SOURCE_CODEX);
        let result = scan_codex_sessions(&sessions_dir, &mut scan_state, |_, records| {
            self.progress
                .codex_files_done
                .fetch_add(1, Ordering::Relaxed);
            if records.is_empty() {
                return;
            }
            let events: Vec<UsageEvent> = records
                .into_iter()
                .map(|record| UsageEvent {
                    source: SOURCE_CODEX,
                    request_key: format!("codex:{}:{}", record.thread_id, record.response_id),
                    source_ts_ms: record.ts_ms,
                    total_tokens: record.total_tokens,
                    input_tokens: record.input_tokens,
                    output_tokens: record.output_tokens,
                    cached_input_tokens: record.cached_input_tokens,
                    reasoning_tokens: record.reasoning_tokens,
                })
                .collect();
                    let _ = self.with_ledger(|ledger| {
                        for event in &events {
                            if ledger.upsert_codex(event)? == CodexUpsert::Conflict {
                                conflicts += 1;
                            }
                        }
                        Ok(())
                    });
        });
        match result {
            Ok(report) => {
                self.progress
                    .codex_files_total
                    .store(report.files_total, Ordering::Relaxed);
                let persist = self.with_ledger(|ledger| {
                    ledger.meta_set(
                        "codex.scan_state",
                        &serde_json::to_string(&scan_state).unwrap_or_default(),
                    )?;
                    let today = local_day_now();
                    if ledger.meta_get("codex.collection_start_day")?.is_none() {
                        ledger.meta_set("codex.collection_start_day", &today)?;
                    }
                    Ok(())
                });
                *self.codex_scan_state.lock().expect("scan state lock") = scan_state;
                match persist {
                    Ok(()) => {
                        let mut diagnostic = if conflicts > 0 {
                            Some(
                                Diagnostic::new(
                                    "QDU-705",
                                    "检测到同一请求的用量冲突；已保留上次有效统计。请重试；若仍出现，请提供诊断码与应用版本",
                                )
                                .with_detail(format!("{conflicts} 个重复请求标识的计数不一致")),
                            )
                        } else {
                            None
                        };
                        if report.invalid_lines > 0 {
                            let gap = Diagnostic::new(
                                "QDU-706",
                                "部分历史记录无法解析；当前显示已记录用量",
                            )
                            .with_detail(format!("{} 行记录无法解析", report.invalid_lines));
                            diagnostic = Some(match diagnostic {
                                Some(existing) => {
                                    let combined = format!(
                                        "{}；另有 {} 行记录无法解析",
                                        existing.detail.clone().unwrap_or_default(),
                                        report.invalid_lines
                                    );
                                    existing.with_detail(combined)
                                }
                                None => gap,
                            });
                        }
                        self.apply_source_result(SOURCE_CODEX, Ok(()), self.ledger_count(SOURCE_CODEX));
                        if let Some(diagnostic) = diagnostic {
                            self.attach_source_diagnostic(SOURCE_CODEX, diagnostic);
                        }
                    }
                    Err(diagnostic) => {
                        self.record_source_failure(SOURCE_CODEX, diagnostic);
                    }
                }
            }
            Err(diagnostic) => {
                self.record_source_failure(SOURCE_CODEX, maybe_history_missing(diagnostic, ledger_has_codex));
            }
        }
    }

    fn apply_source_result(
        &self,
        source: &'static str,
        result: Result<(), Diagnostic>,
        request_count: u64,
    ) {
        let mut snapshot = self.snapshot.write().expect("usage snapshot lock");
        let part = if source == SOURCE_CODEX { &mut snapshot.codex } else { &mut snapshot.zcode };
        match result {
            Ok(()) => {
                part.state = "ready";
                part.last_success_at_ms = Some(crate::usage_ledger::now_ms());
                part.request_count = request_count;
                part.diagnostic = None;
            }
            Err(diagnostic) => {
                part.state = "failed";
                part.diagnostic = Some(diagnostic);
            }
        }
    }

    fn attach_source_diagnostic(&self, source: &'static str, diagnostic: Diagnostic) {
        let mut snapshot = self.snapshot.write().expect("usage snapshot lock");
        let part = if source == SOURCE_CODEX { &mut snapshot.codex } else { &mut snapshot.zcode };
        part.diagnostic = Some(diagnostic);
    }

    fn record_source_failure(&self, source: &'static str, diagnostic: Diagnostic) {
        self.apply_source_result(source, Err(diagnostic), 0);
    }

    fn ledger_has(&self, source: &str) -> bool {
        self.with_ledger(|ledger| Ok(ledger.request_count(source)? > 0))
            .unwrap_or(false)
    }

    fn ledger_count(&self, source: &str) -> u64 {
        self.with_ledger(|ledger| ledger.request_count(source)).unwrap_or(0)
    }

    /// 单来源重试：只重新读取指定来源并保留其余来源状态。
    pub fn refresh_source(&self, source: &str) {
        match source {
            SOURCE_ZCODE => {
                self.progress.importing_zcode.store(true, Ordering::Relaxed);
                self.refresh_zcode();
                self.progress.importing_zcode.store(false, Ordering::Relaxed);
            }
            SOURCE_CODEX => {
                self.progress.importing_codex.store(true, Ordering::Relaxed);
                self.progress.codex_files_done.store(0, Ordering::Relaxed);
                self.refresh_codex();
                self.progress.importing_codex.store(false, Ordering::Relaxed);
            }
            _ => {}
        }
        self.rebuild_snapshot_from_ledger(true);
    }

    /// 启动周期采集线程。返回句柄线程本身，便于测试等待。
    pub fn spawn_refresh_loop(self: &std::sync::Arc<Self>) -> std::thread::JoinHandle<()> {
        let service = std::sync::Arc::clone(self);
        std::thread::spawn(move || {
            service.refresh();
            loop {
                std::thread::sleep(REFRESH_INTERVAL);
                service.refresh();
            }
        })
    }
}

/// 来源路径消失但账本已有历史时，按"历史缺失"提示，不当成首次未使用。
fn maybe_history_missing(diagnostic: Diagnostic, ledger_has_records: bool) -> Diagnostic {
    if diagnostic.code != "QDU-701" || !ledger_has_records {
        return diagnostic;
    }
    let source_name = if diagnostic.message.starts_with("未找到 Codex") { "Codex" } else { "ZCode" };
    Diagnostic::new(
        "QDU-701",
        format!("{source_name} 的本机用量记录已不存在或被清理；QuoDex 已保存的历史账目仍在"),
    )
    .with_detail(diagnostic.detail.unwrap_or_else(|| diagnostic.message))
}

fn local_offset() -> chrono::FixedOffset {
    Local::now().offset().fix()
}

fn local_day_now() -> String {
    let offset = local_offset();
    offset
        .from_utc_datetime(&chrono::Utc::now().naive_utc())
        .date_naive()
        .format("%Y-%m-%d")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usage_ledger::now_ms;

    fn fixture_home(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quodex-service-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".zcode/cli/db")).unwrap();
        dir
    }

    fn zcode_db(home: &PathBuf) -> PathBuf {
        let path = zcode_db_path(home);
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE model_usage (
                id text primary key, session_id text not null, query_source text not null,
                status text not null, started_at integer not null,
                input_tokens integer not null default 0, output_tokens integer not null default 0,
                reasoning_tokens integer not null default 0,
                cache_creation_input_tokens integer not null default 0,
                cache_read_input_tokens integer not null default 0,
                computed_total_tokens integer not null default 0);
            INSERT INTO model_usage (id, session_id, query_source, status, started_at,
                input_tokens, output_tokens, reasoning_tokens, cache_creation_input_tokens,
                cache_read_input_tokens, computed_total_tokens)
            VALUES ('req-1', 's', 'main_turn', 'completed', 1791000000000, 100, 10, 0, 0, 0, 110);",
        )
        .unwrap();
        path
    }

    #[test]
    fn imports_zcode_and_reports_ready_with_coverage() {
        let home = fixture_home("zcode-ready");
        zcode_db(&home);
        let ledger_path = home.join("ledger.sqlite");
        let service = std::sync::Arc::new(UsageService::new(home.clone(), ledger_path));
        // 初始快照是补采中，但账本为空
        assert_eq!(service.snapshot().zcode.state, "backfill");
        service.refresh();
        let snapshot = service.snapshot();
        assert_eq!(snapshot.zcode.state, "ready");
        assert!(snapshot.zcode.last_success_at_ms.is_some());
        assert_eq!(snapshot.zcode.request_count, 1);
        assert_eq!(snapshot.zcode.daily.values().sum::<i64>(), 110);
        assert!(snapshot.zcode.collection_start_day.is_some());
        assert!(snapshot.zcode.diagnostic.is_none());
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn zcode_failure_keeps_ledger_data_and_reports_diagnostic() {
        let home = fixture_home("zcode-fail");
        zcode_db(&home);
        let ledger_path = home.join("ledger.sqlite");
        let service = std::sync::Arc::new(UsageService::new(home.clone(), ledger_path));
        service.refresh();
        assert_eq!(service.snapshot().zcode.state, "ready");
        // 删除源库：下一轮失败，但账本数据保留
        std::fs::remove_file(zcode_db_path(&home)).unwrap();
        service.refresh();
        let snapshot = service.snapshot();
        assert_eq!(snapshot.zcode.state, "failed");
        assert_eq!(snapshot.zcode.diagnostic.as_ref().unwrap().code, "QDU-701");
        assert!(
            snapshot.zcode.diagnostic.as_ref().unwrap().message.contains("历史账目仍在"),
            "ledger history must turn 701 into the history-missing variant"
        );
        assert_eq!(snapshot.zcode.daily.values().sum::<i64>(), 110, "ledger data survives source loss");
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn codex_import_persists_scan_state_and_dedups_across_restarts() {
        let home = fixture_home("codex-import");
        let sessions = home.join(".codex/sessions/2026/10/05");
        std::fs::create_dir_all(&sessions).unwrap();
        std::fs::write(
            sessions.join("rollout-a.jsonl"),
            format!(
                "{{\"timestamp\":\"2026-10-05T08:00:00.000Z\",\"type\":\"token_usage_record\",\"payload\":{{\"thread_id\":\"t1\",\"response_id\":\"r1\",\"usage\":{{\"total_tokens\":123}}}}}}\n"
            ),
        )
        .unwrap();
        let ledger_path = home.join("ledger.sqlite");
        let service = std::sync::Arc::new(UsageService::new(home.clone(), ledger_path.clone()));
        service.refresh();
        let snapshot = service.snapshot();
        assert_eq!(snapshot.codex.state, "ready");
        assert_eq!(snapshot.codex.request_count, 1);
        assert_eq!(snapshot.codex.daily.values().sum::<i64>(), 123);

        // 重启：新 service 实例读同一账本，重复导入不加量
        let restarted = UsageService::new(home.clone(), ledger_path);
        restarted.refresh();
        assert_eq!(restarted.snapshot().codex.request_count, 1);
        assert_eq!(restarted.snapshot().codex.daily.values().sum::<i64>(), 123);
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn codex_conflicting_replay_surfaces_qdu_705() {
        let home = fixture_home("codex-conflict");
        let sessions = home.join(".codex/sessions/2026/10/05");
        std::fs::create_dir_all(&sessions).unwrap();
        let path = sessions.join("rollout-a.jsonl");
        std::fs::write(
            &path,
            format!(
                "{{\"timestamp\":\"2026-10-05T08:00:00.000Z\",\"type\":\"token_usage_record\",\"payload\":{{\"thread_id\":\"t1\",\"response_id\":\"r1\",\"usage\":{{\"total_tokens\":100}}}}}}\n"
            ),
        )
        .unwrap();
        let ledger_path = home.join("ledger.sqlite");
        {
            // Windows 不允许删除仍被 SQLite 连接占用的文件：先析构再清账本。
            let service = UsageService::new(home.clone(), ledger_path.clone());
            service.refresh();
            assert_eq!(
                service.snapshot().codex.daily.values().sum::<i64>(),
                100,
                "first import records the rollout value"
            );
        }
        // 同一 (thread, response) 换了计数：fork/replay 冲突 → 保留原值并报诊断
        std::fs::write(
            &path,
            format!(
                "{{\"timestamp\":\"2026-10-05T08:00:00.000Z\",\"type\":\"token_usage_record\",\"payload\":{{\"thread_id\":\"t1\",\"response_id\":\"r1\",\"usage\":{{\"total_tokens\":999}}}}}}\n"
            ),
        )
        .unwrap();
        // 强制重扫：换掉账本，让新服务把 999 当作唯一已知值重新导入。
        for _ in 0..10 {
            match std::fs::remove_file(&ledger_path) {
                Ok(()) | Err(_) if !ledger_path.exists() => break,
                _ => std::thread::sleep(std::time::Duration::from_millis(50)),
            }
        }
        assert!(!ledger_path.exists(), "ledger must be removable once no service holds it");
        let service = UsageService::new(home.clone(), ledger_path);
        service.refresh();
        let snapshot = service.snapshot();
        assert_eq!(snapshot.codex.daily.values().sum::<i64>(), 999, "fresh ledger reimports the only known value");
        let _ = std::fs::remove_dir_all(home);

        // 同一账本内的冲突：保留首次值 + QDU-705
        let home2 = fixture_home("codex-conflict2");
        let sessions2 = home2.join(".codex/sessions/2026/10/05");
        std::fs::create_dir_all(&sessions2).unwrap();
        let path2 = sessions2.join("rollout-b.jsonl");
        std::fs::write(
            &path2,
            format!(
                "{{\"timestamp\":\"2026-10-05T08:00:00.000Z\",\"type\":\"token_usage_record\",\"payload\":{{\"thread_id\":\"t\",\"response_id\":\"r\",\"usage\":{{\"total_tokens\":100}}}}}}\n{{\"timestamp\":\"2026-10-05T08:00:05.000Z\",\"type\":\"token_usage_record\",\"payload\":{{\"thread_id\":\"t\",\"response_id\":\"r\",\"usage\":{{\"total_tokens\":777}}}}}}\n"
            ),
        )
        .unwrap();
        let service2 = UsageService::new(home2.clone(), home2.join("ledger.sqlite"));
        service2.refresh();
        let snapshot = service2.snapshot();
        assert_eq!(snapshot.codex.daily.values().sum::<i64>(), 100);
        assert_eq!(snapshot.codex.diagnostic.as_ref().unwrap().code, "QDU-705");
        let _ = std::fs::remove_dir_all(home2);
    }

    #[test]
    fn initial_snapshot_survives_ledger_failure_and_reports_qdu_707() {
        let home = fixture_home("ledger-fail");
        // 把账本路径指到一个目录，制造打开失败
        let dir_as_ledger = home.join("not-a-ledger");
        std::fs::create_dir_all(&dir_as_ledger).unwrap();
        let service = UsageService::new(home.clone(), dir_as_ledger);
        service.refresh();
        let snapshot = service.snapshot();
        assert_eq!(snapshot.codex.state, "failed");
        assert_eq!(snapshot.codex.diagnostic.as_ref().unwrap().code, "QDU-707");
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn refresh_is_idempotent_for_repeated_calls() {
        let home = fixture_home("idempotent");
        zcode_db(&home);
        let service = UsageService::new(home.clone(), home.join("ledger.sqlite"));
        service.refresh();
        service.refresh();
        service.refresh();
        assert_eq!(service.snapshot().zcode.request_count, 1);
        assert_eq!(service.snapshot().zcode.daily.values().sum::<i64>(), 110);
        assert_eq!(service.snapshot().generated_at_ms >= now_ms() - 60_000, true);
        let _ = std::fs::remove_dir_all(home);
    }
}

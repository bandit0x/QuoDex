//! 用量来源读取器：Codex rollout JSONL 与 ZCode `model_usage` 只读 SQLite。
//!
//! 口径来自 `.scratch/token-usage/spec.md` 统计合同与
//! `docs/research/agent-token-usage-2026-10-05.md`：
//! - Codex 读 `token_usage_record.payload.usage.total_tokens`，按 receipt.timestamp 归档；
//! - ZCode 读 `model_usage.computed_total_tokens`，按 started_at 归档；
//! - 缓存、推理是从属细分，不叠加进总量；
//! - 只读访问，不读取聊天正文或凭据。

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use chrono::DateTime;
use rusqlite::{OpenFlags, Connection};
use serde::Deserialize;

use crate::capacity::Diagnostic;
use crate::usage_ledger::{SourceFileStamp, SourceScanState};

pub const CODEX_QDU_701: &str = "QDU-701";
const CODEX_NOT_FOUND: &str = "未找到 Codex 的本机用量记录；请打开 Codex 并产生用量后重试";
const ZCODE_NOT_FOUND: &str = "未找到 ZCode 的本机用量记录；请打开 ZCode 并产生用量后重试";

#[derive(Debug, Clone)]
pub struct CodexUsageRecord {
    pub thread_id: String,
    pub response_id: String,
    pub ts_ms: i64,
    pub total_tokens: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_input_tokens: i64,
    pub reasoning_tokens: i64,
}

#[derive(Debug, Default)]
pub struct CodexScanReport {
    pub files_total: usize,
    pub files_scanned: usize,
    /// 持续无效、无法解析的行数（不含正在写入的半写尾行）。
    pub invalid_lines: u64,
    /// 尾行尚未写完而跳过的文件数；等待补采，不算失败。
    pub skipped_partial_tail: bool,
}

pub fn codex_sessions_dir(home: &Path) -> PathBuf {
    home.join(".codex").join("sessions")
}

pub fn zcode_db_path(home: &Path) -> PathBuf {
    home.join(".zcode").join("cli").join("db").join("db.sqlite")
}

/// 扫描 Codex sessions 目录下的 rollout JSONL，把每个文件的记录交给 sink。
/// `state` 保存文件增量状态：未变化（长度与 mtime 一致）的文件不会重读。
pub fn scan_codex_sessions(
    sessions_dir: &Path,
    state: &mut SourceScanState,
    mut on_records: impl FnMut(&Path, Vec<CodexUsageRecord>),
) -> Result<CodexScanReport, Diagnostic> {
    let entries = collect_rollout_files(sessions_dir)?;
    let mut report = CodexScanReport {
        files_total: entries.len(),
        ..CodexScanReport::default()
    };
    let mut next_state = SourceScanState::default();
    for path in entries {
        let stamp = file_stamp(&path);
        let relative = path.display().to_string();
        if let Some(previous) = state.files.get(&relative) {
            if previous == &stamp {
                next_state.files.insert(relative, previous.clone());
                continue;
            }
        }
        let records = parse_rollout_file(&path, &mut report)?;
        report.files_scanned += 1;
        next_state.files.insert(relative, stamp);
        on_records(&path, records);
    }
    *state = next_state;
    Ok(report)
}

fn collect_rollout_files(sessions_dir: &Path) -> Result<Vec<PathBuf>, Diagnostic> {
    let metadata = match std::fs::metadata(sessions_dir) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(Diagnostic::new(CODEX_QDU_701, CODEX_NOT_FOUND))
        }
        Err(error) => {
            return Err(Diagnostic::new(
                "QDU-702",
                "无法读取 Codex 用量记录；请检查记录目录的读取权限后重试",
            )
            .with_detail(error.to_string()))
        }
    };
    if !metadata.is_dir() {
        return Err(Diagnostic::new(CODEX_QDU_701, CODEX_NOT_FOUND));
    }
    let mut files = Vec::new();
    collect_jsonl_files(sessions_dir, &mut files, 0).map_err(|error| {
        Diagnostic::new(
            "QDU-702",
            "无法读取 Codex 用量记录；请检查记录目录的读取权限后重试",
        )
        .with_detail(error.to_string())
    })?;
    files.sort();
    Ok(files)
}

fn collect_jsonl_files(dir: &Path, files: &mut Vec<PathBuf>, depth: u8) -> std::io::Result<()> {
    if depth > 8 {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, files, depth + 1)?;
        } else if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
    Ok(())
}

fn file_stamp(path: &Path) -> SourceFileStamp {
    let (len, mtime_ms) = std::fs::metadata(path)
        .map(|metadata| {
            let len = metadata.len();
            let mtime_ms = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as i64)
                .unwrap_or(0);
            (len, mtime_ms)
        })
        .unwrap_or((0, 0));
    SourceFileStamp { len, mtime_ms }
}

#[derive(Debug, Deserialize)]
struct RolloutRecord {
    timestamp: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    payload: Option<RolloutPayload>,
}

#[derive(Debug, Deserialize)]
struct RolloutPayload {
    thread_id: Option<String>,
    response_id: Option<String>,
    usage: Option<RolloutUsage>,
}

#[derive(Debug, Deserialize)]
struct RolloutUsage {
    total_tokens: Option<i64>,
    #[serde(default)]
    input_tokens: i64,
    #[serde(default)]
    output_tokens: i64,
    #[serde(rename = "cached_input_tokens", default)]
    cached_input_tokens: i64,
    #[serde(rename = "reasoning_output_tokens", default)]
    reasoning_output_tokens: i64,
}

fn parse_rollout_file(
    path: &Path,
    report: &mut CodexScanReport,
) -> Result<Vec<CodexUsageRecord>, Diagnostic> {
    let file = std::fs::File::open(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            Diagnostic::new(CODEX_QDU_701, CODEX_NOT_FOUND)
        } else {
            Diagnostic::new(
                "QDU-702",
                "无法读取 Codex 用量记录；请检查记录目录的读取权限后重试",
            )
            .with_detail(error.to_string())
        }
    })?;
    let mut reader = BufReader::new(file);
    let mut records = Vec::new();
    let mut line = String::new();
    loop {
        line.clear();
        let bytes = reader.read_line(&mut line).map_err(|error| {
            Diagnostic::new(
                "QDU-702",
                "无法读取 Codex 用量记录；请检查记录目录的读取权限后重试",
            )
            .with_detail(error.to_string())
        })?;
        if bytes == 0 {
            break;
        }
        let trimmed = line.trim_end_matches(['\n', '\r']);
        let parsed: Option<RolloutRecord> = serde_json::from_str(trimmed).ok();
        let Some(parsed) = parsed else {
            // 追加中的最后一行可能尚未写完：没有换行符的解析失败行等待补采，
            // 不计入格式缺口；其余无效行按持续缺口上报。
            if !line.ends_with('\n') {
                report.skipped_partial_tail = true;
            } else {
                report.invalid_lines += 1;
            }
            continue;
        };
        if parsed.kind.as_deref() != Some("token_usage_record") {
            continue;
        }
        let Some(payload) = parsed.payload else {
            report.invalid_lines += 1;
            continue;
        };
        let Some(response_id) = payload.response_id.filter(|value| !value.is_empty()) else {
            // 与调研脚本一致：没有 response_id 的记录无法去重，不参与统计。
            continue;
        };
        let Some(usage) = payload.usage else {
            report.invalid_lines += 1;
            continue;
        };
        let Some(total_tokens) = usage.total_tokens else {
            report.invalid_lines += 1;
            continue;
        };
        let ts_ms = parsed
            .timestamp
            .as_deref()
            .and_then(|text| DateTime::parse_from_rfc3339(text).ok())
            .map(|moment| moment.timestamp_millis())
            .unwrap_or(0);
        records.push(CodexUsageRecord {
            thread_id: payload.thread_id.unwrap_or_default(),
            response_id,
            ts_ms,
            total_tokens,
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cached_input_tokens: usage.cached_input_tokens,
            reasoning_tokens: usage.reasoning_output_tokens,
        });
    }
    Ok(records)
}

#[derive(Debug, Clone)]
pub struct ZcodeUsageRecord {
    pub id: String,
    pub started_at_ms: i64,
    pub total_tokens: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_input_tokens: i64,
    pub reasoning_tokens: i64,
}

/// 只读扫描 ZCode `model_usage` 表。不按 status/query_source 过滤，
/// 与 ZCode 应用自身统计一致（含主请求、子 agent、后台请求与有记录的失败请求）。
pub fn scan_zcode_usage(db_path: &Path) -> Result<Vec<ZcodeUsageRecord>, Diagnostic> {
    if !db_path.is_file() {
        return Err(Diagnostic::new("QDU-701", ZCODE_NOT_FOUND));
    }
    let conn = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(map_zcode_open_error)?;
    conn.busy_timeout(std::time::Duration::from_millis(1000))
        .map_err(map_zcode_open_error)?;
    conn.execute_batch("PRAGMA query_only = ON;")
        .map_err(map_zcode_open_error)?;
    let mut statement = conn
        .prepare(
            "SELECT id, started_at, computed_total_tokens, input_tokens, output_tokens,
             cache_read_input_tokens, cache_creation_input_tokens, reasoning_tokens
             FROM model_usage",
        )
        .map_err(map_zcode_query_error)?;
    let rows = statement
        .query_map([], |row| {
            let cache_read: i64 = row.get(5)?;
            let cache_write: i64 = row.get(6)?;
            Ok(ZcodeUsageRecord {
                id: row.get(0)?,
                started_at_ms: row.get(1)?,
                total_tokens: row.get(2)?,
                input_tokens: row.get(3)?,
                output_tokens: row.get(4)?,
                cached_input_tokens: cache_read + cache_write,
                reasoning_tokens: row.get(7)?,
            })
        })
        .map_err(map_zcode_query_error)?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(map_zcode_query_error)?);
    }
    Ok(records)
}

fn map_zcode_open_error(error: rusqlite::Error) -> Diagnostic {
    if is_busy(&error) {
        Diagnostic::new(
            "QDU-703",
            "ZCode 正在写入记录；请稍后重试",
        )
        .with_detail(error.to_string())
    } else if error.to_string().contains("unable to open") {
        Diagnostic::new(
            "QDU-702",
            "无法读取 ZCode 用量记录；请检查记录目录的读取权限后重试",
        )
        .with_detail(error.to_string())
    } else {
        Diagnostic::new(
            "QDU-704",
            "当前 ZCode 记录格式不受支持；请记录应用版本并检查 QuoDex 更新",
        )
        .with_detail(error.to_string())
    }
}

fn map_zcode_query_error(error: rusqlite::Error) -> Diagnostic {
    if is_busy(&error) {
        Diagnostic::new("QDU-703", "ZCode 正在写入记录；请稍后重试")
            .with_detail(error.to_string())
    } else {
        Diagnostic::new(
            "QDU-704",
            "当前 ZCode 记录格式不受支持；请记录应用版本并检查 QuoDex 更新",
        )
        .with_detail(error.to_string())
    }
}

fn is_busy(error: &rusqlite::Error) -> bool {
    matches!(error, rusqlite::Error::SqliteFailure(ffi, _)
        if ffi.code == rusqlite::ErrorCode::DatabaseBusy
            || ffi.code == rusqlite::ErrorCode::DatabaseLocked)
}

/// ZCode 源数据库身份：规范化路径的 SHA-256 前 16 位，保证换路径后不串账。
pub fn zcode_db_identity(db_path: &Path) -> String {
    let canonical = std::fs::canonicalize(db_path).unwrap_or_else(|_| db_path.to_path_buf());
    let text = canonical.display().to_string();
    sha256_hex(text.as_bytes())[..16].to_string()
}

pub fn sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(data);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quodex-sources-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_session(root: &Path, name: &str, lines: &[String]) -> PathBuf {
        let dir = root.join("2026/10/05");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();
        path
    }

    fn usage_line(ts: &str, thread: &str, response: &str, total: i64) -> String {
        format!(
            r#"{{"timestamp":"{ts}","type":"token_usage_record","payload":{{"thread_id":"{thread}","response_id":"{response}","usage":{{"input_tokens":{total},"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":10,"reasoning_output_tokens":2,"total_tokens":{total}}}}}}}"#
        )
    }

    #[test]
    fn scans_codex_rollout_records_and_dedup_ready_keys() {
        let root = temp_dir("codex-scan");
        let other = root.join("2026/10/04");
        std::fs::create_dir_all(&other).unwrap();
        write_session(
            &root,
            "rollout-a.jsonl",
            &[
                usage_line("2026-10-05T08:00:00.000Z", "thread-1", "resp-1", 100),
                usage_line("2026-10-05T09:00:00.000Z", "thread-1", "resp-2", 200),
                // 完全重复的一条：账本层负责去重，读取层照常上交。
                usage_line("2026-10-05T09:00:01.000Z", "thread-1", "resp-2", 200),
                r#"{"timestamp":"2026-10-05T09:30:00.000Z","type":"event_msg","payload":{}}"#.to_string(),
            ],
        );
        std::fs::write(
            other.join("rollout-b.jsonl"),
            format!(
                "{}\n{}\n",
                usage_line("2026-10-04T10:00:00.000Z", "thread-2", "resp-3", 55),
                // 缺 response_id：无法去重，跳过。
                r#"{"timestamp":"2026-10-04T11:00:00.000Z","type":"token_usage_record","payload":{"thread_id":"t","usage":{"total_tokens":9}}}"#
            ),
        )
        .unwrap();

        let mut state = SourceScanState::default();
        let report = scan_codex_sessions(&root, &mut state, |_, records| {
            assert!(!records.is_empty());
        })
        .unwrap();
        assert_eq!(report.files_total, 2);
        assert_eq!(report.files_scanned, 2);
        assert_eq!(report.invalid_lines, 0);
        assert_eq!(state.files.len(), 2);

        let mut totals = 0;
        scan_codex_sessions(&root, &mut state, |_, records| totals += records.len() as u64).unwrap();
        assert_eq!(totals, 0, "unchanged files must not be rescanned");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn codex_partial_tail_waits_for_backfill_and_invalid_midlines_report_gap() {
        let root = temp_dir("codex-tail");
        let dir = root.join("2026/10/05");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rollout-c.jsonl");
        // 尾行没有换行符且 JSON 未写完
        std::fs::write(
            &path,
            format!("{}\n{}", usage_line("2026-10-05T08:00:00.000Z", "t", "r1", 10), r#"{"timestamp":"2026-10-05T08:01:00.000Z","type":"token_usage_record","payload":{"thread_id""#),
        )
        .unwrap();
        let mut state = SourceScanState::default();
        let report = scan_codex_sessions(&root, &mut state, |_, _| {}).unwrap();
        assert_eq!(report.invalid_lines, 0);
        assert!(report.skipped_partial_tail, "truncated trailing line waits for backfill");

        // 中间的持续无效行（非尾行）计入缺口
        std::fs::write(
            &path,
            format!(
                "{}\nnot-json-at-all\n{}",
                usage_line("2026-10-05T08:00:00.000Z", "t", "r1", 10),
                usage_line("2026-10-05T08:02:00.000Z", "t", "r2", 20)
            ),
        )
        .unwrap();
        let mut state = SourceScanState::default();
        let report = scan_codex_sessions(&root, &mut state, |_, _| {}).unwrap();
        assert_eq!(report.invalid_lines, 1);
        assert!(!report.skipped_partial_tail);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn codex_missing_dir_reports_qdu_701() {
        let root = temp_dir("codex-missing");
        let mut state = SourceScanState::default();
        let error = scan_codex_sessions(&root.join(".codex/sessions"), &mut state, |_, _| {}).unwrap_err();
        assert_eq!(error.code, "QDU-701");
        let _ = std::fs::remove_dir_all(root);
    }

    fn zcode_fixture(db_path: &Path) {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let conn = Connection::open(db_path).unwrap();
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
            VALUES
                ('req-1', 's1', 'main_turn', 'completed', 1791000000000, 100, 10, 2, 3, 40, 110),
                ('req-2', 's1', 'subagent', 'error', 1791086400000, 50, 5, 0, 0, 0, 55);",
        )
        .unwrap();
    }

    #[test]
    fn scans_zcode_model_usage_including_failed_requests() {
        let root = temp_dir("zcode-scan");
        let db = root.join("cli/db/db.sqlite");
        zcode_fixture(&db);
        let records = scan_zcode_usage(&db).unwrap();
        assert_eq!(records.len(), 2);
        let failed = records.iter().find(|record| record.id == "req-2").unwrap();
        assert_eq!(failed.total_tokens, 55, "failed requests with usage are included");
        assert_eq!(failed.started_at_ms, 1_791_086_400_000);
        let first = &records[0];
        assert_eq!(first.cached_input_tokens, 43, "cache read + creation counted as cached input");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn zcode_missing_db_is_701_and_wrong_schema_is_704() {
        let root = temp_dir("zcode-errors");
        let missing = scan_zcode_usage(&root.join("nope.sqlite")).unwrap_err();
        assert_eq!(missing.code, "QDU-701");

        let wrong = root.join("wrong.sqlite");
        std::fs::write(&wrong, []).unwrap();
        let error = scan_zcode_usage(&wrong).unwrap_err();
        assert_eq!(error.code, "QDU-704");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn zcode_busy_lock_maps_to_qdu_703() {
        let root = temp_dir("zcode-busy");
        let db = root.join("cli/db/db.sqlite");
        zcode_fixture(&db);
        let holder = Connection::open(&db).unwrap();
        holder.execute_batch("BEGIN EXCLUSIVE;").unwrap();
        let error = scan_zcode_usage(&db).unwrap_err();
        assert_eq!(error.code, "QDU-703", "exclusive holder must surface busy diagnostic");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn zcode_identity_is_stable_and_path_sensitive() {
        let root = temp_dir("zcode-identity");
        let db = root.join("cli/db/db.sqlite");
        zcode_fixture(&db);
        let first = zcode_db_identity(&db);
        let again = zcode_db_identity(&db);
        assert_eq!(first, again);
        let other = root.join("other.sqlite");
        std::fs::write(&other, []).unwrap();
        assert_ne!(first, zcode_db_identity(&other));
        let _ = std::fs::remove_dir_all(root);
    }
}

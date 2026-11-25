use crate::{
    capacity::Diagnostic,
    task_status::{now_ms, ChatTask, SourceTaskSnapshot, TaskSource, TaskState},
};
use rusqlite::{Connection, OpenFlags};
use std::{
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

pub(crate) fn web_chat_url(route: &str) -> Option<tauri::Url> {
    fn account(index: &str) -> bool {
        !index.is_empty() && index.bytes().all(|byte| byte.is_ascii_digit())
    }
    let fragments: Vec<_> = route.strip_prefix('/')?.split('/').collect();
    let id = match fragments.as_slice() {
        ["app", id] => *id,
        ["u", n, "app", id] | ["app", "u", n, id] if account(n) => *id,
        _ => return None,
    };
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return None;
    }
    let route = match fragments.as_slice() {
        ["u", "0", "app", _] | ["app", "u", "0", _] => format!("/app/{id}"),
        _ => route.to_owned(),
    };
    tauri::Url::parse(&format!("https://gemini.google.com{route}")).ok()
}

fn unavailable(code: &'static str, message: &'static str) -> SourceTaskSnapshot {
    SourceTaskSnapshot {
        tasks: Vec::new(),
        observed_at_ms: now_ms(),
        diagnostic: Some(Diagnostic::new(code, message)),
    }
}

pub(crate) fn start() -> Arc<Mutex<[SourceTaskSnapshot; 2]>> {
    let state = Arc::new(Mutex::new([
        unavailable("QDT-600", "正在连接 Gemini 网页"),
        unavailable("QDT-600", "正在读取 Antigravity 任务"),
    ]));
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default();
    for index in 0..2 {
        let shared = Arc::downgrade(&state);
        let home = home.clone();
        std::thread::spawn(move || {
            #[cfg(windows)]
            let mut web = crate::gemini_quota::windows_reader::WebChatTracker::default();
            loop {
                if shared.strong_count() == 0 {
                    break;
                }
                let snapshot = if index == 0 {
                    #[cfg(windows)]
                    let snapshot = read_web(&mut web);
                    #[cfg(not(windows))]
                    let snapshot = unavailable("QDT-641", "此平台暂无法读取 Gemini 网页聊天");
                    snapshot
                } else {
                    read_antigravity(&home)
                };
                let Some(shared) = shared.upgrade() else {
                    break;
                };
                shared.lock().expect("Gemini task snapshot lock")[index] = snapshot;
                drop(shared);
                std::thread::sleep(Duration::from_secs(3));
            }
        });
    }
    state
}

#[cfg(windows)]
fn read_web(web: &mut crate::gemini_quota::windows_reader::WebChatTracker) -> SourceTaskSnapshot {
    web.read().unwrap_or_else(|_| {
        unavailable(
            "QDT-641",
            "无法读取窗口辅助功能；请重新打开 Gemini 网页聊天",
        )
    })
}

fn read_antigravity(home: &Path) -> SourceTaskSnapshot {
    let path = home.join(".gemini/antigravity/conversation_summaries.db");
    if !path.is_file() {
        return unavailable("QDT-642", "打开 Antigravity 聊天以生成本地任务记录");
    }
    let now = now_ms();
    match antigravity_rows(&path, now) {
        Ok(tasks) => SourceTaskSnapshot {
            tasks,
            observed_at_ms: now,
            diagnostic: None,
        },
        Err(_) => unavailable(
            "QDT-642",
            "无法读取 Antigravity 任务摘要；检查文件权限并确认应用版本",
        ),
    }
}

fn timestamp(text: &str) -> Option<u64> {
    let (date, time) = text.split_once([' ', 'T'])?;
    chrono::DateTime::parse_from_rfc3339(&format!("{date}T{time}"))
        .ok()?
        .timestamp_millis()
        .try_into()
        .ok()
}

#[derive(serde::Deserialize)]
struct TranscriptStep {
    step_index: i64,
    #[serde(rename = "type")]
    kind: String,
    source: String,
    status: String,
    created_at: String,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<serde::de::IgnoredAny>>,
}

fn antigravity_completion(
    db: &Path,
    id: uuid::Uuid,
    input: &str,
    step_index: i64,
    now: u64,
) -> Option<u64> {
    let path = db
        .parent()?
        .join("brain")
        .join(id.to_string())
        .join(".system_generated/logs/transcript.jsonl");
    let mut file = std::fs::File::open(path).ok()?;
    let size = file.metadata().ok()?.len();
    let start = size.saturating_sub(256 * 1024);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut reader = BufReader::new(file.take(size - start));
    let mut line = Vec::new();
    if start > 0 {
        reader.read_until(b'\n', &mut line).ok()?;
        line.clear();
    }
    let mut final_step = None;
    let mut prompt = None;
    while reader.read_until(b'\n', &mut line).ok()? > 0 {
        if !line.iter().all(u8::is_ascii_whitespace) {
            let step: TranscriptStep = serde_json::from_slice(&line).ok()?;
            if step.kind == "USER_INPUT" && step.source == "USER_EXPLICIT" {
                prompt = Some((step.step_index, timestamp(&step.created_at)?));
            }
            final_step = Some(step);
        }
        line.clear();
    }
    let last = final_step?;
    let (last_input_index, last_input_time) = prompt?;
    let expected_time = timestamp(input)?;
    let ended = timestamp(&last.created_at)?;
    (last.kind == "PLANNER_RESPONSE"
        && last.source == "MODEL"
        && last.status == "DONE"
        && last.content.is_some_and(|text| !text.trim().is_empty())
        && last.tool_calls.is_none_or(|calls| calls.is_empty())
        && last.step_index > last_input_index
        && (step_index < 0 || last_input_index == step_index)
        && expected_time.abs_diff(last_input_time) < 1_000
        && ended >= last_input_time
        && ended <= now
        && now - ended < 1_800_000)
        .then_some(ended)
}

fn antigravity_rows(path: &Path, now: u64) -> rusqlite::Result<Vec<ChatTask>> {
    let db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    db.busy_timeout(Duration::from_millis(250))?;
    let mut query = db.prepare(
        "SELECT conversation_id, title, status, not_fully_idle, last_user_input_time, last_user_input_step_index, last_modified_time
         FROM conversation_summaries
         WHERE COALESCE(parent_conversation_id, '') = '' AND nesting_depth = 0 AND killed = 0"
    )?;
    let rows = query.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, bool>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, String>(6)?,
        ))
    })?;
    let mut tasks = Vec::new();
    for row in rows {
        let (id, title, status, busy, input, step_index, modified) = row?;
        let Ok(id) = uuid::Uuid::parse_str(&id) else {
            continue;
        };
        let fresh = timestamp(&modified).is_some_and(|time| time <= now && now - time < 1_800_000);
        let completed_at_ms = if status == "CASCADE_RUN_STATUS_IDLE" && !busy && fresh {
            antigravity_completion(path, id, &input, step_index, now).map(|reply_started| {
                // The transcript timestamps the planner step at its start.
                timestamp(&modified)
                    .unwrap_or(reply_started)
                    .max(reply_started)
            })
        } else {
            None
        };
        let state = match status.as_str() {
            "CASCADE_RUN_STATUS_IDLE" if completed_at_ms.is_some() => TaskState::Completed,
            "CASCADE_RUN_STATUS_IDLE" if !busy => continue,
            "CASCADE_RUN_STATUS_RUNNING" if fresh => TaskState::Running,
            "CASCADE_RUN_STATUS_WAITING_FOR_USER" | "CASCADE_RUN_STATUS_WAITING_FOR_USER_INPUT"
                if fresh =>
            {
                TaskState::Waiting
            }
            "CASCADE_RUN_STATUS_ERROR" if fresh && step_index >= 0 => TaskState::Failed,
            _ if fresh || busy => TaskState::Unknown,
            _ => continue,
        };
        tasks.push(ChatTask {
            source: TaskSource::Antigravity,
            id: format!("antigravity:{id}"),
            turn_id: format!("{step_index}:{input}"),
            title: if title.trim().is_empty() {
                "Antigravity 聊天".into()
            } else {
                title.chars().take(160).collect()
            },
            state,
            completed_at_ms,
            expires_at_ms: None,
            project_path: None,
            project_name: None,
            detail: (state == TaskState::Unknown)
                .then(|| "打开 Antigravity 聊天确认执行状态 · QDT-642".into()),
        });
    }
    Ok(tasks)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn antigravity_requires_the_latest_prompt_and_terminal_model_reply() {
        let base = std::env::temp_dir().join(format!("quodex-ag-proof-{}", uuid::Uuid::new_v4()));
        let id = uuid::Uuid::new_v4();
        let log = base
            .join("brain")
            .join(id.to_string())
            .join(".system_generated/logs");
        std::fs::create_dir_all(&log).unwrap();
        let transcript = log.join("transcript.jsonl");
        let input = "2026-11-25 01:00:00.245+00:00";
        let now = timestamp("2026-11-25T01:00:10Z").unwrap();
        let prompt = r#"{"step_index":0,"type":"USER_INPUT","source":"USER_EXPLICIT","status":"DONE","created_at":"2026-11-25T01:00:00Z"}"#;
        let reply = r#"{"step_index":1,"type":"PLANNER_RESPONSE","source":"MODEL","status":"DONE","created_at":"2026-11-25T01:00:01Z","content":"fixture reply"}"#;
        std::fs::write(&transcript, format!("{prompt}\n{reply}\n")).unwrap();
        let db = base.join("conversation_summaries.db");
        assert_eq!(
            antigravity_completion(&db, id, input, -1, now),
            timestamp("2026-11-25T01:00:01Z")
        );
        assert_eq!(antigravity_completion(&db, id, input, 2, now), None);
        let unresolved = reply.replace(
            r#""content":"fixture reply""#,
            r#""content":"partial","tool_calls":[{}]"#,
        );
        std::fs::write(transcript, format!("{prompt}\n{unresolved}\n")).unwrap();
        assert_eq!(antigravity_completion(&db, id, input, 0, now), None);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn antigravity_keeps_chat_identity_across_updates_and_excludes_internal_chats() {
        let path = std::env::temp_dir().join(format!("quodex-ag-{}.db", uuid::Uuid::new_v4()));
        let db = Connection::open(&path).unwrap();
        db.execute_batch(
            "CREATE TABLE conversation_summaries (
                conversation_id TEXT PRIMARY KEY, title TEXT, status TEXT, not_fully_idle INTEGER,
                last_user_input_time TEXT, last_user_input_step_index INTEGER, last_modified_time TEXT,
                parent_conversation_id TEXT, nesting_depth INTEGER, killed INTEGER
            );
            INSERT INTO conversation_summaries VALUES
                ('10000000-0000-4000-8000-000000000001', 'Visible', 'CASCADE_RUN_STATUS_RUNNING',
                1, '2026-11-24 10:00:00+00:00', 3, '2026-11-24 10:00:10+00:00', '', 0, 0),
                ('10000000-0000-4000-8000-000000000002', 'Child', 'CASCADE_RUN_STATUS_RUNNING',
                1, '2026-11-24 10:00:00+00:00', 3, '2026-11-24 10:00:10+00:00', 'parent', 1, 0);",
        ).unwrap();
        let now = timestamp("2026-11-24 10:00:30+00:00").unwrap();
        let first = antigravity_rows(&path, now).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].state, TaskState::Running);
        db.execute(
            "UPDATE conversation_summaries SET last_modified_time = '2026-11-24 10:00:20+00:00',
               status = 'CASCADE_RUN_STATUS_WAITING_FOR_USER_INPUT' WHERE nesting_depth = 0",
            [],
        )
        .unwrap();
        let updated = antigravity_rows(&path, now).unwrap();
        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].id, first[0].id);
        assert_eq!(updated[0].turn_id, first[0].turn_id);
        assert_eq!(updated[0].state, TaskState::Waiting);
        drop(db);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn web_links_stay_on_the_chat_host_and_keep_the_account() {
        assert_eq!(
            web_chat_url("/u/3/app/abc").unwrap().as_str(),
            "https://gemini.google.com/u/3/app/abc"
        );
        assert_eq!(web_chat_url("/u/0/app/abc"), web_chat_url("/app/abc"));
        for invalid in [
            "/app",
            "/app/../admin",
            "//evil.example/app/id",
            "/app/id?profile=1",
            "/app/id%2fother",
        ] {
            assert!(web_chat_url(invalid).is_none(), "{invalid}");
        }
    }
}

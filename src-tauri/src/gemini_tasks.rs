use crate::{
    capacity::Diagnostic,
    task_status::{now_ms, ChatTask, SourceTaskSnapshot, TaskSource, TaskState},
};
use rusqlite::{Connection, OpenFlags};
use std::{
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
        std::thread::spawn(move || loop {
            if shared.strong_count() == 0 {
                break;
            }
            let snapshot = if index == 0 {
                read_web()
            } else {
                read_antigravity(&home)
            };
            let Some(shared) = shared.upgrade() else {
                break;
            };
            shared.lock().expect("Gemini task snapshot lock")[index] = snapshot;
            drop(shared);
            std::thread::sleep(Duration::from_secs(3));
        });
    }
    state
}

fn read_web() -> SourceTaskSnapshot {
    #[cfg(windows)]
    {
        crate::gemini_quota::windows_reader::web_chats().unwrap_or_else(|_| {
            unavailable(
                "QDT-641",
                "无法读取窗口辅助功能；请重新打开 Gemini 网页聊天",
            )
        })
    }
    #[cfg(not(windows))]
    {
        unavailable("QDT-641", "此平台暂无法读取 Gemini 网页聊天")
    }
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
        let state = match status.as_str() {
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
            completed_at_ms: None,
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

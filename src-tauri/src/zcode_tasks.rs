use crate::task_status::SourceTaskSnapshot;
use crate::{
    capacity::Diagnostic,
    task_status::{ChatTask, TaskSource, TaskState},
};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::{
    collections::HashMap,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub struct ZCodeTaskService {
    home: PathBuf,
    last: Mutex<SourceTaskSnapshot>,
}

impl ZCodeTaskService {
    pub fn from_environment() -> Self {
        let base = std::env::var_os("ZCODE_DATA_BASE_DIR")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from)
            .unwrap_or_default();
        Self::from_path(base.join(".zcode"))
    }
    pub fn from_path(home: PathBuf) -> Self {
        Self {
            home,
            last: Mutex::new(SourceTaskSnapshot {
                tasks: vec![],
                observed_at_ms: 0,
                diagnostic: None,
            }),
        }
    }
    pub fn read_snapshot(&self) -> SourceTaskSnapshot {
        let mut last = self.last.lock().expect("ZCode task snapshot lock");
        match read_zcode_tasks(&self.home, runtime_started_at_ms()) {
            Ok(tasks) => {
                last.tasks = tasks;
                last.diagnostic = None;
            }
            Err(diagnostic) => {
                last.tasks
                    .retain(|task| task.expires_at_ms.is_none_or(|time| time > now_ms()));
                for task in &mut last.tasks {
                    if matches!(task.state, TaskState::Completed | TaskState::Failed) {
                        continue;
                    }
                    task.state = TaskState::Unknown;
                    task.detail = Some(format!("{} · {}", diagnostic.message, diagnostic.code));
                }
                last.diagnostic = Some(diagnostic);
            }
        }
        last.observed_at_ms = now_ms();
        last.clone()
    }
    pub fn project_url(&self, id: &str) -> Result<tauri::Url, Diagnostic> {
        project_url(&self.home, id)
    }
}

pub fn project_url(home: &Path, id: &str) -> Result<tauri::Url, Diagnostic> {
    let invalid = || Diagnostic::new("QDT-624", "项目地址已失效；请刷新任务并确认所属项目仍存在");
    let db = Connection::open_with_flags(
        home.join("v2/tasks-index.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|_| invalid())?;
    db.busy_timeout(Duration::from_millis(100))
        .map_err(|_| invalid())?;
    let mut query = db
        .prepare("SELECT workspace_key,task_id,workspace_path FROM tasks WHERE deleted=0")
        .map_err(|_| invalid())?;
    let rows = query
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| invalid())?;
    for row in rows {
        let (workspace, task, path) = row.map_err(|_| invalid())?;
        if task_id(&workspace, &task) != id {
            continue;
        }
        if !Path::new(&path).is_absolute() || !Path::new(&path).is_dir() {
            return Err(invalid());
        }
        let mut url =
            tauri::Url::parse("zcode://workspace/open").expect("fixed ZCode workspace URL");
        url.query_pairs_mut().append_pair("path", &path);
        return Ok(url);
    }
    Err(invalid())
}

#[cfg(windows)]
fn runtime_started_at_ms() -> Option<u64> {
    use windows::Win32::{
        Foundation::{CloseHandle, FILETIME},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            RemoteDesktop::ProcessIdToSessionId,
            Threading::{
                GetCurrentProcessId, GetProcessTimes, OpenProcess,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
    };
    // An orphaned running journal cannot remain animated after the desktop exits or restarts.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut current_session = 0;
        let _ = ProcessIdToSessionId(GetCurrentProcessId(), &mut current_session);
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut oldest = None;
        let mut available = Process32FirstW(snapshot, &mut entry).is_ok();
        while available {
            let end = entry
                .szExeFile
                .iter()
                .position(|v| *v == 0)
                .unwrap_or(entry.szExeFile.len());
            if String::from_utf16_lossy(&entry.szExeFile[..end]).eq_ignore_ascii_case("ZCode.exe") {
                let mut session = 0;
                if ProcessIdToSessionId(entry.th32ProcessID, &mut session).is_ok()
                    && session == current_session
                {
                    if let Ok(process) = OpenProcess(
                        PROCESS_QUERY_LIMITED_INFORMATION,
                        false,
                        entry.th32ProcessID,
                    ) {
                        let mut created = FILETIME::default();
                        let mut exited = FILETIME::default();
                        let mut kernel = FILETIME::default();
                        let mut user = FILETIME::default();
                        if GetProcessTimes(
                            process,
                            &mut created,
                            &mut exited,
                            &mut kernel,
                            &mut user,
                        )
                        .is_ok()
                        {
                            let ticks = ((created.dwHighDateTime as u64) << 32)
                                | created.dwLowDateTime as u64;
                            if let Some(time) = (ticks / 10_000).checked_sub(11_644_473_600_000) {
                                oldest = Some(oldest.map_or(time, |old: u64| old.min(time)));
                            }
                        }
                        let _ = CloseHandle(process);
                    }
                }
            }
            available = Process32NextW(snapshot, &mut entry).is_ok();
        }
        let _ = CloseHandle(snapshot);
        oldest
    }
}
#[cfg(target_os = "macos")]
fn runtime_started_at_ms() -> Option<u64> {
    use std::ffi::{c_int, c_void, CStr};
    use std::mem::{size_of, MaybeUninit};

    // PROC_PIDTBSDINFO layout from the macOS SDK's <sys/proc_info.h>.
    #[repr(C)]
    struct ProcessInfo {
        flags: u32,
        status: u32,
        exit_status: u32,
        pid: u32,
        parent_pid: u32,
        uid: u32,
        gid: u32,
        real_uid: u32,
        real_gid: u32,
        saved_uid: u32,
        saved_gid: u32,
        reserved: u32,
        command: [u8; 16],
        name: [u8; 32],
        open_files: u32,
        process_group: u32,
        job_control: u32,
        terminal_device: u32,
        terminal_group: u32,
        nice: i32,
        started_seconds: u64,
        started_microseconds: u64,
    }
    #[link(name = "proc")]
    unsafe extern "C" {
        fn proc_listallpids(buffer: *mut c_void, size: c_int) -> c_int;
        fn proc_pidinfo(
            pid: c_int,
            flavor: c_int,
            arg: u64,
            buffer: *mut c_void,
            size: c_int,
        ) -> c_int;
        fn getuid() -> u32;
    }
    // libproc reports PID counts; the buffers below match their C layouts and sizes.
    let count = unsafe { proc_listallpids(std::ptr::null_mut(), 0) };
    if count <= 0 {
        return None;
    }
    let mut pids = vec![0_i32; count as usize + 32];
    let filled = unsafe {
        proc_listallpids(
            pids.as_mut_ptr().cast(),
            (pids.len() * size_of::<i32>()) as c_int,
        )
    };
    let uid = unsafe { getuid() };
    let mut oldest = None;
    for pid in pids
        .into_iter()
        .take(filled.max(0) as usize)
        .filter(|pid| *pid > 0)
    {
        let mut info = MaybeUninit::<ProcessInfo>::zeroed();
        let bytes = size_of::<ProcessInfo>() as c_int;
        if unsafe { proc_pidinfo(pid, 3, 0, info.as_mut_ptr().cast(), bytes) } != bytes {
            continue;
        }
        // The entire repr(C) record was written; all its fields are integer/byte values.
        let info = unsafe { info.assume_init() };
        if info.uid != uid
            || !CStr::from_bytes_until_nul(&info.command)
                .is_ok_and(|name| name.to_bytes() == b"ZCode")
        {
            continue;
        }
        if let Some(started) = info
            .started_seconds
            .checked_mul(1000)
            .and_then(|time| time.checked_add(info.started_microseconds / 1000))
        {
            oldest = Some(oldest.map_or(started, |old: u64| old.min(started)));
        }
    }
    oldest
}

#[cfg(not(any(windows, target_os = "macos")))]
fn runtime_started_at_ms() -> Option<u64> {
    None
}

/// Read desktop task metadata and the latest execution result, never conversation text.
pub fn read_zcode_tasks(
    home: &Path,
    runtime_started_at_ms: Option<u64>,
) -> Result<Vec<ChatTask>, Diagnostic> {
    let index_path = home.join("v2/tasks-index.sqlite");
    if !index_path
        .try_exists()
        .map_err(|_| Diagnostic::new("QDT-621", "无法读取 ZCode 任务记录；请检查数据目录权限"))?
    {
        return Ok(vec![]);
    }
    let open = |path| {
        let db =
            Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| {
                Diagnostic::new("QDT-621", "无法读取 ZCode 任务记录；请检查数据目录权限")
            })?;
        db.busy_timeout(Duration::from_millis(100))
            .map_err(|_| schema_error())?;
        Ok::<_, Diagnostic>(db)
    };
    let index = open(index_path)?;
    let agent = open(home.join("cli/db/db.sqlite"))?;
    let mut latest = agent.prepare("SELECT session_id,turn_id,status,completed_at,started_at FROM (SELECT u.*,ROW_NUMBER() OVER(PARTITION BY session_id ORDER BY started_at DESC,turn_id DESC) AS latest FROM turn_usage u JOIN session s ON s.id=u.session_id WHERE s.task_type='interactive') WHERE latest=1").map_err(|_| schema_error())?;
    let turns = latest
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<i64>>(3)?
                        .and_then(|v| u64::try_from(v).ok()),
                    r.get::<_, i64>(4)?.max(0) as u64,
                ),
            ))
        })
        .map_err(|_| schema_error())?
        .collect::<Result<HashMap<_, _>, _>>()
        .map_err(|_| schema_error())?;
    let now = now_ms();
    let mut restarted = agent.prepare("SELECT m.id FROM message m JOIN session s ON s.id=m.session_id WHERE m.session_id=?1 AND s.task_type='interactive' AND m.time_created>?2 AND json_extract(m.data,'$.role')='user' ORDER BY m.time_created DESC,m.id DESC LIMIT 1").map_err(|_| schema_error())?;
    let mut legacy = agent.prepare("SELECT m.id,json_extract(m.data,'$.parentID'),json_extract(m.data,'$.role'),m.time_created,json_extract(m.data,'$.time.completed'),json_extract(m.data,'$.finish'),json_extract(m.data,'$.error.name') FROM message m JOIN session s ON s.id=m.session_id WHERE m.session_id=?1 AND s.task_type='interactive' AND (?2 IS NULL OR m.id=?2 OR json_extract(m.data,'$.parentID')=?2) ORDER BY m.time_created DESC,m.id DESC LIMIT 1").map_err(|_|schema_error())?;
    let mut query = index.prepare("SELECT workspace_key,workspace_path,task_id,title FROM tasks WHERE deleted=0 ORDER BY workspace_key,task_id").map_err(|_| schema_error())?;
    let rows = query
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|_| schema_error())?;
    let mut tasks = vec![];
    // Prepare once per snapshot, not once per chat.
    let mut tools = agent.prepare("SELECT json_extract(p.data,'$.tool'),json_extract(p.data,'$.state.status') FROM part p JOIN message m ON m.id=p.message_id AND m.session_id=p.session_id WHERE p.session_id=?1 AND m.time_created>=?2 AND json_extract(p.data,'$.type')='tool' AND json_extract(p.data,'$.state.status') IN ('pending','running')").map_err(|_| schema_error())?;
    for row in rows {
        let (workspace, path, id, title) = row.map_err(|_| schema_error())?;
        // A new user submission can precede its turn_usage projection. Only a newer
        // user message proves a restart; late metadata from the old assistant does not.
        let restarted_user = match turns.get(&id) {
            Some((_, status, Some(ended), _))
                if matches!(status.as_str(), "completed" | "error" | "cancelled") =>
            {
                restarted
                    .query_row(rusqlite::params![id, *ended as i64], |r| {
                        r.get::<_, String>(0)
                    })
                    .optional()
                    .map_err(|_| schema_error())?
            }
            _ => None,
        };
        // Older desktop records predate turn_usage. Read only role/finish/error/time
        // metadata, restricting a restarted chat to the newly submitted round.
        let fallback = if !turns.contains_key(&id) || restarted_user.is_some() {
            legacy
                .query_row(rusqlite::params![id, restarted_user], |r| {
                    let message_id = r.get::<_, String>(0)?;
                    let parent = r.get::<_, Option<String>>(1)?;
                    let role = r.get::<_, Option<String>>(2)?;
                    let started = r.get::<_, i64>(3)?.max(0) as u64;
                    let ended = r
                        .get::<_, Option<i64>>(4)?
                        .and_then(|v| u64::try_from(v).ok());
                    let finish = r.get::<_, Option<String>>(5)?;
                    let error = r.get::<_, Option<String>>(6)?;
                    let status = match error.as_deref() {
                        Some("MessageAbortedError" | "AbortError") => "cancelled",
                        Some(_) => "error",
                        None if role.as_deref() == Some("assistant")
                            && ended.is_some()
                            && !matches!(finish.as_deref(), Some("tool-calls" | "tool_calls")) =>
                        {
                            "completed"
                        }
                        _ => "running",
                    };
                    Ok((
                        parent.unwrap_or(message_id),
                        status.to_owned(),
                        if status == "completed" { ended } else { None },
                        started,
                    ))
                })
                .optional()
                .map_err(|_| schema_error())?
        } else {
            None
        };
        let Some((turn_id, status, ended, started)) = fallback.as_ref().or(turns.get(&id)) else {
            continue;
        };
        if status == "cancelled" {
            continue;
        }
        let active =
            status == "running" && runtime_started_at_ms.is_some_and(|time| *started >= time);
        // Only tool name/state metadata is selected. Pending ordinary tools may be queued
        // or awaiting permission: the database cannot distinguish these, so do not guess.
        let pending = if active {
            tools
                .query_map(rusqlite::params![id, *started as i64], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .map_err(|_| schema_error())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| schema_error())?
        } else {
            vec![]
        };
        let waiting_question = pending.iter().any(|(name, _)| name == "AskUserQuestion");
        let pending_permission = pending
            .iter()
            .any(|(name, state)| name != "AskUserQuestion" && state == "pending");
        let state = match status.as_str() {
            "completed" if ended.is_some_and(|time| time <= now) => TaskState::Completed,
            "error" => TaskState::Failed,
            "running" if active && waiting_question => TaskState::Waiting,
            "running" if active && !pending_permission => TaskState::Running,
            _ => TaskState::Unknown,
        };
        if state == TaskState::Completed && ended.is_some_and(|time| now - time >= 1_800_000) {
            continue;
        }
        tasks.push(ChatTask {
            source: TaskSource::Zcode,
            id: task_id(&workspace, &id),
            turn_id: turn_id.clone(),
            title,
            state,
            completed_at_ms: *ended,
            expires_at_ms: if state == TaskState::Completed {
                ended.and_then(|time| time.checked_add(1_800_000))
            } else {
                None
            },
            detail: match state {
                TaskState::Failed => Some("本轮执行失败；打开项目查看原因并重试 · QDT-623".into()),
                TaskState::Unknown if pending_permission => {
                    Some("工具等待执行或批准；打开项目确认 · QDT-625".into())
                }
                TaskState::Unknown => {
                    Some("任务运行信息暂不可确认；打开 ZCode 项目后自动刷新 · QDT-625".into())
                }
                _ => None,
            },
            project_name: crate::task_status::directory_name(&path),
            project_path: Some(path),
        });
    }
    Ok(tasks)
}

fn task_id(workspace: &str, id: &str) -> String {
    let key: String = workspace
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("zcode:{key}:{id}")
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn schema_error() -> Diagnostic {
    Diagnostic::new("QDT-622", "ZCode 任务格式不受支持；请更新 QuoDex 适配器")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_status::TaskState;
    use rusqlite::{params, Connection};

    struct Fixture {
        root: std::path::PathBuf,
        index: Connection,
        agent: Connection,
        now: u64,
    }
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("quodex-zcode-tasks-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(root.join("v2")).unwrap();
            std::fs::create_dir_all(root.join("cli/db")).unwrap();
            let index = Connection::open(root.join("v2/tasks-index.sqlite")).unwrap();
            index.execute_batch("CREATE TABLE tasks(workspace_key TEXT,workspace_path TEXT,workspace_identity TEXT,task_id TEXT,title TEXT,task_status TEXT,deleted INTEGER,meta_json TEXT);").unwrap();
            let agent = Connection::open(root.join("cli/db/db.sqlite")).unwrap();
            agent.execute_batch("CREATE TABLE session(id TEXT,parent_id TEXT,task_type TEXT); CREATE TABLE turn_usage(session_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,error_code TEXT); CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT); CREATE TABLE part(id TEXT,message_id TEXT,session_id TEXT,time_updated INTEGER,data TEXT);").unwrap();
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;
            Self {
                root,
                index,
                agent,
                now,
            }
        }
        fn chat(&self, id: &str, status: &str, ended: Option<u64>) {
            self.index.execute("INSERT INTO tasks VALUES('D:/example','D:/example',NULL,?1,'示例项目任务','completed',0,'{}')", [id]).unwrap();
            self.agent
                .execute("INSERT INTO session VALUES(?1,NULL,'interactive')", [id])
                .unwrap();
            self.agent
                .execute(
                    "INSERT INTO turn_usage VALUES(?1,'turn-1',?2,?3,?4,NULL)",
                    params![
                        id,
                        status,
                        (self.now - 660_000) as i64,
                        ended.map(|v| v as i64)
                    ],
                )
                .unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            // Close SQLite handles before removing this test-owned directory on Windows.
            let index = std::mem::replace(&mut self.index, Connection::open_in_memory().unwrap());
            let agent = std::mem::replace(&mut self.agent, Connection::open_in_memory().unwrap());
            drop(index);
            drop(agent);
            std::fs::remove_dir_all(&self.root).unwrap();
        }
    }

    #[test]
    fn restarted_chat_does_not_reuse_completed_usage_while_new_execution_is_starting() {
        let fixture = Fixture::new();
        fixture.chat("ses-retry", "completed", Some(fixture.now - 60_000));
        fixture
            .agent
            .execute(
                "INSERT INTO message VALUES('new-user','ses-retry',?1,?2)",
                params![
                    (fixture.now - 1000) as i64,
                    serde_json::json!({"role":"user"}).to_string()
                ],
            )
            .unwrap();
        let tasks = read_zcode_tasks(&fixture.root, Some(fixture.now - 2000)).unwrap();
        assert_eq!(tasks[0].state, TaskState::Running);
        assert_eq!(tasks[0].turn_id, "new-user");
        assert_eq!(tasks[0].completed_at_ms, None);
        assert_eq!(tasks[0].expires_at_ms, None);
        let stopped = read_zcode_tasks(&fixture.root, None).unwrap();
        assert_eq!(stopped[0].state, TaskState::Unknown);
    }

    #[test]
    fn restart_ignores_late_old_assistant_metadata_and_accepts_new_round_result() {
        for previous in ["completed", "error", "cancelled"] {
            let fixture = Fixture::new();
            fixture.chat("ses-retry", previous, Some(fixture.now - 60_000));
            for (id, created, data) in [
                (
                    "new-user",
                    fixture.now - 1000,
                    serde_json::json!({"role":"user"}),
                ),
                (
                    "late-old-assistant",
                    fixture.now - 500,
                    serde_json::json!({"role":"assistant","parentID":"old-user","finish":"stop","time":{"completed":fixture.now-100}}),
                ),
            ] {
                fixture
                    .agent
                    .execute(
                        "INSERT INTO message VALUES(?1,'ses-retry',?2,?3)",
                        params![id, created as i64, data.to_string()],
                    )
                    .unwrap();
            }
            let tasks = read_zcode_tasks(&fixture.root, Some(fixture.now - 2000)).unwrap();
            assert_eq!(
                tasks[0].state,
                TaskState::Running,
                "previous state: {previous}"
            );
            assert_eq!(tasks[0].turn_id, "new-user");

            fixture.agent.execute("INSERT INTO message VALUES('new-assistant','ses-retry',?1,?2)", params![(fixture.now-50) as i64, serde_json::json!({"role":"assistant","parentID":"new-user","finish":"stop","time":{"completed":fixture.now-10}}).to_string()]).unwrap();
            let tasks = read_zcode_tasks(&fixture.root, None).unwrap();
            assert_eq!(tasks[0].state, TaskState::Completed);
            assert_eq!(tasks[0].turn_id, "new-user");
            assert_eq!(tasks[0].completed_at_ms, Some(fixture.now - 10));

            fixture.agent.execute("INSERT INTO turn_usage VALUES('ses-retry','projected-new-turn','completed',?1,?2,NULL)", params![(fixture.now-1000) as i64, (fixture.now-10) as i64]).unwrap();
            let tasks = read_zcode_tasks(&fixture.root, None).unwrap();
            assert_eq!(tasks[0].turn_id, "projected-new-turn");
            assert_eq!(tasks[0].completed_at_ms, Some(fixture.now - 10));
        }
    }

    #[test]
    fn terminal_round_without_finish_time_does_not_treat_its_original_user_as_restart() {
        for (status, expected) in [("error", Some(TaskState::Failed)), ("cancelled", None)] {
            let fixture = Fixture::new();
            fixture.chat("ses-terminal", status, None);
            fixture
                .agent
                .execute(
                    "INSERT INTO message VALUES('original-user','ses-terminal',?1,?2)",
                    params![
                        (fixture.now - 659_700) as i64,
                        serde_json::json!({"role":"user"}).to_string()
                    ],
                )
                .unwrap();
            let tasks = read_zcode_tasks(&fixture.root, Some(fixture.now - 700_000)).unwrap();
            assert_eq!(
                tasks.first().map(|task| task.state),
                expected,
                "terminal status: {status}"
            );
        }
    }

    #[test]
    fn reads_actual_finish_time_and_ignores_cancelled_latest_turn() {
        let f = Fixture::new();
        f.chat("ses-success", "completed", Some(f.now - 600_000));
        f.chat("ses-cancelled", "cancelled", Some(f.now));
        let tasks = read_zcode_tasks(&f.root, None).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].state, TaskState::Completed);
        assert_eq!(tasks[0].completed_at_ms, Some(f.now - 600_000));
    }

    #[test]
    fn active_question_waits_and_stopped_runtime_is_unknown() {
        let f = Fixture::new();
        f.chat("ses-running", "running", None);
        f.chat("ses-question", "running", None);
        f.agent
            .execute(
                "INSERT INTO message VALUES('message-1','ses-question',?1,'{}')",
                [f.now as i64],
            )
            .unwrap();
        f.agent.execute("INSERT INTO part VALUES('part-1','message-1','ses-question',?1,'{\"type\":\"tool\",\"tool\":\"AskUserQuestion\",\"state\":{\"status\":\"pending\"}}')", [f.now as i64]).unwrap();
        let tasks = read_zcode_tasks(&f.root, Some(f.now - 700_000)).unwrap();
        assert_eq!(
            tasks
                .iter()
                .find(|t| t.id.ends_with(":ses-running"))
                .unwrap()
                .state,
            TaskState::Running
        );
        assert_eq!(
            tasks
                .iter()
                .find(|t| t.id.ends_with(":ses-question"))
                .unwrap()
                .state,
            TaskState::Waiting
        );
        assert!(read_zcode_tasks(&f.root, None)
            .unwrap()
            .iter()
            .all(|t| t.state == TaskState::Unknown));
        assert!(read_zcode_tasks(&f.root, Some(f.now))
            .unwrap()
            .iter()
            .all(|t| t.state == TaskState::Unknown));
    }

    #[test]
    fn filters_children_and_old_results_while_preserving_latest_turn_and_workspace_identity() {
        let f = Fixture::new();
        f.chat("ses-child", "completed", Some(f.now));
        f.chat("ses-old", "completed", Some(f.now - 1_800_001));
        f.chat("ses-retry", "error", Some(f.now));
        f.agent
            .execute(
                "UPDATE session SET task_type='subagent' WHERE id='ses-child'",
                [],
            )
            .unwrap();
        f.agent
            .execute(
                "INSERT INTO turn_usage VALUES('ses-retry','turn-2','running',?1,NULL,NULL)",
                [f.now as i64],
            )
            .unwrap();
        f.index.execute("INSERT INTO tasks VALUES('D:/other','D:/other',NULL,'ses-retry','另一项目同标识','error',0,'{}')", []).unwrap();
        let tasks = read_zcode_tasks(&f.root, Some(f.now - 1)).unwrap();
        assert_eq!(tasks.len(), 2);
        assert_ne!(tasks[0].id, tasks[1].id);
        assert!(tasks
            .iter()
            .all(|t| t.turn_id == "turn-2" && t.state == TaskState::Running));
    }

    #[test]
    fn encodes_owned_project_path_and_rejects_unknown_or_deleted_task() {
        let f = Fixture::new();
        f.chat("ses-project", "completed", Some(f.now));
        let project = f.root.join("项目 空格 & #");
        std::fs::create_dir(&project).unwrap();
        f.index
            .execute(
                "UPDATE tasks SET workspace_path=?1",
                [project.to_string_lossy().as_ref()],
            )
            .unwrap();
        let task = read_zcode_tasks(&f.root, None).unwrap().remove(0);
        let url = project_url(&f.root, &task.id).unwrap();
        assert_eq!(url.scheme(), "zcode");
        assert_eq!(url.host_str(), Some("workspace"));
        assert_eq!(url.path(), "/open");
        assert_eq!(
            url.query_pairs().next().unwrap().1,
            project.to_string_lossy()
        );
        assert_eq!(
            project_url(&f.root, "zcode:forged:ses-project")
                .unwrap_err()
                .code,
            "QDT-624"
        );
        f.index.execute("UPDATE tasks SET deleted=1", []).unwrap();
        assert_eq!(project_url(&f.root, &task.id).unwrap_err().code, "QDT-624");
    }

    #[test]
    fn read_error_preserves_confirmed_completion_and_deadline_then_recovers() {
        let f = Fixture::new();
        f.chat("ses-success", "completed", Some(f.now - 600_000));
        let service = ZCodeTaskService::from_path(f.root.clone());
        let before = service.read_snapshot();
        assert_eq!(before.tasks[0].state, TaskState::Completed);
        f.agent
            .execute_batch("ALTER TABLE turn_usage RENAME TO temporarily_unavailable;")
            .unwrap();
        let lost = service.read_snapshot();
        assert_eq!(lost.diagnostic.unwrap().code, "QDT-622");
        assert_eq!(lost.tasks[0].state, TaskState::Completed);
        assert_eq!(lost.tasks[0].expires_at_ms, before.tasks[0].expires_at_ms);
        f.agent
            .execute_batch("ALTER TABLE temporarily_unavailable RENAME TO turn_usage;")
            .unwrap();
        let recovered = service.read_snapshot();
        assert!(recovered.diagnostic.is_none());
        assert_eq!(recovered.tasks[0].state, TaskState::Completed);
        f.agent
            .execute_batch("UPDATE turn_usage SET completed_at=completed_at-1200000;")
            .unwrap();
        assert!(service.read_snapshot().tasks.is_empty());
    }

    #[test]
    fn pending_ordinary_tool_and_invalid_finish_are_unknown_not_success_or_execution() {
        let f = Fixture::new();
        f.chat("ses-approval", "running", None);
        f.chat("ses-clock", "completed", Some(f.now + 60_000));
        f.agent
            .execute(
                "INSERT INTO message VALUES('message-1','ses-approval',?1,'{}')",
                [f.now as i64],
            )
            .unwrap();
        f.agent.execute("INSERT INTO part VALUES('part-1','message-1','ses-approval',?1,'{\"type\":\"tool\",\"tool\":\"Bash\",\"state\":{\"status\":\"pending\"}}')",[f.now as i64]).unwrap();
        let tasks = read_zcode_tasks(&f.root, Some(f.now - 700_000)).unwrap();
        assert_eq!(tasks.len(), 2);
        assert!(tasks.iter().all(|task| task.state == TaskState::Unknown));
        assert!(tasks
            .iter()
            .all(|task| task.detail.as_ref().unwrap().contains("QDT-625")));
    }

    #[test]
    fn reads_legacy_execution_metadata_when_turn_usage_has_no_record() {
        let f = Fixture::new();
        f.chat("ses-legacy", "completed", Some(f.now));
        f.chat("ses-legacy-error", "error", Some(f.now));
        f.agent.execute_batch("DELETE FROM turn_usage;").unwrap();
        for (id, error) in [
            ("ses-legacy", serde_json::Value::Null),
            (
                "ses-legacy-error",
                serde_json::json!({"name":"AiSdkModelAdapterError"}),
            ),
        ] {
            let data = serde_json::json!({"role":"assistant","parentID":"user-turn","finish":"stop","time":{"completed":f.now-600_000},"error":error});
            f.agent
                .execute(
                    "INSERT INTO message VALUES(?1,?1,?2,?3)",
                    params![id, (f.now - 660_000) as i64, data.to_string()],
                )
                .unwrap();
        }
        let tasks = read_zcode_tasks(&f.root, None).unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(
            tasks
                .iter()
                .find(|t| t.id.ends_with(":ses-legacy"))
                .unwrap()
                .completed_at_ms,
            Some(f.now - 600_000)
        );
        assert_eq!(
            tasks
                .iter()
                .find(|t| t.id.ends_with(":ses-legacy-error"))
                .unwrap()
                .state,
            TaskState::Failed
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires a running local ZCode desktop process; fixture task metadata"]
    fn running_macos_desktop_keeps_current_execution_active() {
        let fixture = Fixture::new();
        fixture.chat("ses-active", "running", None);
        fixture
            .agent
            .execute(
                "UPDATE turn_usage SET started_at=?1",
                [(fixture.now - 1000) as i64],
            )
            .unwrap();
        let service = ZCodeTaskService::from_path(fixture.root.clone());
        assert_eq!(service.read_snapshot().tasks[0].state, TaskState::Running);
    }

    #[test]
    #[ignore = "requires existing local ZCode installation and task databases; read-only"]
    fn live_zcode_read_only_smoke() {
        let service = ZCodeTaskService::from_environment();
        assert!(service.home.join("v2/tasks-index.sqlite").is_file());
        let snapshot = service.read_snapshot();
        assert!(snapshot.diagnostic.is_none(), "{:?}", snapshot.diagnostic);
        eprintln!(
            "LIVE_ZCODE_READ_ONLY: {}",
            serde_json::json!({"tasks":snapshot.tasks.len(),"running":snapshot.tasks.iter().filter(|t|t.state==TaskState::Running).count(),"waiting":snapshot.tasks.iter().filter(|t|t.state==TaskState::Waiting).count(),"failed":snapshot.tasks.iter().filter(|t|t.state==TaskState::Failed).count(),"diagnostic":snapshot.diagnostic})
        );
    }
}

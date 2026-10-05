use crate::capacity::Diagnostic;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::oneshot,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceTaskSnapshot {
    pub tasks: Vec<ChatTask>,
    pub observed_at_ms: u64,
    pub diagnostic: Option<Diagnostic>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskSource {
    Codex,
    Zcode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSourceStatus {
    pub source: TaskSource,
    pub observed_at_ms: u64,
    pub health: &'static str,
    pub diagnostic: Option<Diagnostic>,
}

impl TaskSourceStatus {
    fn from_snapshot(source: TaskSource, snapshot: &SourceTaskSnapshot) -> Self {
        Self {
            source,
            observed_at_ms: snapshot.observed_at_ms,
            health: match snapshot.diagnostic.as_ref() {
                Some(d) if d.code == "QDT-600" => "loading",
                Some(_) => "unavailable",
                None => "ready",
            },
            diagnostic: snapshot.diagnostic.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatusSnapshot {
    pub tasks: Vec<ChatTask>,
    pub sources: Vec<TaskSourceStatus>,
    // This aggregate is only the initial-load marker; freshness belongs to each source.
    pub observed_at_ms: u64,
    // Only shared failures belong here. Collector failures stay with their source.
    pub diagnostic: Option<Diagnostic>,
}

pub struct TaskStatusService {
    zcode: Option<crate::zcode_tasks::ZCodeTaskService>,
    snapshot: Arc<Mutex<SourceTaskSnapshot>>,
    reminders: Mutex<Result<HashMap<String, String>, Diagnostic>>,
    reminders_path: PathBuf,
    stop: Option<oneshot::Sender<()>>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn desktop_endpoint(home: &Path) -> String {
    #[cfg(windows)]
    {
        let _ = home;
        r"\\.\pipe\codex-ipc".to_owned()
    }
    #[cfg(unix)]
    {
        home.join("ipc/ipc.sock").to_string_lossy().into_owned()
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = home;
        String::new()
    }
}

fn runtime_state(state: &Value, turn_id: &str) -> TaskState {
    if state["threadRuntimeStatus"]["type"] != "active" {
        return TaskState::Unknown;
    }
    let Some(flags) = state["threadRuntimeStatus"]["activeFlags"].as_array() else {
        return TaskState::Unknown;
    };
    if flags
        .iter()
        .any(|flag| flag != "waitingOnApproval" && flag != "waitingOnUserInput")
    {
        return TaskState::Unknown;
    }
    let waiting_request = state["requests"].as_array().is_some_and(|requests| {
        requests.iter().any(|request| {
            request["completed"] != true
                && request["turnId"].as_str().is_none_or(|id| id == turn_id)
                && matches!(
                    request["method"].as_str(),
                    Some(
                        "item/commandExecution/requestApproval"
                            | "item/fileChange/requestApproval"
                            | "item/permissions/requestApproval"
                            | "mcpServer/elicitation/request"
                            | "item/tool/requestUserInput"
                            | "item/tool/requestOptionPicker"
                    )
                )
        })
    });
    if !flags.is_empty() || waiting_request {
        TaskState::Waiting
    } else {
        TaskState::Running
    }
}

impl TaskStatusService {
    pub fn from_environment(app: &tauri::AppHandle) -> Self {
        use tauri::Manager;
        let home = std::env::var_os("CODEX_SQLITE_HOME")
            .or_else(|| std::env::var_os("CODEX_HOME"))
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(
                    std::env::var_os("USERPROFILE")
                        .or_else(|| std::env::var_os("HOME"))
                        .unwrap_or_default(),
                )
                .join(".codex")
            });
        let config = std::env::var_os("CODEX_CREDITS_CONFIG_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                app.path()
                    .app_config_dir()
                    .unwrap_or_else(|_| PathBuf::from("."))
            });
        let endpoint =
            std::env::var("QUODEX_TASK_IPC_ENDPOINT").unwrap_or_else(|_| desktop_endpoint(&home));
        let mut service = Self::from_paths(home, config.join("task-reminders.json"), endpoint);
        service.zcode = Some(crate::zcode_tasks::ZCodeTaskService::from_environment());
        service
    }
    pub fn from_paths(home: PathBuf, reminders_path: PathBuf, endpoint: String) -> Self {
        let reminders = match std::fs::read(&reminders_path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
                Diagnostic::new(
                    "QDT-613",
                    "提醒记录格式损坏；保留原文件，请检查 QuoDex 配置目录",
                )
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
            Err(_) => Err(Diagnostic::new(
                "QDT-613",
                "无法读取提醒记录；请检查 QuoDex 配置目录权限",
            )),
        };
        let snapshot = Arc::new(Mutex::new(SourceTaskSnapshot {
            tasks: vec![],
            observed_at_ms: now_ms(),
            diagnostic: Some(Diagnostic::new("QDT-600", "正在连接 Codex 任务状态")),
        }));
        let (stop, mut stopped) = oneshot::channel();
        let shared = snapshot.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                #[cfg(any(windows, unix))]
                let result = observe_desktop(&home, &endpoint, &shared, &mut stopped).await;
                #[cfg(not(any(windows, unix)))]
                let result: Result<(), Diagnostic> = Err(Diagnostic::new(
                    "QDT-601",
                    "当前平台无法连接 Codex 桌面任务状态",
                ));
                match result {
                    Ok(()) => break,
                    Err(diagnostic) => {
                        let mut snapshot = shared.lock().expect("task snapshot lock");
                        snapshot
                            .tasks
                            .retain(|task| !expired_completion(task, now_ms()));
                        for task in &mut snapshot.tasks {
                            if matches!(task.state, TaskState::Completed | TaskState::Failed) {
                                continue;
                            }
                            task.state = TaskState::Unknown;
                            task.detail =
                                Some(format!("{} · {}", diagnostic.message, diagnostic.code));
                        }
                        snapshot.diagnostic = Some(diagnostic);
                        snapshot.observed_at_ms = now_ms();
                    }
                }
                tokio::select! { _ = tokio::time::sleep(Duration::from_secs(2)) => {}, _ = &mut stopped => break }
            }
        });
        Self {
            zcode: None,
            snapshot,
            reminders: Mutex::new(reminders),
            reminders_path,
            stop: Some(stop),
        }
    }

    pub fn read_snapshot(&self) -> TaskStatusSnapshot {
        let mut snapshot = self.snapshot.lock().expect("task snapshot lock").clone();
        let mut sources = vec![TaskSourceStatus::from_snapshot(
            TaskSource::Codex,
            &snapshot,
        )];
        let extra = self
            .zcode
            .as_ref()
            .map(|source| source.read_snapshot())
            .unwrap_or(SourceTaskSnapshot {
                tasks: vec![],
                observed_at_ms: 0,
                diagnostic: None,
            });
        sources.push(TaskSourceStatus::from_snapshot(TaskSource::Zcode, &extra));
        snapshot.tasks.extend(extra.tasks);
        snapshot.observed_at_ms = snapshot.observed_at_ms.max(extra.observed_at_ms);
        snapshot.diagnostic = None;
        let reminders = self.reminders.lock().expect("task reminders lock");
        snapshot.tasks.retain(|task| {
            !(matches!(task.state, TaskState::Failed | TaskState::Unknown)
                && reminders
                    .as_ref()
                    .is_ok_and(|items| items.get(&task.id) == Some(&task.turn_id)))
                && !expired_completion(task, now_ms())
        });
        for task in &mut snapshot.tasks {
            if task.state == TaskState::Completed
                && task.completed_at_ms.is_none_or(|ended| ended > now_ms())
            {
                task.state = TaskState::Unknown;
                task.detail = Some("结束时间暂不可用；等待同步后自动恢复 · QDT-608".into());
            }
        }
        if let Err(diagnostic) = &*reminders {
            snapshot.diagnostic = Some(diagnostic.clone());
        }
        sort_tasks(&mut snapshot.tasks);
        TaskStatusSnapshot {
            tasks: snapshot.tasks,
            sources,
            observed_at_ms: snapshot.observed_at_ms,
            diagnostic: snapshot.diagnostic,
        }
    }

    pub fn zcode_project_url(&self, id: &str) -> Result<tauri::Url, Diagnostic> {
        self.zcode
            .as_ref()
            .ok_or_else(|| Diagnostic::new("QDT-624", "ZCode 任务来源不可用；请重新打开 QuoDex"))?
            .project_url(id)
    }

    pub fn dismiss_failure(&self, id: &str, turn_id: &str) -> Result<(), Diagnostic> {
        if !self
            .read_snapshot()
            .tasks
            .iter()
            .any(|task| task.id == id && task.turn_id == turn_id && task.state == TaskState::Failed)
        {
            return Err(Diagnostic::new(
                "QDT-613",
                "提醒已更新；请刷新后移除当前报错提醒",
            ));
        }
        let mut reminders = self.reminders.lock().expect("task reminders lock");
        let mut next = reminders.as_ref().map_err(Clone::clone)?.clone();
        next.insert(id.to_owned(), turn_id.to_owned());
        let persist = || -> Result<(), std::io::Error> {
            if let Some(parent) = self.reminders_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let temporary = self.reminders_path.with_extension("pending");
            std::fs::write(&temporary, serde_json::to_vec(&next)?)?;
            std::fs::rename(temporary, &self.reminders_path)
        };
        persist().map_err(|_| {
            Diagnostic::new(
                "QDT-613",
                "无法保存移除操作；请检查 QuoDex 配置目录权限后重试",
            )
        })?;
        *reminders = Ok(next);
        Ok(())
    }
}

impl Drop for TaskStatusService {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
    }
}

#[cfg(any(windows, unix))]
async fn send<W: tokio::io::AsyncWrite + Unpin>(
    pipe: &mut W,
    message: Value,
) -> Result<(), Diagnostic> {
    let bytes = serde_json::to_vec(&message)
        .map_err(|_| Diagnostic::new("QDT-604", "任务状态请求格式错误；请更新 QuoDex"))?;
    tokio::time::timeout(Duration::from_secs(1), async {
        pipe.write_u32_le(bytes.len() as u32).await?;
        pipe.write_all(&bytes).await
    })
    .await
    .map_err(|_| Diagnostic::new("QDT-601", "Codex 状态通道响应超时；稍后自动重连"))?
    .map_err(|_| Diagnostic::new("QDT-601", "Codex 状态通道已断开；启动 Codex 后自动重连"))
}

#[cfg(any(windows, unix))]
fn follow(client: &str, owner: &str, id: &str, following: bool) -> Value {
    json!({"type":"broadcast","method":"thread-stream-following-changed","sourceClientId":client,"targetClientIds":[owner],"version":1,"params":{"hostId":"local","conversationId":id,"following":following}})
}

#[cfg(any(windows, unix))]
fn mark_task_unavailable(live: &mut HashMap<String, ChatTask>, id: &str, message: &str) {
    if let Some(task) = live.get_mut(id) {
        task.state = TaskState::Unknown;
        task.completed_at_ms = None;
        task.detail = Some(format!("{message} · QDT-607"));
    }
}

fn publish_tasks(
    shared: &Arc<Mutex<SourceTaskSnapshot>>,
    candidates: &HashMap<String, StoredChat>,
    live: &HashMap<String, ChatTask>,
    idle: &HashSet<String>,
    resolved: &HashSet<String>,
    excluded: &HashSet<String>,
) {
    let mut tasks = live.clone();
    for (id, chat) in candidates {
        if excluded.contains(id) || chat.cancelled {
            continue;
        }
        let is_terminal = matches!(chat.task.state, TaskState::Completed | TaskState::Failed);
        if idle.contains(id)
            && tasks
                .get(id)
                .is_some_and(|task| task.turn_id == chat.task.turn_id)
            && is_terminal
        {
            tasks.insert(id.clone(), chat.task.clone());
        } else if chat.desktop_origin
            && !tasks.contains_key(id)
            && resolved.contains(id)
            && (is_terminal
                || (chat.started_at_ms > 0
                    && chat.updated_at >= (now_ms() / 1000).saturating_sub(1800) as i64))
        {
            let mut task = chat.task.clone();
            if task.state == TaskState::Unknown {
                task.detail = Some("聊天执行来源暂不可用；打开 Codex 后自动同步 · QDT-607".into());
            }
            tasks.insert(id.clone(), task);
        }
    }
    let mut snapshot = shared.lock().expect("task snapshot lock");
    snapshot.tasks = tasks.into_values().collect();
    snapshot
        .tasks
        .retain(|task| !expired_completion(task, now_ms()));
    sort_tasks(&mut snapshot.tasks);
    snapshot.observed_at_ms = now_ms();
    snapshot.diagnostic = None;
}

fn sort_tasks(tasks: &mut [ChatTask]) {
    tasks.sort_by(|a, b| {
        let rank = |state| match state {
            TaskState::Running => 0,
            TaskState::Waiting => 1,
            TaskState::Failed => 2,
            TaskState::Unknown => 3,
            TaskState::Completed => 4,
        };
        rank(a.state)
            .cmp(&rank(b.state))
            .then_with(|| b.completed_at_ms.cmp(&a.completed_at_ms))
            .then_with(|| a.id.cmp(&b.id))
    });
}

fn expired_completion(task: &ChatTask, now: u64) -> bool {
    task.expires_at_ms.is_some_and(|deadline| now >= deadline)
        || task.state == TaskState::Completed
            && task
                .completed_at_ms
                .is_some_and(|ended| now.saturating_sub(ended) >= 1_800_000)
}

#[cfg(any(windows, unix))]
async fn observe_desktop(
    home: &Path,
    endpoint: &str,
    shared: &Arc<Mutex<SourceTaskSnapshot>>,
    stopped: &mut oneshot::Receiver<()>,
) -> Result<(), Diagnostic> {
    let chats = read_task_history(home)?;
    let mut candidates: HashMap<_, _> = chats
        .into_iter()
        .map(|chat| (chat.task.id.clone(), chat))
        .collect();
    #[cfg(windows)]
    let connection = tokio::net::windows::named_pipe::ClientOptions::new().open(endpoint);
    #[cfg(unix)]
    let connection = tokio::time::timeout(
        Duration::from_secs(1),
        tokio::net::UnixStream::connect(endpoint),
    )
    .await
    .map_err(|_| Diagnostic::new("QDT-601", "Codex 状态通道连接超时；稍后自动重连"))?;
    let mut pipe = connection.map_err(|_| {
        Diagnostic::new("QDT-601", "无法连接 Codex 桌面应用；启动 Codex 后自动重连")
    })?;
    let initialize_id = uuid::Uuid::new_v4().to_string();
    send(&mut pipe, json!({"type":"request","requestId":initialize_id,"sourceClientId":"initializing-client","method":"initialize","version":0,"params":{"clientType":"quodex"},"timeoutMs":1500})).await?;
    let mut client = String::new();
    let mut pending: HashMap<String, (String, Instant)> = HashMap::new();
    let mut owners: HashMap<String, String> = HashMap::new();
    let mut live: HashMap<String, ChatTask> = HashMap::new();
    let mut revisions: HashMap<String, u64> = HashMap::new();
    let mut idle = HashSet::new();
    let mut resolved = HashSet::new();
    let mut excluded = HashSet::new();
    let mut last_discovery: HashMap<String, Instant> = HashMap::new();
    let mut fresh: HashMap<String, Instant> = HashMap::new();
    let mut awaiting: HashMap<String, Instant> = HashMap::new();
    let connected_at = Instant::now();
    let mut refresh = tokio::time::interval(Duration::from_secs(2));
    let mut buffered = Vec::new();
    let mut chunk = vec![0; 16_384];
    enum DesktopEvent {
        Refresh,
        Stopped,
        Read(std::io::Result<usize>),
    }
    loop {
        let event = tokio::select! {
            _ = refresh.tick() => DesktopEvent::Refresh,
            _ = &mut *stopped => DesktopEvent::Stopped,
            read = pipe.read(&mut chunk) => DesktopEvent::Read(read),
        };
        match event {
            DesktopEvent::Refresh => {
                if client.is_empty() {
                    if connected_at.elapsed() > Duration::from_secs(3) {
                        return Err(Diagnostic::new("QDT-601", "Codex 初始化超时；稍后自动重连"));
                    }
                    continue;
                }
                // Owner discovery and snapshot deadlines belong to individual chats.
                // A closed historical chat must not tear down healthy subscriptions.
                let expired_pending: Vec<_> = pending
                    .iter()
                    .filter(|(_, (_, started))| started.elapsed() > Duration::from_secs(3))
                    .map(|(request, (id, _))| (request.clone(), id.clone()))
                    .collect();
                let expired_awaiting: Vec<_> = awaiting
                    .iter()
                    .filter(|(_, started)| started.elapsed() > Duration::from_secs(3))
                    .map(|(id, _)| id.clone())
                    .collect();
                let invalidated = !expired_pending.is_empty() || !expired_awaiting.is_empty();
                for (request, id) in expired_pending {
                    pending.remove(&request);
                    idle.remove(&id);
                    mark_task_unavailable(&mut live, &id, "聊天执行来源查询超时；稍后自动重新查询");
                }
                for id in expired_awaiting {
                    awaiting.remove(&id);
                    if let Some(owner) = owners.remove(&id) {
                        send(&mut pipe, follow(&client, &owner, &id, false)).await?;
                    }
                    fresh.remove(&id);
                    revisions.remove(&id);
                    idle.remove(&id);
                    last_discovery.remove(&id);
                    if let Some(chat) = candidates.get(&id) {
                        live.entry(id.clone()).or_insert_with(|| chat.task.clone());
                    }
                    mark_task_unavailable(&mut live, &id, "聊天执行来源未响应；稍后自动重新同步");
                }
                if invalidated {
                    publish_tasks(shared, &candidates, &live, &idle, &resolved, &excluded);
                }
                candidates = read_task_history(home)?
                    .into_iter()
                    .map(|chat| (chat.task.id.clone(), chat))
                    .collect();
                let removed: Vec<_> = owners
                    .keys()
                    .filter(|id| !candidates.contains_key(*id))
                    .cloned()
                    .collect();
                for id in removed {
                    if let Some(owner) = owners.remove(&id) {
                        send(&mut pipe, follow(&client, &owner, &id, false)).await?;
                    }
                    live.remove(&id);
                    fresh.remove(&id);
                    awaiting.remove(&id);
                    revisions.remove(&id);
                    idle.remove(&id);
                    excluded.remove(&id);
                    resolved.remove(&id);
                }
                for id in candidates.keys() {
                    if let Some(owner) = owners.get(id) {
                        if !awaiting.contains_key(id)
                            && fresh
                                .get(id)
                                .is_none_or(|seen| seen.elapsed() >= Duration::from_secs(15))
                        {
                            send(&mut pipe, follow(&client, owner, id, true)).await?;
                            awaiting.insert(id.clone(), Instant::now());
                        }
                    } else if !pending.values().any(|(pending_id, _)| pending_id == id)
                        && last_discovery
                            .get(id)
                            .is_none_or(|seen| seen.elapsed() >= Duration::from_secs(10))
                    {
                        let request_id = uuid::Uuid::new_v4().to_string();
                        pending.insert(request_id.clone(), (id.clone(), Instant::now()));
                        last_discovery.insert(id.clone(), Instant::now());
                        send(&mut pipe, json!({"type":"request","requestId":request_id,"sourceClientId":client,"method":"thread-owner-discovery","version":1,"params":{"hostId":"local","conversationId":id},"timeoutMs":1500})).await?;
                    }
                }
                if pending.is_empty() && awaiting.is_empty() {
                    publish_tasks(shared, &candidates, &live, &idle, &resolved, &excluded);
                }
            }
            DesktopEvent::Stopped => {
                for (id, owner) in &owners {
                    let _ = send(&mut pipe, follow(&client, owner, id, false)).await;
                }
                return Ok(());
            }
            DesktopEvent::Read(read) => {
                let count = read.map_err(|_| {
                    Diagnostic::new("QDT-601", "Codex 状态通道已断开；稍后自动重连")
                })?;
                if count == 0 {
                    return Err(Diagnostic::new(
                        "QDT-601",
                        "Codex 桌面应用已断开；启动后自动重连",
                    ));
                }
                buffered.extend_from_slice(&chunk[..count]);
                while buffered.len() >= 4 {
                    let length = u32::from_le_bytes(buffered[..4].try_into().expect("frame header"))
                        as usize;
                    // Match Desktop's frame ceiling, including long canonical histories.
                    if length == 0 || length > 256 * 1024 * 1024 {
                        return Err(Diagnostic::new(
                            "QDT-606",
                            "聊天状态快照超过安全容量；请更新适配器",
                        ));
                    }
                    if buffered.len() < length + 4 {
                        break;
                    }
                    let message: Value =
                        serde_json::from_slice(&buffered[4..length + 4]).map_err(|_| {
                            Diagnostic::new("QDT-604", "Codex 状态消息格式不受支持；请更新 QuoDex")
                        })?;
                    buffered.drain(..length + 4);
                    if message["type"] == "client-discovery-request" {
                        send(&mut pipe, json!({"type":"client-discovery-response","requestId":message["requestId"],"response":{"canHandle":false}})).await?;
                    } else if message["type"] == "response" && message["requestId"] == initialize_id
                    {
                        if !client.is_empty()
                            || message["resultType"] != "success"
                            || message["method"] != "initialize"
                        {
                            return Err(Diagnostic::new(
                                "QDT-605",
                                "Codex 初始化协议不受支持；请更新 QuoDex",
                            ));
                        }
                        client = message["result"]["clientId"]
                            .as_str()
                            .filter(|id| !id.is_empty())
                            .ok_or_else(|| {
                                Diagnostic::new(
                                    "QDT-605",
                                    "Codex 桌面状态协议不兼容；请更新 QuoDex",
                                )
                            })?
                            .into();
                        for id in candidates.keys() {
                            let request_id = uuid::Uuid::new_v4().to_string();
                            pending.insert(request_id.clone(), (id.clone(), Instant::now()));
                            last_discovery.insert(id.clone(), Instant::now());
                            send(&mut pipe, json!({"type":"request","requestId":request_id,"sourceClientId":client,"method":"thread-owner-discovery","version":1,"params":{"hostId":"local","conversationId":id},"timeoutMs":1500})).await?;
                        }
                        if candidates.is_empty() {
                            publish_tasks(shared, &candidates, &live, &idle, &resolved, &excluded);
                        }
                    } else if message["type"] == "response" {
                        if let Some((id, _)) = message["requestId"]
                            .as_str()
                            .and_then(|request| pending.remove(request))
                        {
                            // Router-level errors omit method; the UUID still identifies our request.
                            if (message["resultType"] == "success"
                                && message["method"] != "thread-owner-discovery")
                                || message["method"]
                                    .as_str()
                                    .is_some_and(|method| method != "thread-owner-discovery")
                            {
                                return Err(Diagnostic::new(
                                    "QDT-605",
                                    "聊天来源协议不受支持；请更新 QuoDex",
                                ));
                            }
                            resolved.insert(id.clone());
                            if message["resultType"] == "success" {
                                let owner = message["handledByClientId"]
                                    .as_str()
                                    .ok_or_else(|| {
                                        Diagnostic::new(
                                            "QDT-605",
                                            "Codex 未返回聊天状态来源；请更新适配器",
                                        )
                                    })?
                                    .to_string();
                                owners.insert(id.clone(), owner.clone());
                                send(&mut pipe, follow(&client, &owner, &id, true)).await?;
                                awaiting.insert(id, Instant::now());
                            } else if message["error"] != "no-client-found"
                                && message["error"]["code"] != "no-client-found"
                            {
                                resolved.remove(&id);
                                idle.remove(&id);
                                mark_task_unavailable(
                                    &mut live,
                                    &id,
                                    "聊天执行来源查询失败；稍后自动重新查询",
                                );
                                publish_tasks(
                                    shared,
                                    &candidates,
                                    &live,
                                    &idle,
                                    &resolved,
                                    &excluded,
                                );
                            }
                            if pending.is_empty() && awaiting.is_empty() {
                                publish_tasks(
                                    shared,
                                    &candidates,
                                    &live,
                                    &idle,
                                    &resolved,
                                    &excluded,
                                );
                            }
                        }
                    } else if message["type"] == "broadcast"
                        && message["method"] == "client-status-changed"
                        && message["params"]["status"] == "disconnected"
                    {
                        let disconnected = message["params"]["clientId"].as_str();
                        let lost: Vec<_> = owners
                            .iter()
                            .filter(|(_, owner)| Some(owner.as_str()) == disconnected)
                            .map(|(id, _)| id.clone())
                            .collect();
                        for id in lost {
                            owners.remove(&id);
                            fresh.remove(&id);
                            awaiting.remove(&id);
                            revisions.remove(&id);
                            resolved.remove(&id);
                            idle.remove(&id);
                            last_discovery.remove(&id);
                            if let Some(task) = live.get_mut(&id) {
                                task.state = TaskState::Unknown;
                                task.detail =
                                    Some("聊天执行来源已断开；稍后自动同步 · QDT-607".into());
                            }
                        }
                        publish_tasks(shared, &candidates, &live, &idle, &resolved, &excluded);
                    } else if message["type"] == "broadcast"
                        && message["method"] == "thread-stream-state-changed"
                    {
                        let params = &message["params"];
                        let Some(id) = params["conversationId"].as_str() else {
                            continue;
                        };
                        if params["hostId"] != "local"
                            || owners.get(id).map(String::as_str)
                                != message["sourceClientId"].as_str()
                            || !message["targetClientIds"]
                                .as_array()
                                .is_some_and(|ids| ids.iter().any(|value| value == &client))
                        {
                            continue;
                        }
                        if message["version"] != 11 {
                            return Err(Diagnostic::new(
                                "QDT-605",
                                "Codex 状态协议版本已改变；请更新 QuoDex",
                            ));
                        }
                        let change = &params["change"];
                        if change["type"] == "patches" {
                            let baseline_matches = change["baseRevision"]
                                .as_u64()
                                .is_some_and(|base| revisions.get(id) == Some(&base));
                            let next_revision = change["revision"].as_u64().ok_or_else(|| {
                                Diagnostic::new("QDT-605", "聊天状态版本缺失；请更新 QuoDex")
                            })?;
                            let patches = change["patches"].as_array().ok_or_else(|| {
                                Diagnostic::new(
                                    "QDT-605",
                                    "聊天状态补丁格式不受支持；请更新 QuoDex",
                                )
                            })?;
                            let mut metadata_changed = !baseline_matches
                                || change["baseRevision"]
                                    .as_u64()
                                    .is_none_or(|base| next_revision <= base);
                            for patch in patches {
                                let path = patch["path"].as_array().ok_or_else(|| {
                                    Diagnostic::new(
                                        "QDT-605",
                                        "聊天状态补丁路径不受支持；请更新 QuoDex",
                                    )
                                })?;
                                if !matches!(
                                    patch["op"].as_str(),
                                    Some("add" | "replace" | "remove")
                                ) {
                                    return Err(Diagnostic::new(
                                        "QDT-605",
                                        "聊天状态补丁操作不受支持；请更新 QuoDex",
                                    ));
                                }
                                if !path.iter().any(|part| {
                                    part == "items" || part == "content" || part == "text"
                                }) && (path.is_empty()
                                    || matches!(
                                        path[0].as_str(),
                                        Some(
                                            "threadRuntimeStatus"
                                                | "requests"
                                                | "turns"
                                                | "turnHistory"
                                                | "title"
                                                | "ephemeral"
                                                | "sideConversation"
                                                | "parentThreadId"
                                        )
                                    ))
                                {
                                    metadata_changed = true;
                                }
                            }
                            revisions.insert(id.to_owned(), next_revision);
                            if metadata_changed {
                                if let Some(task) = live.get_mut(id) {
                                    task.state = TaskState::Unknown;
                                    task.detail =
                                        Some("状态正在重新同步；稍后自动恢复 · QDT-607".into());
                                }
                                {
                                    let mut snapshot = shared.lock().expect("task snapshot lock");
                                    snapshot.tasks = live.values().cloned().collect();
                                    snapshot.observed_at_ms = now_ms();
                                }
                                send(&mut pipe, follow(&client, &owners[id], id, true)).await?;
                                awaiting.entry(id.to_owned()).or_insert_with(Instant::now);
                            }
                            continue;
                        }
                        if change["type"] != "snapshot" {
                            return Err(Diagnostic::new(
                                "QDT-605",
                                "聊天状态消息类型不受支持；请更新 QuoDex",
                            ));
                        }
                        let revision = change["revision"].as_u64().ok_or_else(|| {
                            Diagnostic::new("QDT-605", "聊天状态快照版本缺失；请更新 QuoDex")
                        })?;
                        if revisions.get(id).is_some_and(|old| revision < *old) {
                            continue;
                        }
                        revisions.insert(id.to_owned(), revision);
                        fresh.insert(id.to_owned(), Instant::now());
                        awaiting.remove(id);
                        let state = &change["conversationState"];
                        if state["id"] != id {
                            return Err(Diagnostic::new(
                                "QDT-605",
                                "聊天状态身份不匹配；请更新适配器",
                            ));
                        }
                        if state["ephemeral"] == true
                            || state["sideConversation"] == true
                            || state["parentThreadId"].as_str().is_some()
                        {
                            excluded.insert(id.to_owned());
                            live.remove(id);
                            publish_tasks(shared, &candidates, &live, &idle, &resolved, &excluded);
                            continue;
                        }
                        excluded.remove(id);
                        let mut task = candidates[id].task.clone();
                        task.title = state["title"].as_str().unwrap_or(&task.title).to_owned();
                        let latest_turn = state["turnHistory"]["history"]["entitiesByKey"]
                            .as_object()
                            .and_then(|entities| {
                                entities.values().max_by_key(|turn| {
                                    turn["turnStartedAtMs"].as_u64().unwrap_or(0)
                                })
                            })
                            .or_else(|| {
                                state["turns"].as_array().and_then(|turns| {
                                    turns.iter().max_by_key(|turn| {
                                        turn["turnStartedAtMs"].as_u64().unwrap_or(0)
                                    })
                                })
                            });
                        if let Some(turn) = latest_turn {
                            task.turn_id =
                                turn["turnId"].as_str().unwrap_or(&task.turn_id).to_owned();
                        }
                        if state["threadRuntimeStatus"]["type"] == "idle"
                            && (latest_turn.is_some_and(|turn| turn["status"] == "interrupted")
                                || (candidates[id].cancelled
                                    && task.turn_id == candidates[id].task.turn_id))
                        {
                            live.remove(id);
                            excluded.insert(id.to_owned());
                            publish_tasks(shared, &candidates, &live, &idle, &resolved, &excluded);
                            continue;
                        }
                        task.state = runtime_state(state, &task.turn_id);
                        task.completed_at_ms = None;
                        task.expires_at_ms = None;
                        task.detail = match task.state {
                            TaskState::Waiting => {
                                Some("等待批准或补充信息；点击打开聊天处理".into())
                            }
                            TaskState::Unknown => {
                                Some("暂时无法确认执行状态；等待同步或更新 QuoDex · QDT-605".into())
                            }
                            _ => None,
                        };
                        let stored = &candidates[id].task;
                        if let Some(turn) = latest_turn.filter(|turn| {
                            state["threadRuntimeStatus"]["type"] == "idle"
                                && matches!(turn["status"].as_str(), Some("completed" | "failed"))
                        }) {
                            // Desktop can own a newer turn than the persisted history projection.
                            task.state = if turn["status"] == "failed" {
                                TaskState::Failed
                            } else {
                                TaskState::Completed
                            };
                            task.completed_at_ms = turn["turnStartedAtMs"]
                                .as_u64()
                                .zip(turn["durationMs"].as_u64())
                                .and_then(|(started, duration)| started.checked_add(duration))
                                .filter(|ended| *ended <= now_ms());
                            task.expires_at_ms = if task.state == TaskState::Completed {
                                task.completed_at_ms
                                    .and_then(|ended| ended.checked_add(1_800_000))
                            } else {
                                None
                            };
                            task.detail = if task.state == TaskState::Failed {
                                Some(format!(
                                    "{} · QDT-610",
                                    turn["error"]["message"]
                                        .as_str()
                                        .map(|message| message
                                            .chars()
                                            .take(240)
                                            .collect::<String>())
                                        .unwrap_or_else(
                                            || "本轮执行失败；打开聊天查看原因并重试".into()
                                        )
                                ))
                            } else {
                                None
                            };
                        }
                        if state["threadRuntimeStatus"]["type"] == "idle"
                            && task.turn_id == stored.turn_id
                            && matches!(stored.state, TaskState::Completed | TaskState::Failed)
                            && task.completed_at_ms.is_none()
                        {
                            task.state = stored.state;
                            task.completed_at_ms = stored.completed_at_ms;
                            task.expires_at_ms = stored.expires_at_ms;
                            task.detail = stored.detail.clone();
                        }
                        live.insert(id.to_owned(), task);
                        if state["threadRuntimeStatus"]["type"] == "idle" {
                            idle.insert(id.to_owned());
                        } else {
                            idle.remove(id);
                        }
                        publish_tasks(shared, &candidates, &live, &idle, &resolved, &excluded);
                    }
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskState {
    Running,
    Waiting,
    Completed,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTask {
    pub source: TaskSource,
    pub id: String,
    pub turn_id: String,
    pub title: String,
    pub state: TaskState,
    pub completed_at_ms: Option<u64>,
    // Preserve a successful reminder's deadline while the source is unknown.
    #[serde(default)]
    pub expires_at_ms: Option<u64>,
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StoredChat {
    pub task: ChatTask,
    pub started_at_ms: u64,
    pub updated_at: i64,
    pub cancelled: bool,
    pub desktop_origin: bool,
}

pub(crate) fn directory_name(path: &str) -> Option<String> {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.trim().is_empty() && !name.ends_with(':'))
        .map(str::to_owned)
}

fn project_name(metadata: &Value, id: &str, cwd: Option<&str>) -> Option<String> {
    let projects = &metadata["local-projects"];
    let assignment = &metadata["thread-project-assignments"][id];
    let saved = |project: &Value| {
        project["name"]
            .as_str()
            .filter(|name| !name.trim().is_empty())
            .map(str::to_owned)
    };
    if assignment["projectKind"] == "local" {
        if let Some(name) = assignment["projectId"]
            .as_str()
            .and_then(|id| saved(&projects[id]))
        {
            return Some(name);
        }
    }
    let cwd = cwd?;
    let normalize = |path: &str| path.replace('\\', "/").trim_end_matches('/').to_lowercase();
    let normalized = normalize(cwd);
    let mut matched: Option<(usize, String)> = None;
    if let Some(projects) = projects.as_object() {
        for project in projects.values() {
            let (Some(name), Some(roots)) = (saved(project), project["rootPaths"].as_array())
            else {
                continue;
            };
            for root in roots.iter().filter_map(Value::as_str) {
                let root = normalize(root);
                if !root.is_empty()
                    && (normalized == root || normalized.starts_with(&(root.clone() + "/")))
                    && matched
                        .as_ref()
                        .is_none_or(|(length, _)| root.len() > *length)
                {
                    matched = Some((root.len(), name.clone()));
                }
            }
        }
    }
    matched
        .map(|(_, name)| name)
        .or_else(|| directory_name(cwd))
}

/// Only thread/turn metadata is read. Connections cannot create or write Codex files.
pub fn read_task_history(home: &Path) -> Result<Vec<StoredChat>, Diagnostic> {
    let open = |name: &str| -> Result<Connection, Diagnostic> {
        let connection =
            Connection::open_with_flags(home.join(name), OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|_| {
                    Diagnostic::new(
                        "QDT-602",
                        "无法读取 Codex 任务数据库；启动或更新 Codex 后重试",
                    )
                })?;
        connection
            .busy_timeout(Duration::from_millis(100))
            .map_err(|_| Diagnostic::new("QDT-602", "任务数据库暂时被占用，稍后自动重试"))?;
        Ok(connection)
    };
    let state = open("state_5.sqlite")?;
    let history = open("thread_history_1.sqlite")?;
    let schema_error = || {
        Diagnostic::new(
            "QDT-603",
            "Codex 任务数据库格式不受支持；请更新 QuoDex 适配器",
        )
    };
    let mut turns = history.prepare("SELECT thread_id,turn_id,status,started_at,completed_at,error_json FROM (
      SELECT *,ROW_NUMBER() OVER(PARTITION BY thread_id ORDER BY COALESCE(started_at,0) DESC,rollout_ordinal DESC,turn_id DESC) AS last_turn
      FROM thread_turns) WHERE last_turn=1").map_err(|_| schema_error())?;
    let rows = turns
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|_| schema_error())?;
    let mut latest = HashMap::new();
    for row in rows {
        let (id, turn, status, started, completed, error) = row.map_err(|_| schema_error())?;
        latest.insert(id, (turn, status, started, completed, error));
    }
    // Imported CLI chats can be owned by Desktop now; only an actual owner proves live scope.
    let has_cwd = state
        .prepare("PRAGMA table_info(threads)")
        .map_err(|_| schema_error())?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|_| schema_error())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| schema_error())?
        .iter()
        .any(|name| name == "cwd");
    // Older metadata schemas have no cwd. Missing display labels must not break status reading.
    let query = format!("SELECT id,title,updated_at,COALESCE(source='vscode' AND originator='Codex Desktop',0),{} FROM threads
      WHERE id NOT IN(SELECT child_thread_id FROM thread_spawn_edges) ORDER BY updated_at DESC,id ASC", if has_cwd { "cwd" } else { "NULL" });
    let mut candidates = state.prepare(&query).map_err(|_| schema_error())?;
    let metadata = std::fs::read(home.join(".codex-global-state.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .unwrap_or(Value::Null);
    let rows = candidates
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(|_| schema_error())?;
    let mut result = Vec::new();
    for row in rows {
        let (id, title, updated_at, desktop_origin, cwd) = row.map_err(|_| schema_error())?;
        let (turn_id, status, started, completed, error) = latest.remove(&id).unwrap_or_default();
        let completed_at_ms = completed
            .and_then(|seconds| u64::try_from(seconds).ok())
            .and_then(|seconds| seconds.checked_mul(1000));
        let state = match status.as_str() {
            "completed" if completed_at_ms.is_some() => TaskState::Completed,
            "failed" => TaskState::Failed,
            _ => TaskState::Unknown,
        };
        let detail = if state == TaskState::Failed {
            Some(
                error
                    .as_deref()
                    .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
                    .and_then(|value| {
                        value
                            .get("message")
                            .and_then(|message| message.as_str())
                            .map(|message| message.chars().take(240).collect::<String>())
                    })
                    .unwrap_or_else(|| "本轮执行失败；打开聊天查看原因并重试".into())
                    + " · QDT-610",
            )
        } else {
            None
        };
        result.push(StoredChat {
            task: ChatTask {
                source: TaskSource::Codex,
                project_path: None,
                project_name: project_name(&metadata, &id, cwd.as_deref()),
                id,
                turn_id,
                title,
                state,
                completed_at_ms,
                expires_at_ms: if state == TaskState::Completed {
                    completed_at_ms.and_then(|ended| ended.checked_add(1_800_000))
                } else {
                    None
                },
                detail,
            },
            started_at_ms: started
                .and_then(|value| u64::try_from(value).ok())
                .unwrap_or(0)
                .saturating_mul(1000),
            updated_at,
            cancelled: status == "interrupted",
            desktop_origin,
        });
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[tokio::test]
    async fn unresponsive_chat_does_not_freeze_new_or_restarted_chats() {
        use tokio::net::UnixListener;
        use tokio::sync::mpsc;

        fn snapshot(id: &str, turn: &str, revision: u64, ended: Option<u64>) -> Value {
            json!({"type":"broadcast","method":"thread-stream-state-changed","version":11,"sourceClientId":"sample-owner","targetClientIds":["observer"],"params":{"hostId":"local","conversationId":id,"change":{"type":"snapshot","revision":revision,"conversationState":{"id":id,"title":"示例聊天","requests":[],"threadRuntimeStatus":{"type":if ended.is_some() {"idle"} else {"active"},"activeFlags":[]},"turns":[{"turnId":turn,"status":if ended.is_some() {"completed"} else {"inProgress"},"turnStartedAtMs":ended.unwrap_or_else(now_ms).saturating_sub(1000),"durationMs":ended.map(|_|1000)}]}}}})
        }
        fn changed(id: &str, base: u64, revision: u64, runtime: &str) -> Value {
            json!({"type":"broadcast","method":"thread-stream-state-changed","version":11,"sourceClientId":"sample-owner","targetClientIds":["observer"],"params":{"hostId":"local","conversationId":id,"change":{"type":"patches","baseRevision":base,"revision":revision,"patches":[{"op":"replace","path":["threadRuntimeStatus"],"value":{"type":runtime,"activeFlags":[]}}]}}})
        }
        async fn wait_for(service: &TaskStatusService, id: &str, state: TaskState) -> ChatTask {
            tokio::time::timeout(Duration::from_secs(3), async {
                loop {
                    let snapshot = service.read_snapshot();
                    if snapshot.sources[0].diagnostic.is_none() {
                        if let Some(task) = snapshot
                            .tasks
                            .iter()
                            .find(|task| task.id == id && task.state == state)
                        {
                            return task.clone();
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .expect("task state updates through the desktop connection")
        }

        // Keep the fixture socket below macOS's Unix socket path limit.
        let root = PathBuf::from("/tmp").join(format!("qdt-live-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let state = Connection::open(root.join("state_5.sqlite")).unwrap();
        state.execute_batch("CREATE TABLE threads(id TEXT,title TEXT,source TEXT,originator TEXT,archived INTEGER,updated_at INTEGER); CREATE TABLE thread_spawn_edges(child_thread_id TEXT); INSERT INTO threads VALUES('retry-chat','重启聊天','vscode','Codex Desktop',0,1800000000); INSERT INTO threads VALUES('silent-chat','无响应旧聊天','cli','codex_cli_rs',0,1);").unwrap();
        let history = Connection::open(root.join("thread_history_1.sqlite")).unwrap();
        history.execute_batch("CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,error_json TEXT,rollout_ordinal INTEGER);").unwrap();
        let ended = now_ms() - 60_000;
        history
            .execute(
                "INSERT INTO thread_turns VALUES('retry-chat','old-turn','completed',?1,?2,NULL,1)",
                rusqlite::params![(ended / 1000 - 1) as i64, (ended / 1000) as i64],
            )
            .unwrap();
        let snapshots = Arc::new(Mutex::new(HashMap::from([(
            "retry-chat".to_owned(),
            snapshot("retry-chat", "old-turn", 1, Some(ended)),
        )])));
        let endpoint = root.join("ipc.sock");
        let listener = UnixListener::bind(&endpoint).unwrap();
        let (events, mut outbound) = mpsc::unbounded_channel::<Value>();
        let replies = events.clone();
        let server_snapshots = snapshots.clone();
        let server = tokio::spawn(async move {
            let (pipe, _) = listener.accept().await.unwrap();
            let (mut reader, mut writer) = pipe.into_split();
            let requests = tokio::spawn(async move {
                while let Ok(length) = reader.read_u32_le().await {
                    let mut bytes = vec![0; length as usize];
                    if reader.read_exact(&mut bytes).await.is_err() {
                        break;
                    }
                    let request: Value = serde_json::from_slice(&bytes).unwrap();
                    let reply = match request["method"].as_str() {
                        Some("initialize") => {
                            json!({"type":"response","requestId":request["requestId"],"method":"initialize","resultType":"success","result":{"clientId":"observer"}})
                        }
                        Some("thread-owner-discovery")
                            if request["params"]["conversationId"] == "silent-chat" =>
                        {
                            continue
                        }
                        Some("thread-owner-discovery") => {
                            json!({"type":"response","requestId":request["requestId"],"method":"thread-owner-discovery","resultType":"success","handledByClientId":"sample-owner","result":{}})
                        }
                        Some("thread-stream-following-changed")
                            if request["params"]["following"] == true =>
                        {
                            let id = request["params"]["conversationId"].as_str().unwrap();
                            server_snapshots.lock().unwrap().get(id).unwrap().clone()
                        }
                        _ => continue,
                    };
                    if replies.send(reply).is_err() {
                        break;
                    }
                }
            });
            while let Some(message) = outbound.recv().await {
                let bytes = serde_json::to_vec(&message).unwrap();
                if writer.write_u32_le(bytes.len() as u32).await.is_err()
                    || writer.write_all(&bytes).await.is_err()
                {
                    break;
                }
            }
            requests.await.unwrap();
        });
        let service = TaskStatusService::from_paths(
            root.clone(),
            root.join("reminders.json"),
            endpoint.to_string_lossy().into_owned(),
        );
        wait_for(&service, "retry-chat", TaskState::Completed).await;
        tokio::time::sleep(Duration::from_millis(4300)).await;
        assert!(
            service.read_snapshot().sources[0].diagnostic.is_none(),
            "an unresponsive historical chat must not disconnect healthy task subscriptions"
        );

        snapshots.lock().unwrap().insert(
            "retry-chat".into(),
            snapshot("retry-chat", "new-turn", 2, None),
        );
        events.send(changed("retry-chat", 1, 2, "active")).unwrap();
        let restarted = wait_for(&service, "retry-chat", TaskState::Running).await;
        assert_eq!(restarted.turn_id, "new-turn");
        assert_eq!(restarted.completed_at_ms, None);
        assert_eq!(restarted.expires_at_ms, None);

        snapshots.lock().unwrap().insert(
            "new-chat".into(),
            snapshot("new-chat", "first-turn", 1, None),
        );
        state.execute_batch("INSERT INTO threads VALUES('new-chat','刚开启的聊天','vscode','Codex Desktop',0,1800000000);").unwrap();
        // The first running turn does not need to have reached the history projection.
        assert_eq!(
            wait_for(&service, "new-chat", TaskState::Running)
                .await
                .turn_id,
            "first-turn"
        );
        let completed = now_ms() - 10;
        snapshots.lock().unwrap().insert(
            "retry-chat".into(),
            snapshot("retry-chat", "new-turn", 3, Some(completed)),
        );
        events.send(changed("retry-chat", 2, 3, "idle")).unwrap();
        assert_eq!(
            wait_for(&service, "retry-chat", TaskState::Completed)
                .await
                .completed_at_ms,
            Some(completed)
        );
        assert_eq!(
            service
                .read_snapshot()
                .tasks
                .iter()
                .filter(|task| task.id == "retry-chat")
                .count(),
            1
        );
        drop(service);
        drop(events);
        tokio::time::timeout(Duration::from_secs(2), server)
            .await
            .unwrap()
            .unwrap();
        drop(state);
        drop(history);
        std::fs::remove_dir_all(root).unwrap();
    }
    use rusqlite::Connection;

    #[test]
    fn history_resolves_saved_project_names_then_directory_names() {
        let root = std::env::temp_dir().join(format!("quodex-project-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let db = Connection::open(root.join("state_5.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE threads(id TEXT,title TEXT,source TEXT,originator TEXT,updated_at INTEGER,cwd TEXT); CREATE TABLE thread_spawn_edges(child_thread_id TEXT);
          INSERT INTO threads VALUES('assigned','任务状态显示','vscode','Codex Desktop',1,'D:/worktrees/copy');
          INSERT INTO threads VALUES('rooted','嵌套任务','vscode','Codex Desktop',1,'D:/projects/quodex/src');
          INSERT INTO threads VALUES('fallback','目录任务','vscode','Codex Desktop',1,'D:\\projects\\临时项目\\');
          INSERT INTO threads VALUES('absent','无目录任务','vscode','Codex Desktop',1,NULL);").unwrap();
        let history = Connection::open(root.join("thread_history_1.sqlite")).unwrap();
        history.execute_batch("CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,error_json TEXT,rollout_ordinal INTEGER);").unwrap();
        std::fs::write(root.join(".codex-global-state.json"), json!({
            "thread-project-assignments":{"assigned":{"projectKind":"local","projectId":"demo"}},
            "local-projects":{"demo":{"name":"QuoDex-v0.2.1","rootPaths":["D:/projects/QuoDex"]}}
        }).to_string()).unwrap();
        let tasks = read_task_history(&root).unwrap();
        let name = |id: &str| {
            tasks
                .iter()
                .find(|chat| chat.task.id == id)
                .unwrap()
                .task
                .project_name
                .as_deref()
        };
        assert_eq!(name("assigned"), Some("QuoDex-v0.2.1"));
        assert_eq!(name("rooted"), Some("QuoDex-v0.2.1"));
        assert_eq!(name("fallback"), Some("临时项目"));
        assert_eq!(name("absent"), None);
        std::fs::write(root.join(".codex-global-state.json"), "invalid").unwrap();
        assert_eq!(
            read_task_history(&root)
                .unwrap()
                .iter()
                .find(|chat| chat.task.id == "rooted")
                .unwrap()
                .task
                .project_name
                .as_deref(),
            Some("src")
        );
        drop(db);
        drop(history);
        for name in [
            "state_5.sqlite",
            "thread_history_1.sqlite",
            ".codex-global-state.json",
        ] {
            std::fs::remove_file(root.join(name)).unwrap();
        }
        std::fs::remove_dir(root).unwrap();
    }

    #[cfg(any(windows, unix))]
    #[tokio::test]
    #[ignore = "requires the local Codex Desktop and existing running chat; read-only"]
    async fn live_desktop_read_only_smoke() {
        let home = PathBuf::from(
            std::env::var_os("CODEX_SQLITE_HOME")
                .or_else(|| std::env::var_os("CODEX_HOME"))
                .unwrap_or_else(|| {
                    PathBuf::from(
                        std::env::var_os("USERPROFILE")
                            .or_else(|| std::env::var_os("HOME"))
                            .unwrap(),
                    )
                    .join(".codex")
                    .into_os_string()
                }),
        );
        let endpoint = desktop_endpoint(&home);
        let service = TaskStatusService::from_paths(
            home,
            std::env::temp_dir().join(format!("quodex-live-{}.json", uuid::Uuid::new_v4())),
            endpoint,
        );
        tokio::time::timeout(Duration::from_secs(12), async {
            loop {
                let snapshot = service.read_snapshot();
                if snapshot.sources[0].diagnostic.is_none()
                    && snapshot
                        .tasks
                        .iter()
                        .any(|task| matches!(task.state, TaskState::Running | TaskState::Waiting))
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
        .await
        .unwrap_or_else(|_| {
            let snapshot = service.read_snapshot();
            panic!(
                "live Desktop source failure: {:?}; states: {:?}",
                snapshot.diagnostic,
                snapshot
                    .tasks
                    .iter()
                    .map(|task| task.state)
                    .collect::<Vec<_>>()
            );
        });
        let observed = Instant::now();
        while observed.elapsed() < Duration::from_secs(18) {
            let snapshot = service.read_snapshot();
            assert!(
                snapshot.sources[0].diagnostic.is_none(),
                "live source diagnostic: {:?}",
                snapshot.diagnostic
            );
            assert!(
                snapshot
                    .tasks
                    .iter()
                    .any(|task| matches!(task.state, TaskState::Running | TaskState::Waiting)),
                "actual active chat stays live throughout discovery and follower heartbeat"
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let snapshot = service.read_snapshot();
        eprintln!(
            "LIVE_DESKTOP_READ_ONLY: {}",
            json!({"observedTasks":snapshot.tasks.len(),"running":snapshot.tasks.iter().filter(|task|task.state==TaskState::Running).count(),"waiting":snapshot.tasks.iter().filter(|task|task.state==TaskState::Waiting).count(),"diagnostic":snapshot.diagnostic})
        );
        drop(service);
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn refreshes_history_and_invalidates_disconnected_live_status() {
        use tokio::net::windows::named_pipe::ServerOptions;
        let root = std::env::temp_dir().join(format!("quodex-refresh-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let state = Connection::open(root.join("state_5.sqlite")).unwrap();
        state.execute_batch("CREATE TABLE threads(id TEXT,title TEXT,source TEXT,originator TEXT,archived INTEGER,updated_at INTEGER); CREATE TABLE thread_spawn_edges(child_thread_id TEXT); INSERT INTO threads VALUES('first-chat','第一项','cli','codex_cli_rs',0,1); INSERT INTO threads VALUES('old-import','旧聊天','vscode',NULL,1,0);").unwrap();
        let history = Connection::open(root.join("thread_history_1.sqlite")).unwrap();
        history.execute_batch("CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,error_json TEXT,rollout_ordinal INTEGER); INSERT INTO thread_turns VALUES('first-chat','first-turn','inProgress',1,NULL,NULL,1);").unwrap();
        let endpoint = format!(r"\\.\pipe\quodex-refresh-{}", uuid::Uuid::new_v4());
        let mut pipe = ServerOptions::new().create(&endpoint).unwrap();
        let server = tokio::spawn(async move {
            pipe.connect().await.unwrap();
            loop {
                let Ok(length) = pipe.read_u32_le().await else {
                    break;
                };
                let mut bytes = vec![0; length as usize];
                if pipe.read_exact(&mut bytes).await.is_err() {
                    break;
                }
                let message: Value = serde_json::from_slice(&bytes).unwrap();
                let response = match message["method"].as_str() {
                    Some("initialize") => {
                        json!({"type":"response","requestId":message["requestId"],"method":"initialize","resultType":"success","result":{"clientId":"observer"}})
                    }
                    Some("thread-owner-discovery")
                        if message["params"]["conversationId"] == "first-chat" =>
                    {
                        json!({"type":"response","requestId":message["requestId"],"method":"thread-owner-discovery","resultType":"success","handledByClientId":"owner","result":{}})
                    }
                    Some("thread-owner-discovery") => {
                        json!({"type":"response","requestId":message["requestId"],"resultType":"error","error":"no-client-found"})
                    }
                    Some("thread-stream-following-changed")
                        if message["params"]["following"] == true =>
                    {
                        json!({"type":"broadcast","method":"thread-stream-state-changed","version":11,"sourceClientId":"owner","targetClientIds":["observer"],"params":{"hostId":"local","conversationId":"first-chat","change":{"type":"snapshot","revision":1,"conversationState":{"id":"first-chat","title":"第一项","requests":[],"threadRuntimeStatus":{"type":"active","activeFlags":[]},"turns":[]}}}})
                    }
                    _ => continue,
                };
                let bytes = serde_json::to_vec(&response).unwrap();
                if pipe.write_u32_le(bytes.len() as u32).await.is_err()
                    || pipe.write_all(&bytes).await.is_err()
                {
                    break;
                }
            }
        });
        let service =
            TaskStatusService::from_paths(root.clone(), root.join("reminders.json"), endpoint);
        let service_ref = &service;
        let wait = |count: usize| async move {
            tokio::time::timeout(Duration::from_secs(6), async {
                loop {
                    if service_ref.read_snapshot().tasks.len() == count {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(30)).await;
                }
            })
            .await
            .unwrap();
        };
        wait(1).await;
        state.execute_batch("INSERT INTO threads VALUES('second-chat','另一项目','vscode','Codex Desktop',1,2);").unwrap();
        let ended = now_ms() / 1000 - 600;
        history.execute("INSERT INTO thread_turns VALUES('second-chat','second-turn','completed',?1,?2,NULL,1)", rusqlite::params![(ended - 10) as i64, ended as i64]).unwrap();
        wait(2).await;
        let tasks = service.read_snapshot().tasks;
        assert_eq!(
            tasks
                .iter()
                .find(|task| task.id == "first-chat")
                .unwrap()
                .state,
            TaskState::Running
        );
        assert_eq!(
            tasks
                .iter()
                .find(|task| task.id == "second-chat")
                .unwrap()
                .completed_at_ms,
            Some(ended * 1000)
        );
        server.abort();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let snapshot = service.read_snapshot();
                if snapshot.sources[0].diagnostic.is_some()
                    && snapshot
                        .tasks
                        .iter()
                        .all(|task| !matches!(task.state, TaskState::Running | TaskState::Waiting))
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
        })
        .await
        .unwrap();
        drop(service);
        drop(state);
        drop(history);
        for file in ["state_5.sqlite", "thread_history_1.sqlite"] {
            std::fs::remove_file(root.join(file)).unwrap();
        }
        std::fs::remove_dir(root).unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn reads_running_and_input_waiting_from_the_original_desktop_owner() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::windows::named_pipe::ServerOptions,
        };
        for (runtime_type, flags, expected, patch_mode) in [
            ("active", json!([]), Some(TaskState::Running), false),
            (
                "active",
                json!(["waitingOnUserInput"]),
                Some(TaskState::Waiting),
                false,
            ),
            ("idle", json!([]), Some(TaskState::Completed), false),
            (
                "active",
                json!(["waitingOnUserInput"]),
                Some(TaskState::Waiting),
                true,
            ),
            ("idle", json!([]), None, false),
            ("idle", json!([]), Some(TaskState::Failed), false),
        ] {
            let root = std::env::temp_dir().join(format!(
                "quodex-task-ipc-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir(&root).unwrap();
            let state = Connection::open(root.join("state_5.sqlite")).unwrap();
            state.execute_batch("CREATE TABLE threads(id TEXT,title TEXT,source TEXT,originator TEXT,archived INTEGER,updated_at INTEGER); CREATE TABLE thread_spawn_edges(child_thread_id TEXT); INSERT INTO threads VALUES('sample-chat','当前聊天','vscode','Codex Desktop',0,1800000000);").unwrap();
            let history = Connection::open(root.join("thread_history_1.sqlite")).unwrap();
            history.execute_batch("CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,error_json TEXT,rollout_ordinal INTEGER);").unwrap();
            let ended = (now_ms() / 1000) as i64
                - if expected == Some(TaskState::Completed) {
                    1798
                } else {
                    600
                };
            history
                .execute(
                    "INSERT INTO thread_turns VALUES('sample-chat','sample-turn',?3,?1,?2,?4,1)",
                    rusqlite::params![
                        ended - 60,
                        ended,
                        if expected == Some(TaskState::Failed) {
                            "failed"
                        } else {
                            "completed"
                        },
                        if expected == Some(TaskState::Failed) {
                            Some(r#"{"message":"示例网络超时"}"#)
                        } else {
                            None
                        }
                    ],
                )
                .unwrap();
            drop(state);
            drop(history);
            let endpoint = format!(
                r"\\.\pipe\quodex-test-{}",
                root.file_name().unwrap().to_string_lossy()
            );
            let mut pipe = ServerOptions::new().create(&endpoint).unwrap();
            let server = tokio::spawn(async move {
                pipe.connect().await.unwrap();
                let mut following_count = 0;
                loop {
                    let Ok(length) = pipe.read_u32_le().await else {
                        break;
                    };
                    let mut bytes = vec![0; length as usize];
                    if pipe.read_exact(&mut bytes).await.is_err() {
                        break;
                    }
                    let message: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                    if message["method"] == "thread-stream-following-changed"
                        && message["params"]["following"] == true
                    {
                        following_count += 1;
                    }
                    let response = match message["method"].as_str() {
                        Some("initialize") => {
                            serde_json::json!({"type":"response","requestId":message["requestId"],"method":"initialize","resultType":"success","result":{"clientId":"sample-observer"}})
                        }
                        Some("thread-owner-discovery") => {
                            serde_json::json!({"type":"response","requestId":message["requestId"],"method":"thread-owner-discovery","resultType":"success","handledByClientId":"sample-owner","result":{}})
                        }
                        Some("thread-stream-following-changed")
                            if message["params"]["following"] == true =>
                        {
                            serde_json::json!({"type":"broadcast","method":"thread-stream-state-changed","version":11,"sourceClientId":"sample-owner","targetClientIds":["sample-observer"],"params":{"hostId":"local","conversationId":"sample-chat","change":{"type":"snapshot","revision":if following_count > 1 {2} else {1},"conversationState":{"id":"sample-chat","title":"当前聊天","requests":[],"threadRuntimeStatus":{"type":runtime_type,"activeFlags":if patch_mode && following_count == 1 {json!([])} else {flags.clone()}},"turns":[],"turnHistory":{"kind":"canonical","history":{"entitiesByKey":{"latest":{"turnId":"sample-turn","status":if expected.is_none() {"interrupted"} else if runtime_type == "idle" {"completed"} else {"inProgress"},"turnStartedAtMs":1800000000000u64}},"islands":[]}}}}}})
                        }
                        _ => continue,
                    };
                    let bytes = serde_json::to_vec(&response).unwrap();
                    if pipe.write_u32_le(bytes.len() as u32).await.is_err() {
                        break;
                    }
                    if pipe.write_all(&bytes).await.is_err() {
                        break;
                    }
                    if patch_mode && following_count == 1 {
                        let patch = json!({"type":"broadcast","method":"thread-stream-state-changed","version":11,"sourceClientId":"sample-owner","targetClientIds":["sample-observer"],"params":{"hostId":"local","conversationId":"sample-chat","change":{"type":"patches","baseRevision":1,"revision":2,"patches":[{"op":"replace","path":["threadRuntimeStatus"],"value":{"type":"active","activeFlags":["waitingOnUserInput"]}}]}}});
                        let bytes = serde_json::to_vec(&patch).unwrap();
                        pipe.write_u32_le(bytes.len() as u32).await.unwrap();
                        pipe.write_all(&bytes).await.unwrap();
                    }
                }
            });
            let service =
                TaskStatusService::from_paths(root.clone(), root.join("reminders.json"), endpoint);
            tokio::time::timeout(Duration::from_secs(4), async {
                loop {
                    let snapshot = service.read_snapshot();
                    if snapshot.sources[0].diagnostic.is_none() {
                        if let Some(expected) = expected {
                            if snapshot.tasks.is_empty()
                                || (patch_mode && snapshot.tasks[0].state != expected)
                            {
                                tokio::time::sleep(Duration::from_millis(20)).await;
                                continue;
                            }
                            assert_eq!(snapshot.tasks[0].state, expected);
                            assert_eq!(snapshot.tasks[0].turn_id, "sample-turn");
                            if expected == TaskState::Completed {
                                assert_eq!(
                                    snapshot.tasks[0].completed_at_ms,
                                    Some(ended as u64 * 1000)
                                );
                            }
                        } else {
                            assert!(snapshot.tasks.is_empty(), "cancelled chat must disappear");
                        }
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .expect("desktop owner snapshot");
            if expected == Some(TaskState::Completed) {
                server.abort();
                tokio::time::sleep(Duration::from_millis(2100)).await;
                assert!(
                    service.read_snapshot().tasks.is_empty(),
                    "completed reminder must expire after a source outage"
                );
            }
            if expected == Some(TaskState::Failed) {
                assert!(service.read_snapshot().tasks[0]
                    .detail
                    .as_deref()
                    .unwrap()
                    .contains("示例网络超时"));
                service
                    .dismiss_failure("sample-chat", "sample-turn")
                    .unwrap();
                assert!(service.read_snapshot().tasks.is_empty());
                server.abort();
                tokio::time::timeout(Duration::from_secs(2), async {
                    while service.read_snapshot().sources[0].diagnostic.is_none() {
                        tokio::time::sleep(Duration::from_millis(20)).await;
                    }
                })
                .await
                .unwrap();
                assert!(
                    service.read_snapshot().tasks.is_empty(),
                    "dismissed failure must not return as unknown after disconnect"
                );
            }
            drop(service);
            server.abort();
            for file in ["state_5.sqlite", "thread_history_1.sqlite"] {
                std::fs::remove_file(root.join(file)).unwrap();
            }
            if root.join("reminders.json").exists() {
                std::fs::remove_file(root.join("reminders.json")).unwrap();
            }
            std::fs::remove_dir(root).unwrap();
        }
    }

    #[test]
    fn reads_actual_completion_time_from_the_last_desktop_turn() {
        let root = std::env::temp_dir().join(format!(
            "quodex-task-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let state = Connection::open(root.join("state_5.sqlite")).unwrap();
        state.execute_batch("CREATE TABLE threads(id TEXT,title TEXT,source TEXT,originator TEXT,archived INTEGER,updated_at INTEGER);
          CREATE TABLE thread_spawn_edges(child_thread_id TEXT);
          INSERT INTO threads VALUES('sample-chat','整理文档','vscode','Codex Desktop',0,1800000010);").unwrap();
        let history = Connection::open(root.join("thread_history_1.sqlite")).unwrap();
        history.execute_batch("CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,error_json TEXT,rollout_ordinal INTEGER);
          INSERT INTO thread_turns VALUES('sample-chat','old-turn','completed',1799990000,1799990100,NULL,1);
          INSERT INTO thread_turns VALUES('sample-chat','new-turn','completed',1799999300,1799999400,NULL,2);").unwrap();
        drop(state);
        drop(history);
        let tasks = read_task_history(&root).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].task.turn_id, "new-turn");
        assert_eq!(tasks[0].task.completed_at_ms, Some(1_799_999_400_000));
        assert_eq!(tasks[0].task.state, TaskState::Completed);
        for file in ["state_5.sqlite", "thread_history_1.sqlite"] {
            std::fs::remove_file(root.join(file)).unwrap();
        }
        std::fs::remove_dir(root).unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn desktop_completion_overrides_a_different_stale_interrupted_history_turn() {
        let ended = now_ms() - 600_000;
        let snapshot = desktop_snapshot(json!({"turnId":"actual-turn","status":"completed","turnStartedAtMs":ended-60_000,"durationMs":60_000}), "idle", json!([])).await;
        assert_eq!(snapshot.tasks[0].turn_id, "actual-turn");
        assert_eq!(snapshot.tasks[0].state, TaskState::Completed);
        assert_eq!(snapshot.tasks[0].completed_at_ms, Some(ended));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn desktop_terminal_and_active_states_survive_stale_history() {
        let ended = now_ms() - 1_800_001;
        let expired = desktop_snapshot(json!({"turnId":"actual-turn","status":"completed","turnStartedAtMs":ended-60_000,"durationMs":60_000}), "idle", json!([])).await;
        assert!(expired.tasks.is_empty());
        let failed = desktop_snapshot(
            json!({"turnId":"actual-turn","status":"failed","error":{"message":"连接超时"}}),
            "idle",
            json!([]),
        )
        .await;
        assert_eq!(failed.tasks[0].state, TaskState::Failed);
        assert_eq!(
            failed.tasks[0].detail.as_deref(),
            Some("连接超时 · QDT-610")
        );
        assert_eq!(failed.tasks[0].expires_at_ms, None);
        let cancelled = desktop_snapshot(
            json!({"turnId":"actual-turn","status":"interrupted"}),
            "idle",
            json!([]),
        )
        .await;
        assert!(cancelled.tasks.is_empty());
        for (flags, expected) in [
            (json!([]), TaskState::Running),
            (json!(["waitingOnUserInput"]), TaskState::Waiting),
            (json!(["waitingOnApproval"]), TaskState::Waiting),
        ] {
            let active = desktop_snapshot(
                json!({"turnId":"actual-turn","status":"inProgress"}),
                "active",
                flags,
            )
            .await;
            assert_eq!(active.tasks[0].state, expected);
            assert_eq!(active.tasks[0].completed_at_ms, None);
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn desktop_completion_does_not_invent_a_missing_or_invalid_end_time() {
        for turn in [
            json!({"turnId":"actual-turn","status":"completed","finalAssistantStartedAtMs":now_ms()}),
            json!({"turnId":"actual-turn","status":"completed","turnStartedAtMs":now_ms()+60_000,"durationMs":10}),
            json!({"turnId":"actual-turn","status":"completed","turnStartedAtMs":u64::MAX,"durationMs":10}),
        ] {
            let snapshot = desktop_snapshot(turn, "idle", json!([])).await;
            assert_eq!(snapshot.tasks[0].completed_at_ms, None);
            assert_eq!(snapshot.tasks[0].expires_at_ms, None);
        }
    }

    #[cfg(windows)]
    async fn desktop_snapshot(turn: Value, runtime: &str, flags: Value) -> TaskStatusSnapshot {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::windows::named_pipe::ServerOptions,
        };
        let root = std::env::temp_dir().join(format!("quodex-terminal-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let state = Connection::open(root.join("state_5.sqlite")).unwrap();
        state.execute_batch("CREATE TABLE threads(id TEXT,title TEXT,source TEXT,originator TEXT,archived INTEGER,updated_at INTEGER); CREATE TABLE thread_spawn_edges(child_thread_id TEXT); INSERT INTO threads VALUES('sample-chat','任务状态显示','vscode','Codex Desktop',0,1800000000);").unwrap();
        let history = Connection::open(root.join("thread_history_1.sqlite")).unwrap();
        history.execute_batch("CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,error_json TEXT,rollout_ordinal INTEGER); INSERT INTO thread_turns VALUES('sample-chat','stale-turn','interrupted',1,2,NULL,1);").unwrap();
        drop(state);
        drop(history);
        let runtime = runtime.to_owned();
        let endpoint = format!(r"\\.\pipe\quodex-terminal-{}", uuid::Uuid::new_v4());
        let server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&endpoint)
            .unwrap();
        let owner = tokio::spawn(async move {
            server.connect().await.unwrap();
            let mut pipe = server;
            loop {
                let Ok(length) = pipe.read_u32_le().await else {
                    break;
                };
                let mut bytes = vec![0; length as usize];
                if pipe.read_exact(&mut bytes).await.is_err() {
                    break;
                }
                let message: Value = serde_json::from_slice(&bytes).unwrap();
                let reply = match message["method"].as_str() {
                    Some("initialize") => {
                        json!({"type":"response","requestId":message["requestId"],"method":"initialize","resultType":"success","result":{"clientId":"sample-observer"}})
                    }
                    Some("thread-owner-discovery") => {
                        json!({"type":"response","requestId":message["requestId"],"method":"thread-owner-discovery","resultType":"success","handledByClientId":"sample-owner"})
                    }
                    Some("thread-stream-following-changed")
                        if message["params"]["following"] == true =>
                    {
                        json!({"type":"broadcast","method":"thread-stream-state-changed","version":11,"sourceClientId":"sample-owner","targetClientIds":["sample-observer"],"params":{"hostId":"local","conversationId":"sample-chat","change":{"type":"snapshot","revision":1,"conversationState":{"id":"sample-chat","title":"任务状态显示","requests":[],"threadRuntimeStatus":{"type":runtime,"activeFlags":flags},"turnHistory":{"kind":"canonical","history":{"entitiesByKey":{"latest":turn}}}}}}})
                    }
                    _ => continue,
                };
                let bytes = serde_json::to_vec(&reply).unwrap();
                if pipe.write_u32_le(bytes.len() as u32).await.is_err()
                    || pipe.write_all(&bytes).await.is_err()
                {
                    break;
                }
            }
        });
        let service =
            TaskStatusService::from_paths(root.clone(), root.join("reminders.json"), endpoint);
        let snapshot = tokio::time::timeout(Duration::from_secs(4), async {
            loop {
                let snapshot = service.read_snapshot();
                if snapshot.sources[0].diagnostic.is_none() {
                    break snapshot;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        drop(service);
        owner.await.unwrap();
        for name in ["state_5.sqlite", "thread_history_1.sqlite"] {
            std::fs::remove_file(root.join(name)).unwrap();
        }
        std::fs::remove_dir(root).unwrap();
        snapshot
    }
}

#[cfg(test)]
mod source_isolation_tests {
    use super::*;
    #[test]
    fn collector_diagnostics_and_timestamps_are_independent_of_the_other_source() {
        let service = TaskStatusService {
            zcode: Some(crate::zcode_tasks::ZCodeTaskService::from_path(
                std::env::temp_dir().join(format!("quodex-no-zcode-{}", uuid::Uuid::new_v4())),
            )),
            snapshot: Arc::new(Mutex::new(SourceTaskSnapshot {
                tasks: vec![],
                observed_at_ms: 1234,
                diagnostic: Some(Diagnostic::new("QDT-601", "Codex 已断开")),
            })),
            reminders: Mutex::new(Ok(HashMap::new())),
            reminders_path: PathBuf::new(),
            stop: None,
        };
        let result = service.read_snapshot();
        assert!(result.diagnostic.is_none());
        assert_eq!(result.sources[0].source, TaskSource::Codex);
        assert_eq!(result.sources[0].observed_at_ms, 1234);
        assert_eq!(result.sources[0].health, "unavailable");
        assert_eq!(
            result.sources[0].diagnostic.as_ref().unwrap().code,
            "QDT-601"
        );
        assert_eq!(result.sources[1].source, TaskSource::Zcode);
        assert_eq!(result.sources[1].health, "ready");
        assert!(result.sources[1].diagnostic.is_none());
        assert!(result.sources[1].observed_at_ms > 1234);
    }
}

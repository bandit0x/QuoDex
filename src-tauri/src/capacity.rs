use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env,
    fs,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{ChildStdout, Command},
    time::timeout,
};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const RESPONSE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapacitySnapshot {
    pub source_state: SourceState,
    /// `account/rateLimits/read` 响应内的 `planType`；None 表示协议未披露套餐。
    pub plan_type: Option<String>,
    /// 读取时 `auth.json` 里的账户标识；None 表示未登录或身份文件不可读。
    /// 与额度数据同源产生，供上层判定缓存归属（账户切换/退出登录时丢弃旧账户数据）。
    pub account_id: Option<String>,
    pub five_hour: Option<QuotaWindow>,
    pub weekly: Option<QuotaWindow>,
    pub full_reset_credits: Option<FullResetCredits>,
    pub observed_at_ms: u64,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceState {
    Healthy,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    pub used_percent: f64,
    pub remaining_percent: f64,
    pub window_duration_mins: u64,
    pub resets_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullResetCredits {
    pub available_count: u64,
    pub nearest_expiry_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("{code}: {message}")]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: &'static str,
    pub message: String,
    pub detail: Option<String>,
    /// 失败发生时已登录的账户标识（读自 auth.json），用于缓存归属判定。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
}

impl Diagnostic {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
            account_id: None,
        }
    }

    pub(crate) fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}

#[derive(Debug, Clone)]
struct AppServerCommand {
    executable: String,
    args: Vec<String>,
    environment: Vec<(String, String)>,
}

impl AppServerCommand {
    fn from_environment() -> Self {
        if let Ok(executable) = env::var("CODEX_CREDITS_APP_SERVER_EXECUTABLE") {
            let args = env::var("CODEX_CREDITS_APP_SERVER_ARGS")
                .ok()
                .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
                .unwrap_or_else(|| vec!["app-server".to_owned()]);
            return Self {
                executable,
                args,
                environment: Vec::new(),
            };
        }

        if cfg!(debug_assertions) && env::var("CODEX_CREDITS_USE_LIVE").as_deref() != Ok("1") {
            return Self::fixture();
        }

        Self {
            executable: resolve_codex_executable()
                .unwrap_or_else(|| crate::platform::codex_binary_name().to_owned()),
            args: vec!["app-server".to_owned()],
            environment: Vec::new(),
        }
    }

    fn fixture() -> Self {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("fixtures")
            .join("app-server-fixture.mjs");
        Self {
            executable: env::var("CODEX_CREDITS_FIXTURE_NODE")
                .unwrap_or_else(|_| "node".to_owned()),
            args: vec![fixture_path.to_string_lossy().into_owned()],
            environment: Vec::new(),
        }
    }

    #[cfg(test)]
    fn fixture_scenario(scenario: &str) -> Self {
        let mut command = Self::fixture();
        command.environment.push((
            "CODEX_CREDITS_FIXTURE_SCENARIO".to_owned(),
            scenario.to_owned(),
        ));
        command
    }
}

fn resolve_codex_executable() -> Option<String> {
    for candidate in local_runtime_candidates() {
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }

    if let Some(executable) =
        find_on_path(crate::platform::codex_binary_name(), env::var_os("PATH"))
    {
        return Some(executable.to_string_lossy().into_owned());
    }

    extra_executable_candidates()
        .into_iter()
        .find(|candidate| candidate.is_file())
        .map(|path| path.to_string_lossy().into_owned())
}

fn local_runtime_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(current_exe) = env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(
                parent
                    .join("codex-runtime")
                    .join("bin")
                    .join(crate::platform::codex_binary_name()),
            );
        }
    }
    // 仓库内 vendored 运行时仅用于开发联调（CODEX_CREDITS_USE_LIVE=1）：
    // env! 的编译期绝对路径不得进入发行版，否则会在构建机上“碰巧生效”，
    // 掩盖捆绑 runtime 缺失、兜底目录不覆盖等真实解析问题。
    #[cfg(debug_assertions)]
    candidates.push(project_local_runtime());
    candidates
}

/// The `@openai/codex` npm package ships a vendored CLI per platform; pick the
/// one matching this machine's vendor triple.
#[cfg(debug_assertions)]
fn project_local_runtime() -> PathBuf {
    let packages = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("node_modules")
        .join("@openai");
    if cfg!(target_os = "windows") {
        return packages
            .join("codex-win32-x64")
            .join("vendor")
            .join("x86_64-pc-windows-msvc")
            .join("bin")
            .join("codex.exe");
    }
    if cfg!(target_os = "macos") {
        let (package, vendor) = if cfg!(target_arch = "aarch64") {
            ("codex-darwin-arm64", "aarch64-apple-darwin")
        } else {
            ("codex-darwin-x64", "x86_64-apple-darwin")
        };
        return packages
            .join(package)
            .join("vendor")
            .join(vendor)
            .join("bin")
            .join("codex");
    }
    packages
        .join("codex-linux-x64")
        .join("vendor")
        .join("x86_64-unknown-linux-musl")
        .join("bin")
        .join("codex")
}

#[cfg(target_os = "windows")]
fn extra_executable_candidates() -> Vec<PathBuf> {
    let program_files = match env::var_os("ProgramFiles") {
        Some(program_files) => PathBuf::from(program_files),
        None => return Vec::new(),
    };
    let windows_apps = program_files.join("WindowsApps");
    let mut candidates = std::fs::read_dir(windows_apps)
        .ok()
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("OpenAI.Codex_")
                })
                .map(|entry| entry.path().join("app").join("resources").join("codex.exe"))
                .filter(|path| path.is_file())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    candidates.sort();
    candidates
}

#[cfg(not(target_os = "windows"))]
fn extra_executable_candidates() -> Vec<PathBuf> {
    // Finder 启动的 .app 拿不到登录 shell 的 PATH，补查常见安装位置
    let binary = crate::platform::codex_binary_name();
    let mut candidates = desktop_app_bundled_candidates();
    candidates.push(PathBuf::from("/opt/homebrew/bin").join(binary));
    candidates.push(PathBuf::from("/usr/local/bin").join(binary));
    if let Some(home) = env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join(".local/bin").join(binary));
        candidates.push(home.join("bin").join(binary));
    }
    candidates
}

/// Codex 桌面版把 CLI 内嵌在应用包里（当前随 ChatGPT.app 分发，独立 Codex.app
/// 为预留布局），并与 `~/.codex` 共享登录态；对 Finder 启动的场景这是最常见的
/// 来源，对齐 Windows 侧扫描 WindowsApps 的兜底逻辑。
#[cfg(target_os = "macos")]
fn desktop_app_bundled_candidates() -> Vec<PathBuf> {
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = env::var_os("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }
    let mut candidates = Vec::new();
    for root in roots {
        for app in ["ChatGPT.app", "Codex.app"] {
            candidates.push(root.join(app).join("Contents/Resources/codex"));
        }
    }
    candidates
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn desktop_app_bundled_candidates() -> Vec<PathBuf> {
    Vec::new()
}

fn find_on_path(executable: &str, path_value: Option<std::ffi::OsString>) -> Option<PathBuf> {
    env::split_paths(&path_value?)
        .map(|folder| folder.join(executable))
        .find(|candidate| candidate.is_file())
}

/// auth.json 路径解析：`CODEX_HOME`（codex CLI 的状态目录约定）优先，
/// 否则退回 `$HOME/.codex`。与 app-server 子进程共享同一解析结果，
/// 保证身份标签与额度数据来自同一个登录态。
fn codex_auth_path(lookup: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    if let Some(home) = lookup("CODEX_HOME") {
        return Some(PathBuf::from(home).join("auth.json"));
    }
    let home = lookup("HOME").or_else(|| lookup("USERPROFILE"))?;
    Some(PathBuf::from(home).join(".codex").join("auth.json"))
}

/// 读取当前登录账户标识。auth.json 缺失、不可读、或没有 ChatGPT tokens
/// （API-key 模式/已退出登录）都返回 None——身份未知，不猜测。
fn read_account_id(lookup: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    let path = codex_auth_path(lookup)?;
    let content = fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<Value>(&content).ok()?;
    value
        .get("tokens")
        .and_then(|tokens| tokens.get("account_id"))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

#[derive(Debug)]
pub struct CapacityService {
    command: AppServerCommand,
}

impl CapacityService {
    pub fn from_environment() -> Self {
        Self {
            command: AppServerCommand::from_environment(),
        }
    }

    pub async fn read_snapshot(&self) -> Result<CapacitySnapshot, Diagnostic> {
        // 先取身份再拉额度：额度与身份同批产生。若读取中途发生账户切换，
        // 最多滞后一个刷新周期（5 秒），下一次读取会以新身份重新对齐。
        let account_id = read_account_id(&|name| env::var(name).ok());
        match self.request_rate_limits().await {
            Ok(result) => parse_snapshot(result, account_id),
            Err(mut diagnostic) => {
                diagnostic.account_id = account_id;
                Err(diagnostic)
            }
        }
    }

    async fn request_rate_limits(&self) -> Result<Value, Diagnostic> {
        let mut command = Command::new(&self.command.executable);
        command
            .args(&self.command.args)
            .envs(self.command.environment.iter().cloned())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command.spawn().map_err(|error| {
            Diagnostic::new("CRV-101", "无法启动配额数据进程").with_detail(error.to_string())
        })?;

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| Diagnostic::new("CRV-102", "配额数据进程没有可写输入通道"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| Diagnostic::new("CRV-103", "配额数据进程没有可读输出通道"))?;
        let mut lines = BufReader::new(stdout).lines();

        write_message(
            &mut stdin,
            &json!({
                "method": "initialize",
                "id": 1,
                "params": {
                    "clientInfo": {
                        "name": "codex_credits_view",
                        "title": "QuoDex",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }
            }),
        )
        .await?;
        wait_for_response(&mut lines, 1).await?;

        write_message(
            &mut stdin,
            &json!({ "method": "initialized", "params": {} }),
        )
        .await?;
        write_message(
            &mut stdin,
            &json!({ "method": "account/rateLimits/read", "id": 2 }),
        )
        .await?;

        let response = wait_for_response(&mut lines, 2).await;
        let mut result = response?;
        collect_sparse_updates(&mut lines, &mut result).await?;
        let _ = child.kill().await;
        Ok(result)
    }
}

async fn collect_sparse_updates(
    lines: &mut Lines<BufReader<ChildStdout>>,
    base: &mut Value,
) -> Result<(), Diagnostic> {
    for _ in 0..4 {
        let next = timeout(Duration::from_millis(40), lines.next_line()).await;
        let Ok(line_result) = next else { break };
        let Some(line) = line_result.map_err(|error| {
            Diagnostic::new("CRV-106", "无法读取 app-server 更新").with_detail(error.to_string())
        })?
        else {
            break;
        };
        let message: Value = serde_json::from_str(&line).map_err(|error| {
            Diagnostic::new("CRV-107", "app-server 返回了无效 JSON").with_detail(error.to_string())
        })?;
        if message.get("method").and_then(Value::as_str) == Some("account/rateLimits/updated") {
            if let Some(params) = message.get("params") {
                merge_sparse_update(base, params);
            }
        }
    }
    Ok(())
}

fn merge_sparse_update(base: &mut Value, update: &Value) {
    let Some(base_object) = base.as_object_mut() else {
        return;
    };
    let Some(update_object) = update.as_object() else {
        return;
    };

    if let Some(update_limits) = update_object.get("rateLimits").and_then(Value::as_object) {
        if let Some(base_limits) = base_object
            .get_mut("rateLimits")
            .and_then(Value::as_object_mut)
        {
            for key in ["primary", "secondary", "rateLimitReachedType", "planType"] {
                if let Some(value) = update_limits.get(key) {
                    base_limits.insert(key.to_owned(), value.clone());
                }
            }
        }
    }

    if let Some(credits) = update_object.get("rateLimitResetCredits") {
        base_object.insert("rateLimitResetCredits".to_owned(), credits.clone());
    }
}

async fn write_message(
    stdin: &mut tokio::process::ChildStdin,
    message: &Value,
) -> Result<(), Diagnostic> {
    let mut bytes = serde_json::to_vec(message).map_err(|error| {
        Diagnostic::new("CRV-104", "无法编码 app-server 请求").with_detail(error.to_string())
    })?;
    bytes.push(b'\n');
    stdin.write_all(&bytes).await.map_err(|error| {
        Diagnostic::new("CRV-105", "无法写入 app-server 请求").with_detail(error.to_string())
    })
}

async fn wait_for_response(
    lines: &mut Lines<BufReader<ChildStdout>>,
    expected_id: u64,
) -> Result<Value, Diagnostic> {
    timeout(RESPONSE_TIMEOUT, async {
        while let Some(line) = lines.next_line().await.map_err(|error| {
            Diagnostic::new("CRV-106", "无法读取 app-server 响应").with_detail(error.to_string())
        })? {
            let message: Value = serde_json::from_str(&line).map_err(|error| {
                Diagnostic::new("CRV-107", "app-server 返回了无效 JSON")
                    .with_detail(error.to_string())
            })?;

            if message.get("id").and_then(Value::as_u64) != Some(expected_id) {
                continue;
            }

            if let Some(error) = message.get("error") {
                let detail = error.to_string();
                if detail.to_ascii_lowercase().contains("logged")
                    || detail.to_ascii_lowercase().contains("auth")
                {
                    return Err(Diagnostic::new("CRV-202", "Codex 尚未登录").with_detail(detail));
                }
                return Err(
                    Diagnostic::new("CRV-108", "app-server 拒绝了配额请求").with_detail(detail)
                );
            }

            return message
                .get("result")
                .cloned()
                .ok_or_else(|| Diagnostic::new("CRV-109", "app-server 响应缺少 result"));
        }

        Err(Diagnostic::new("CRV-110", "app-server 在返回配额前结束"))
    })
    .await
    .map_err(|_| Diagnostic::new("CRV-111", "读取 Codex 配额超时"))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RateLimitReadResult {
    rate_limits: RateLimits,
    rate_limit_reset_credits: Option<ResetCreditsWire>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RateLimits {
    primary: Option<QuotaWindowWire>,
    secondary: Option<QuotaWindowWire>,
    /// 0.147.0 实测位于 rateLimits 对象内；缺失表示协议未披露套餐。
    plan_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuotaWindowWire {
    used_percent: f64,
    window_duration_mins: u64,
    resets_at: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResetCreditsWire {
    available_count: u64,
    credits: Option<Vec<ResetCreditWire>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResetCreditWire {
    status: String,
    expires_at: Option<u64>,
}

fn parse_snapshot(result: Value, account_id: Option<String>) -> Result<CapacitySnapshot, Diagnostic> {
    let wire: RateLimitReadResult = serde_json::from_value(result).map_err(|error| {
        Diagnostic::new("CRV-112", "Codex 配额响应结构不受支持").with_detail(error.to_string())
    })?;

    let plan_type = wire.rate_limits.plan_type.clone();
    let (five_hour, weekly) = classify_windows(wire.rate_limits)?;
    let full_reset_credits = wire.rate_limit_reset_credits.map(|credits| {
        let nearest_expiry_at = credits.credits.as_ref().and_then(|rows| {
            rows.iter()
                .filter(|credit| credit.status == "available")
                .filter_map(|credit| credit.expires_at)
                .min()
        });
        FullResetCredits {
            available_count: credits.available_count,
            nearest_expiry_at,
        }
    });

    Ok(CapacitySnapshot {
        source_state: SourceState::Healthy,
        plan_type,
        account_id,
        five_hour,
        weekly,
        full_reset_credits,
        observed_at_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    })
}

fn classify_windows(
    rate_limits: RateLimits,
) -> Result<(Option<QuotaWindow>, Option<QuotaWindow>), Diagnostic> {
    let mut windows: Vec<QuotaWindowWire> = [rate_limits.primary, rate_limits.secondary]
        .into_iter()
        .flatten()
        .collect();
    windows.sort_by_key(|window| window.window_duration_mins);

    let mut normalized = windows
        .into_iter()
        .map(normalize_window)
        .collect::<Result<Vec<_>, _>>()?;

    match normalized.len() {
        0 => Ok((None, None)),
        1 => {
            let window = normalized.remove(0);
            if window.window_duration_mins <= 24 * 60 {
                Ok((Some(window), None))
            } else {
                Ok((None, Some(window)))
            }
        }
        _ => {
            let five_hour = normalized.remove(0);
            let weekly = normalized.pop();
            Ok((Some(five_hour), weekly))
        }
    }
}

fn normalize_window(window: QuotaWindowWire) -> Result<QuotaWindow, Diagnostic> {
    if !(0.0..=100.0).contains(&window.used_percent) {
        return Err(Diagnostic::new("CRV-113", "Codex 返回了无效的使用百分比")
            .with_detail(window.used_percent.to_string()));
    }

    Ok(QuotaWindow {
        used_percent: window.used_percent,
        remaining_percent: 100.0 - window.used_percent,
        window_duration_mins: window.window_duration_mins,
        resets_at: window.resets_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn classifies_short_and_long_windows_without_clamping() {
        let result = json!({
            "rateLimits": {
                "primary": { "usedPercent": 24, "windowDurationMins": 300, "resetsAt": 1000 },
                "secondary": { "usedPercent": 58, "windowDurationMins": 10080, "resetsAt": 2000 },
                "planType": "plus"
            },
            "rateLimitResetCredits": { "availableCount": 2, "credits": [] }
        });

        let snapshot = parse_snapshot(result, None).expect("valid snapshot");
        assert_eq!(snapshot.five_hour.unwrap().remaining_percent, 76.0);
        assert_eq!(snapshot.weekly.unwrap().remaining_percent, 42.0);
        assert_eq!(snapshot.full_reset_credits.unwrap().available_count, 2);
        assert_eq!(snapshot.plan_type.as_deref(), Some("plus"));
    }

    #[test]
    fn carries_plan_type_and_account_identity_from_real_protocol_shape() {
        let result = json!({
            "rateLimits": {
                "limitId": "codex",
                "limitName": null,
                "primary": { "usedPercent": 89, "windowDurationMins": 10080, "resetsAt": 1000 },
                "secondary": null,
                "credits": { "hasCredits": true, "unlimited": false, "balance": "747.55" },
                "individualLimit": null,
                "spendControlReached": false,
                "planType": "prolite",
                "rateLimitReachedType": null
            },
            "rateLimitResetCredits": null
        });

        let snapshot = parse_snapshot(result, Some("acct-42".to_owned())).expect("pro snapshot");
        assert_eq!(snapshot.plan_type.as_deref(), Some("prolite"));
        assert_eq!(snapshot.account_id.as_deref(), Some("acct-42"));
        // 真实 prolite 账号：唯一窗口是 10080 分钟周窗口，落在 weekly，5h 舱为空。
        assert!(snapshot.five_hour.is_none());
        assert_eq!(snapshot.weekly.unwrap().remaining_percent, 11.0);
    }

    #[test]
    fn keeps_identity_unknown_when_protocol_omits_plan_type() {
        let result = json!({
            "rateLimits": {
                "primary": { "usedPercent": 89, "windowDurationMins": 10080, "resetsAt": 1000 },
                "secondary": null
            },
            "rateLimitResetCredits": null
        });

        let snapshot = parse_snapshot(result, Some("acct-42".to_owned())).expect("snapshot");
        assert_eq!(snapshot.plan_type, None);
        assert_eq!(snapshot.account_id.as_deref(), Some("acct-42"));
    }

    #[test]
    fn rejects_out_of_range_used_percent_instead_of_inventing_capacity() {
        let result = json!({
            "rateLimits": {
                "primary": { "usedPercent": 104, "windowDurationMins": 300, "resetsAt": 1000 },
                "secondary": null
            },
            "rateLimitResetCredits": null
        });

        let error = parse_snapshot(result, None).expect_err("invalid percent must fail");
        assert_eq!(error.code, "CRV-113");
    }

    #[tokio::test]
    async fn fixture_process_completes_the_real_json_rpc_shape() {
        let service = CapacityService {
            command: AppServerCommand::fixture(),
        };

        let snapshot = service.read_snapshot().await.expect("fixture snapshot");
        assert_eq!(snapshot.five_hour.unwrap().remaining_percent, 76.0);
        assert_eq!(snapshot.weekly.unwrap().remaining_percent, 42.0);
    }

    async fn read_fixture_scenario(scenario: &str) -> Result<CapacitySnapshot, Diagnostic> {
        CapacityService {
            command: AppServerCommand::fixture_scenario(scenario),
        }
        .read_snapshot()
        .await
    }

    #[tokio::test]
    async fn fixture_sparse_notification_merges_without_erasing_weekly_data() {
        let snapshot = read_fixture_scenario("sparse-update")
            .await
            .expect("sparse update snapshot");
        assert_eq!(snapshot.five_hour.unwrap().remaining_percent, 69.0);
        assert_eq!(snapshot.weekly.unwrap().remaining_percent, 42.0);
    }

    #[tokio::test]
    async fn fixture_distinguishes_null_fields_from_zero() {
        let snapshot = read_fixture_scenario("null-fields")
            .await
            .expect("null field snapshot");
        assert!(snapshot.five_hour.is_none());
        assert!(snapshot.weekly.is_none());
        assert!(snapshot.full_reset_credits.is_none());
    }

    #[tokio::test]
    async fn fixture_pro_account_reports_weekly_only_window_with_plan_type() {
        let snapshot = read_fixture_scenario("pro-weekly")
            .await
            .expect("pro snapshot");
        assert_eq!(snapshot.plan_type.as_deref(), Some("pro"));
        assert!(snapshot.five_hour.is_none());
        let weekly = snapshot.weekly.expect("weekly window");
        assert_eq!(weekly.window_duration_mins, 10080);
        assert_eq!(weekly.remaining_percent, 11.0);
    }

    #[tokio::test]
    async fn fixture_unknown_plan_still_yields_windows_without_claiming_a_plan() {
        let snapshot = read_fixture_scenario("plan-unknown")
            .await
            .expect("unknown plan snapshot");
        assert_eq!(snapshot.plan_type, None);
        assert!(snapshot.five_hour.is_none());
        assert!(snapshot.weekly.is_some());
    }

    #[tokio::test]
    async fn fixture_maps_logged_out_to_a_stable_actionable_code() {
        let error = read_fixture_scenario("logged-out")
            .await
            .expect_err("logged out must fail");
        assert_eq!(error.code, "CRV-202");
    }

    #[tokio::test]
    async fn fixture_reports_malformed_json_and_early_exit_separately() {
        let malformed = read_fixture_scenario("malformed")
            .await
            .expect_err("malformed JSON must fail");
        assert_eq!(malformed.code, "CRV-107");

        let early_exit = read_fixture_scenario("early-exit")
            .await
            .expect_err("early exit must fail");
        assert_eq!(early_exit.code, "CRV-110");
    }

    #[test]
    fn sparse_update_changes_only_the_field_it_contains() {
        let mut base = json!({
            "rateLimits": {
                "primary": { "usedPercent": 24, "windowDurationMins": 300, "resetsAt": 1000 },
                "secondary": { "usedPercent": 58, "windowDurationMins": 10080, "resetsAt": 2000 }
            },
            "rateLimitResetCredits": { "availableCount": 2, "credits": [] }
        });
        merge_sparse_update(
            &mut base,
            &json!({
                "rateLimits": {
                    "primary": { "usedPercent": 31, "windowDurationMins": 300, "resetsAt": 1100 }
                }
            }),
        );

        let snapshot = parse_snapshot(base, None).expect("merged snapshot");
        assert_eq!(snapshot.five_hour.unwrap().remaining_percent, 69.0);
        assert_eq!(snapshot.weekly.unwrap().remaining_percent, 42.0);
        assert_eq!(snapshot.full_reset_credits.unwrap().available_count, 2);
    }

    #[test]
    fn sparse_update_can_refresh_plan_type_without_touching_windows() {
        let mut base = json!({
            "rateLimits": {
                "primary": { "usedPercent": 24, "windowDurationMins": 300, "resetsAt": 1000 },
                "secondary": null,
                "planType": "plus"
            }
        });
        merge_sparse_update(
            &mut base,
            &json!({
                "rateLimits": {
                    "planType": "pro"
                }
            }),
        );

        let snapshot = parse_snapshot(base, None).expect("merged snapshot");
        assert_eq!(snapshot.plan_type.as_deref(), Some("pro"));
        assert!(snapshot.five_hour.is_some());
    }

    #[test]
    fn account_identity_follows_codex_home_before_default_location() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let home = env::temp_dir().join(format!("crv-auth-{unique}"));
        fs::create_dir_all(home.join(".codex")).unwrap();
        fs::write(
            home.join(".codex").join("auth.json"),
            json!({ "tokens": { "account_id": "acct-default" } }).to_string(),
        )
        .unwrap();

        let default_lookup = |name: &str| (name == "HOME").then(|| home.to_string_lossy().into_owned());
        assert_eq!(
            read_account_id(&default_lookup).as_deref(),
            Some("acct-default")
        );

        let override_dir = home.join("custom-codex-home");
        fs::create_dir_all(&override_dir).unwrap();
        fs::write(
            override_dir.join("auth.json"),
            json!({ "tokens": { "account_id": "acct-override" } }).to_string(),
        )
        .unwrap();
        let override_lookup = |name: &str| {
            (name == "CODEX_HOME").then(|| override_dir.to_string_lossy().into_owned())
        };
        assert_eq!(
            read_account_id(&override_lookup).as_deref(),
            Some("acct-override")
        );

        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn account_identity_stays_unknown_without_chatgpt_tokens() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let home = env::temp_dir().join(format!("crv-auth-empty-{unique}"));
        fs::create_dir_all(home.join(".codex")).unwrap();

        // 已退出登录：auth.json 存在但没有 tokens
        fs::write(
            home.join(".codex").join("auth.json"),
            json!({ "OPENAI_API_KEY": null }).to_string(),
        )
        .unwrap();
        let lookup = |name: &str| (name == "HOME").then(|| home.to_string_lossy().into_owned());
        assert_eq!(read_account_id(&lookup), None);

        // auth.json 缺失
        let _ = fs::remove_file(home.join(".codex").join("auth.json"));
        assert_eq!(read_account_id(&lookup), None);

        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn path_resolver_returns_an_existing_codex_binary() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let folder = env::temp_dir().join(format!("crv-path-{unique}"));
        fs::create_dir_all(&folder).unwrap();
        let binary = folder.join("codex.exe");
        fs::write(&binary, b"fixture").unwrap();
        let joined = env::join_paths([&folder]).unwrap();

        assert_eq!(
            find_on_path("codex.exe", Some(joined)),
            Some(binary.clone())
        );
        let _ = fs::remove_file(binary);
        let _ = fs::remove_dir(folder);
    }

    #[cfg(debug_assertions)]
    #[test]
    fn project_local_official_runtime_is_preferred_when_installed() {
        let expected = if cfg!(target_os = "windows") {
            "codex-win32-x64".to_owned()
        } else if cfg!(target_os = "macos") {
            format!(
                "codex-darwin-{}",
                if cfg!(target_arch = "aarch64") {
                    "arm64"
                } else {
                    "x64"
                }
            )
        } else {
            "codex-linux-x64".to_owned()
        };

        let candidates = local_runtime_candidates();
        assert!(candidates.iter().any(|candidate| {
            candidate
                .to_string_lossy()
                .contains(expected.as_str())
        }));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn finder_fallback_candidates_cover_common_unix_install_locations() {
        let binary = crate::platform::codex_binary_name();
        let candidates = extra_executable_candidates();

        assert!(candidates.contains(&PathBuf::from("/opt/homebrew/bin").join(binary)));
        assert!(candidates.contains(&PathBuf::from("/usr/local/bin").join(binary)));
        if let Some(home) = env::var_os("HOME") {
            let home = PathBuf::from(home);
            assert!(candidates.contains(&home.join(".local/bin").join(binary)));
            assert!(candidates.contains(&home.join("bin").join(binary)));
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn finder_fallback_prefers_desktop_app_bundled_cli() {
        let candidates = extra_executable_candidates();

        assert_eq!(
            candidates.first(),
            Some(&PathBuf::from(
                "/Applications/ChatGPT.app/Contents/Resources/codex"
            ))
        );
        assert!(candidates.contains(&PathBuf::from(
            "/Applications/Codex.app/Contents/Resources/codex"
        )));
        if let Some(home) = env::var_os("HOME") {
            let home_chats = PathBuf::from(home)
                .join("Applications")
                .join("ChatGPT.app")
                .join("Contents/Resources/codex");
            assert!(candidates.contains(&home_chats));
        }
    }
}

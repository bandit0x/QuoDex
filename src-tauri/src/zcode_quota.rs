use crate::capacity::{Diagnostic, SourceState};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env, fs,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(15);
const QUOTA_PATH: &str = "/api/monitor/usage/quota/limit";
/// 体验套餐余额路径，拼接在 zcode-plan 网关根（baseURL 去掉 `/anthropic`）之后
const BALANCE_PATH: &str = "/billing/balance";
/// config.json 没有 start-plan 条目时的默认网关根（生产环境实测值）
const DEFAULT_ZCODE_PLAN_GATEWAY: &str = "https://zcode.z.ai/api/v1/zcode-plan";

/// config.json 中参与额度探测的套餐形态：coding-plan 为个人套餐，start-plan 为
/// ZCode 发放的体验套餐（Start Plan）。体验套餐可用时优先于个人套餐显示。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PlanKind {
    Coding,
    Start,
}

impl PlanKind {
    fn snapshot_kind(self) -> &'static str {
        match self {
            PlanKind::Coding => "coding_plan",
            PlanKind::Start => "start_plan",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZCodeQuotaSnapshot {
    pub source_state: SourceState,
    pub five_hour: Option<ZCodeQuotaWindow>,
    pub weekly: Option<ZCodeQuotaWindow>,
    pub plan_level: Option<String>,
    pub plan_kind: Option<String>,
    pub observed_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZCodeQuotaWindow {
    pub used_percent: f64,
    pub remaining_percent: f64,
    pub window_duration_mins: u64,
    // bigmodel 端点对 0 用量窗口不返回 nextResetTime
    pub resets_at: Option<u64>,
    pub quota_total: u64,
    pub quota_used: u64,
    pub quota_remaining: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct QuotaRequest {
    kind: PlanKind,
    url: String,
    api_key: String,
    /// billing/balance 网关必需的设备指纹（telemetry-state.json 的 deviceMid）
    device_mid: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ZCodeConfigFile {
    #[serde(default)]
    provider: BTreeMap<String, ZCodeProviderEntry>,
}

#[derive(Debug, Deserialize)]
struct ZCodeProviderEntry {
    #[serde(default)]
    enabled: bool,
    #[serde(default, rename = "systemDisabledReason")]
    system_disabled_reason: Option<String>,
    #[serde(default)]
    options: ZCodeProviderOptions,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct ZCodeProviderOptions {
    #[serde(rename = "apiKey")]
    api_key: String,
    #[serde(rename = "baseURL")]
    base_url: String,
    /// 可选的完整配额 URL；留空则从 baseURL 推导 `<origin>/api/monitor/usage/quota/limit`，
    /// 用于 bigmodel 调整路径后无需等发版即可在配置侧修复。
    #[serde(rename = "quotaURL")]
    quota_url: String,
}

#[derive(Debug, Deserialize)]
struct QuotaResponse {
    code: Option<i64>,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    success: Option<bool>,
    #[serde(default)]
    data: Option<QuotaData>,
}

#[derive(Debug, Deserialize)]
struct QuotaData {
    #[serde(default)]
    limits: Vec<QuotaLimit>,
    #[serde(default)]
    level: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuotaLimit {
    #[serde(rename = "type")]
    kind: String,
    unit: Option<u64>,
    number: Option<u64>,
    usage: Option<u64>,
    current_value: Option<u64>,
    remaining: Option<u64>,
    percentage: Option<f64>,
    next_reset_time: Option<u64>,
}

/// billing/balance 响应：体验套餐额度。字段为 snake_case，与监控端点的
/// camelCase 约定不同，两种响应不得共用结构体。
#[derive(Debug, Deserialize)]
struct BalanceResponse {
    code: Option<i64>,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    success: Option<bool>,
    #[serde(default)]
    data: Option<BalanceData>,
}

#[derive(Debug, Deserialize)]
struct BalanceData {
    #[serde(default)]
    server_time: Option<f64>,
    #[serde(default)]
    plans: Vec<BalancePlan>,
    #[serde(default)]
    balances: Vec<BalanceBucket>,
}

#[derive(Debug, Deserialize)]
struct BalancePlan {
    #[serde(default)]
    plan_id: Option<String>,
    #[serde(default)]
    user_plan_id: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    ends_at: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct BalanceBucket {
    #[serde(default)]
    plan_id: Option<String>,
    #[serde(default)]
    user_plan_id: Option<String>,
    #[serde(default)]
    total_units: Option<BalanceNumber>,
    #[serde(default)]
    used_units: Option<BalanceNumber>,
    #[serde(default)]
    remaining_units: Option<BalanceNumber>,
    #[serde(default)]
    expires_at: Option<f64>,
}

/// 余额桶数量字段允许数字或数字字符串（ZCode `parseNumber` 行为），
/// 不可解析的值按缺失处理而不是让整个响应失败。
#[derive(Debug)]
struct BalanceNumber(f64);

impl<'de> Deserialize<'de> for BalanceNumber {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Number(f64),
            Text(String),
        }
        let value = match Raw::deserialize(deserializer)? {
            Raw::Number(value) => value,
            Raw::Text(text) => text.trim().parse().unwrap_or(f64::NAN),
        };
        Ok(BalanceNumber(value))
    }
}

impl BalanceNumber {
    fn value(&self) -> Option<f64> {
        self.0.is_finite().then_some(self.0)
    }
}

/// `~/.zcode` 下 telemetry-state.json 的设备指纹，billing/balance 网关的
/// 必需头 `X-Device-Mid` 取自这里（实测缺失时网关返回业务码 3001）。
#[derive(Debug, Deserialize)]
struct TelemetryState {
    #[serde(rename = "deviceMid", default)]
    device_mid: Option<String>,
}

impl TelemetryState {
    /// curl --config 传头时引号/换行是注入风险，直接视为缺失走回落
    fn sanitized_device_mid(&self) -> Option<String> {
        self.device_mid
            .as_deref()
            .map(str::trim)
            .filter(|mid| !mid.is_empty() && !mid.contains('"') && !mid.contains('\n'))
            .map(str::to_owned)
    }
}

#[derive(Debug)]
pub struct ZCodeQuotaService {
    fixture_path: Option<PathBuf>,
}

impl ZCodeQuotaService {
    pub fn from_environment() -> Self {
        Self {
            fixture_path: env::var_os("CODEX_CREDITS_ZCODE_QUOTA_RESPONSE_FILE").map(PathBuf::from),
        }
    }

    #[cfg(test)]
    fn from_fixture_path(path: PathBuf) -> Self {
        Self {
            fixture_path: Some(path),
        }
    }

    pub async fn read_snapshot(
        &self,
        prefer_start: bool,
    ) -> Result<ZCodeQuotaSnapshot, Diagnostic> {
        if let Some(path) = &self.fixture_path {
            let raw = fs::read_to_string(path).map_err(|error| {
                Diagnostic::new("CRV-506", "ZCode 配额 fixture 无法读取")
                    .with_detail(error.to_string())
            })?;
            // fixture 路径保持个人套餐（监控端点）解析语义，体验套餐由单元测试覆盖
            return parse_quota_payload(&raw);
        }

        read_live(env_lookup, prefer_start, |request| {
            fetch_quota_body(request)
        })
        .await
    }
}

/// 实时探测编排：体验套餐（start-plan）优先——凭证与设备指纹齐备即请求网关
/// billing/balance，由网关响应判定授权状态（config/cache 的授权标记已被实测
/// 证明滞后）；任何失败（业务码非 0、网络失败、解析失败）都回落个人套餐。
/// prefer_start=false 表示用户在设置中显式选择仅个人套餐；显式 env 覆盖视为
/// 个人套餐调试语义，同样跳过体验套餐探测。
async fn read_live<F, Fut, L>(
    lookup: L,
    prefer_start: bool,
    fetch: F,
) -> Result<ZCodeQuotaSnapshot, Diagnostic>
where
    L: Fn(&str) -> Option<String>,
    F: Fn(QuotaRequest) -> Fut,
    Fut: std::future::Future<Output = Result<String, Diagnostic>> + Send,
{
    let env_override = lookup("ZCODE_BIGMODEL_USAGE_API_KEY").is_some()
        || lookup("BIGMODEL_USAGE_API_KEY").is_some()
        || lookup("ZCODE_BIGMODEL_USAGE_QUOTA_URL").is_some()
        || lookup("BIGMODEL_USAGE_QUOTA_URL").is_some();
    if prefer_start && !env_override {
        if let Some(request) = resolve_start_plan_request(&lookup) {
            if let Ok(body) = fetch(request).await {
                if let Ok(snapshot) = parse_balance_payload(&body) {
                    return Ok(snapshot);
                }
            }
        }
    }

    let request = resolve_quota_request(&lookup)?;
    let body = fetch(request).await?;
    parse_quota_payload(&body)
}

fn env_lookup(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn resolve_quota_request(
    lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<QuotaRequest, Diagnostic> {
    let config = read_config_request(lookup);
    let api_key = lookup("ZCODE_BIGMODEL_USAGE_API_KEY")
        .or_else(|| lookup("BIGMODEL_USAGE_API_KEY"))
        .or_else(|| {
            config
                .as_ref()
                .ok()
                .map(|request| request.api_key.clone())
                .filter(|key| !key.is_empty())
        });
    let url = lookup("ZCODE_BIGMODEL_USAGE_QUOTA_URL")
        .or_else(|| lookup("BIGMODEL_USAGE_QUOTA_URL"))
        .or_else(|| {
            config
                .as_ref()
                .ok()
                .map(|request| request.url.clone())
                .filter(|url| !url.is_empty())
        });

    if let (Some(api_key), Some(url)) = (&api_key, &url) {
        if api_key.contains('"') || api_key.contains('\n') {
            return Err(Diagnostic::new(
                "CRV-503",
                "ZCode API Key 含有无法安全传递的字符",
            ));
        }
        return Ok(QuotaRequest {
            kind: PlanKind::Coding,
            url: url.clone(),
            api_key: api_key.clone(),
            device_mid: None,
        });
    }

    Err(match &config {
        Err(diagnostic) => diagnostic.clone(),
        Ok(_) if api_key.is_none() => Diagnostic::new("CRV-503", "ZCode 编程包未配置 API Key"),
        Ok(_) => Diagnostic::new("CRV-501", "未检测到 ZCode 配额端点")
            .with_detail("缺少 BIGMODEL_USAGE_QUOTA_URL 环境变量或可用的 ZCode 配置"),
    })
}

/// 解析顺序：显式环境变量 > `$HOME/.zcode/v2`（当前布局）> `$HOME/.zcode`
/// （兜底 ZCode 目录结构迁移，例如移除版本子目录）。
fn zcode_config_candidates(lookup: &dyn Fn(&str) -> Option<String>) -> Vec<PathBuf> {
    if let Some(dir) = lookup("CODEX_CREDITS_ZCODE_CONFIG_DIR") {
        return vec![PathBuf::from(dir)];
    }
    let Some(home) = lookup("HOME").or_else(|| lookup("USERPROFILE")) else {
        return Vec::new();
    };
    let home = PathBuf::from(home);
    vec![home.join(".zcode").join("v2"), home.join(".zcode")]
}

fn read_zcode_config(
    lookup: &dyn Fn(&str) -> Option<String>,
    file_name: &str,
) -> Result<ZCodeConfigFile, Diagnostic> {
    let mut tried = Vec::new();
    let mut raw = None;
    for dir in zcode_config_candidates(lookup) {
        let path = dir.join(file_name);
        match fs::read_to_string(&path) {
            Ok(content) => {
                raw = Some(content);
                break;
            }
            Err(error) => tried.push(format!("{}: {error}", path.display())),
        }
    }
    let Some(raw) = raw else {
        let detail = if tried.is_empty() {
            "无法定位用户目录".to_owned()
        } else {
            format!("尝试读取失败: {}", tried.join("; "))
        };
        return Err(Diagnostic::new("CRV-501", "未检测到 ZCode 配置").with_detail(detail));
    };
    serde_json::from_str(&raw).map_err(|error| {
        Diagnostic::new("CRV-501", "ZCode 配置无法解析").with_detail(error.to_string())
    })
}

fn read_config_request(
    lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<QuotaRequest, Diagnostic> {
    let config = read_zcode_config(lookup, "config.json")?;
    let coding_plans = config
        .provider
        .iter()
        .filter(|(id, entry)| {
            id.ends_with("-coding-plan") && entry.enabled && entry.system_disabled_reason.is_none()
        })
        .collect::<Vec<_>>();
    if coding_plans.is_empty() {
        return Err(
            Diagnostic::new("CRV-502", "ZCode 编程包未启用").with_detail(
                "config.json 中没有启用的 coding-plan provider，请在 ZCode 内订阅并启用编程包",
            ),
        );
    }

    for (id, entry) in coding_plans {
        let api_key = entry.options.api_key.trim().to_owned();
        if api_key.is_empty() {
            continue;
        }
        let explicit_quota_url = entry.options.quota_url.trim();
        let url = if explicit_quota_url.is_empty() {
            let Some(url) = quota_url_from_base_url(&entry.options.base_url) else {
                return Err(
                    Diagnostic::new("CRV-503", "ZCode 编程包配置不完整").with_detail(format!(
                        "provider {id} 的 baseURL 无法解析: {}",
                        entry.options.base_url
                    )),
                );
            };
            url
        } else {
            explicit_quota_url.to_owned()
        };
        return Ok(QuotaRequest {
            kind: PlanKind::Coding,
            url,
            api_key,
            device_mid: None,
        });
    }

    Err(Diagnostic::new("CRV-503", "ZCode 编程包未配置 API Key")
        .with_detail("启用的 coding-plan provider 均未携带 apiKey"))
}

/// 体验套餐（start-plan）探测请求。config 的 enabled/systemDisabledReason 与
/// coding-plan-cache 都被实测证明会滞后于真实授权状态（2026-09-25，start-plan
/// 在网关 active 而本地仍标记 coding_plan_not_entitled），因此只要条目携带
/// apiKey 且设备指纹可读就发起探测，授权与否交由网关响应判定。
fn resolve_start_plan_request(lookup: &dyn Fn(&str) -> Option<String>) -> Option<QuotaRequest> {
    let device_mid = read_device_mid(lookup)?;
    let config = read_zcode_config(lookup, "config.json").ok()?;
    let (_, entry) = config.provider.iter().find(|(id, entry)| {
        id.ends_with("-start-plan") && !entry.options.api_key.trim().is_empty()
    })?;
    let api_key = entry.options.api_key.trim();
    if api_key.contains('"') || api_key.contains('\n') {
        return None;
    }
    let explicit_quota_url = entry.options.quota_url.trim();
    let url = if explicit_quota_url.is_empty() {
        start_plan_balance_url(&entry.options.base_url).unwrap_or_else(|| {
            format!("{DEFAULT_ZCODE_PLAN_GATEWAY}{BALANCE_PATH}?app_version={}", env!("CARGO_PKG_VERSION"))
        })
    } else {
        explicit_quota_url.to_owned()
    };
    Some(QuotaRequest {
        kind: PlanKind::Start,
        url,
        api_key: api_key.to_owned(),
        device_mid: Some(device_mid),
    })
}

fn read_device_mid(lookup: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    let raw = zcode_config_candidates(lookup).iter().find_map(|dir| {
        fs::read_to_string(dir.join("telemetry-state.json")).ok()
    })?;
    let state: TelemetryState = serde_json::from_str(&raw).ok()?;
    state.sanitized_device_mid()
}

/// 体验套餐余额端点：zcode-plan 网关的 anthropic API base 去掉 `/anthropic`
/// 后缀得到网关根（生产为 https://zcode.z.ai/api/v1/zcode-plan），
/// 监控端点路径在该网关上不存在（实测 404），不可复用个人套餐的推导规则。
fn start_plan_balance_url(base_url: &str) -> Option<String> {
    let base_url = base_url.trim();
    let (scheme, rest) = base_url.split_once("://")?;
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    let path = rest[authority_end..].trim_end_matches('/');
    // baseURL 形如 <origin>/api/v1/zcode-plan/anthropic（网关 anthropic API 根），
    // 或已是网关根 <origin>/api/v1/zcode-plan
    let gateway_path = match path.strip_suffix("/anthropic") {
        Some(gateway) => gateway,
        None if path == "/api/v1/zcode-plan" => path,
        None => return None,
    };
    if scheme.is_empty() || authority.is_empty() {
        return None;
    }
    Some(format!(
        "{scheme}://{authority}{gateway_path}{BALANCE_PATH}?app_version={}",
        env!("CARGO_PKG_VERSION")
    ))
}

fn quota_url_from_base_url(base_url: &str) -> Option<String> {
    let base_url = base_url.trim();
    let (scheme, rest) = base_url.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    if scheme.is_empty() || authority.is_empty() {
        return None;
    }
    Some(format!("{scheme}://{authority}{QUOTA_PATH}"))
}

fn zcode_network_failure(detail: impl Into<String>) -> Diagnostic {
    Diagnostic::new("CRV-504", "ZCode 配额服务不可达").with_detail(detail)
}

async fn fetch_quota_body(request: QuotaRequest) -> Result<String, Diagnostic> {
    let mut command = Command::new(crate::platform::curl_executable());
    command.args([
        "--silent",
        "--show-error",
        "--output",
        "-",
        "--write-out",
        "\n%{http_code}",
        "--connect-timeout",
        "5",
        "--max-time",
        "10",
        "--retry",
        "0",
        "--config",
        "-",
    ]);
    command.arg(&request.url);
    command
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    command.kill_on_drop(true);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|error| zcode_network_failure(error.to_string()))?;
    // Authorization / X-Device-Mid 头经 stdin 配置传入，key 不进入进程命令行
    let mut stdin_config = format!("header = \"Authorization: {}\"\n", request.api_key);
    if let Some(device_mid) = &request.device_mid {
        stdin_config.push_str(&format!("header = \"X-Device-Mid: {device_mid}\"\n"));
    }
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(stdin_config.as_bytes()).await;
        drop(stdin);
    }
    let output = timeout(COMMAND_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| zcode_network_failure("请求超时"))?
        .map_err(|error| zcode_network_failure(error.to_string()))?;

    let text = String::from_utf8_lossy(&output.stdout);
    parse_curl_output(output.status.success(), output.status.code(), &text)
}

fn parse_curl_output(
    process_succeeded: bool,
    exit_code: Option<i32>,
    text: &str,
) -> Result<String, Diagnostic> {
    if !process_succeeded {
        let exit_code = exit_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| "unknown".to_owned());
        return Err(zcode_network_failure(format!("curl 退出状态: {exit_code}")));
    }

    let (body, status_line) = text
        .rsplit_once('\n')
        .ok_or_else(|| zcode_network_failure("curl 未返回 HTTP 状态行"))?;
    let status: u16 = status_line
        .trim()
        .parse()
        .map_err(|_| zcode_network_failure(format!("无法解析 HTTP 状态: {status_line}")))?;
    if status != 200 {
        let detail: String = body.trim().chars().take(200).collect();
        return Err(Diagnostic::new("CRV-505", "ZCode 配额服务返回异常状态")
            .with_detail(format!("HTTP {status}: {detail}")));
    }
    Ok(body.to_owned())
}

fn parse_quota_payload(raw: &str) -> Result<ZCodeQuotaSnapshot, Diagnostic> {
    let payload: QuotaResponse = serde_json::from_str(raw).map_err(|error| {
        Diagnostic::new("CRV-506", "ZCode 配额响应无法解析").with_detail(error.to_string())
    })?;
    if payload.success != Some(true) && payload.code != Some(200) {
        let message = payload
            .msg
            .unwrap_or_else(|| "配额服务未返回成功状态".to_owned());
        return Err(Diagnostic::new("CRV-507", "ZCode 配额查询失败").with_detail(message));
    }
    let data = payload
        .data
        .ok_or_else(|| Diagnostic::new("CRV-506", "ZCode 配额响应缺少 data"))?;

    let mut limits = data
        .limits
        .into_iter()
        .filter(|limit| limit.kind == "CREDIT_LIMIT")
        .collect::<Vec<_>>();
    if limits.is_empty() {
        return Err(Diagnostic::new("CRV-508", "ZCode 配额窗口数据缺失")
            .with_detail("响应中没有 CREDIT_LIMIT 窗口"));
    }
    limits.sort_by_key(|limit| limit.next_reset_time.unwrap_or(0));

    // 窗口归属按 API 的 unit/number 识别；0 用量窗口可能没有 nextResetTime，
    // 仅按重置时间排序会把未启用窗口排到 5 小时舱
    let five_hour_limit = limits
        .iter()
        .find(|limit| is_five_hour_window(limit))
        .unwrap_or_else(|| limits.first().expect("limits is not empty"));
    let five_hour = to_window(five_hour_limit)?;
    let weekly_limit = limits
        .iter()
        .find(|limit| is_weekly_window(limit))
        .or_else(|| (limits.len() > 1).then(|| limits.last().expect("limits is not empty")));
    let weekly = match weekly_limit {
        Some(limit) => Some(to_window(limit)?),
        None => None,
    };

    Ok(ZCodeQuotaSnapshot {
        source_state: SourceState::Healthy,
        five_hour: Some(five_hour),
        weekly,
        plan_level: data
            .level
            .map(|level| level.trim().to_owned())
            .filter(|level| !level.is_empty()),
        plan_kind: Some(PlanKind::Coding.snapshot_kind().to_owned()),
        observed_at_ms: now_ms(),
    })
}

/// 体验套餐（billing/balance）解析：余额桶聚合成单池，无 5h/周窗口概念。
/// 过期归一化与孤儿桶保留规则镜像 ZCode `normalizeStartPlanExpiry`。
fn parse_balance_payload(raw: &str) -> Result<ZCodeQuotaSnapshot, Diagnostic> {
    let payload: BalanceResponse = serde_json::from_str(raw).map_err(|error| {
        Diagnostic::new("CRV-506", "ZCode 体验套餐余额响应无法解析")
            .with_detail(error.to_string())
    })?;
    if payload.success != Some(true) && payload.code != Some(0) {
        let message = payload
            .msg
            .unwrap_or_else(|| "体验套餐余额服务未返回成功状态".to_owned());
        return Err(Diagnostic::new("CRV-507", "ZCode 体验套餐配额查询失败")
            .with_detail(message));
    }
    let data = payload
        .data
        .ok_or_else(|| Diagnostic::new("CRV-506", "ZCode 体验套餐余额响应缺少 data"))?;

    let server_time = data
        .server_time
        .filter(|value| value.is_finite() && *value >= 0.0)
        .unwrap_or_else(|| now_ms() as f64 / 1000.0);
    let plan_expired = |plan: &BalancePlan| -> bool {
        let status = plan.status.as_deref().map(str::trim).unwrap_or("");
        if status.eq_ignore_ascii_case("expired") {
            return true;
        }
        status.eq_ignore_ascii_case("active")
            && plan
                .ends_at
                .map(|ends_at| ends_at.is_finite() && ends_at > 0.0 && ends_at <= server_time)
                .unwrap_or(false)
    };
    let bucket_matches_plan = |bucket: &BalanceBucket, plan: &BalancePlan| -> bool {
        let bucket_user = bucket.user_plan_id.as_deref().filter(|id| !id.is_empty());
        let plan_user = plan.user_plan_id.as_deref().filter(|id| !id.is_empty());
        match (bucket_user, plan_user) {
            (Some(bucket), Some(plan)) => bucket == plan,
            // 与 ZCode 一致：缺席字段按 JS undefined === undefined 处理
            _ => bucket.plan_id == plan.plan_id,
        }
    };
    let kept_buckets = data
        .balances
        .iter()
        .filter(|bucket| {
            let matching = data
                .plans
                .iter()
                .filter(|plan| bucket_matches_plan(bucket, plan))
                .collect::<Vec<_>>();
            matching.is_empty() || matching.iter().any(|plan| !plan_expired(plan))
        })
        .collect::<Vec<_>>();

    let mut total = 0.0f64;
    let mut used = 0.0f64;
    let mut remaining = 0.0f64;
    let mut earliest_expiry: Option<f64> = None;
    let mut usable_buckets = 0usize;
    for bucket in &kept_buckets {
        let total_units = bucket.total_units.as_ref().and_then(BalanceNumber::value);
        let used_units = bucket.used_units.as_ref().and_then(BalanceNumber::value);
        let remaining_units = bucket.remaining_units.as_ref().and_then(BalanceNumber::value);
        if total_units.is_none() && used_units.is_none() && remaining_units.is_none() {
            continue;
        }
        usable_buckets += 1;
        total += total_units.unwrap_or(0.0);
        used += used_units.unwrap_or(0.0);
        remaining += remaining_units.unwrap_or(0.0);
        if let Some(expires_at) = bucket.expires_at.filter(|value| value.is_finite() && *value > 0.0)
        {
            earliest_expiry = Some(match earliest_expiry {
                Some(current) => current.min(expires_at),
                None => expires_at,
            });
        }
    }
    if usable_buckets == 0 {
        return Err(Diagnostic::new("CRV-508", "ZCode 体验套餐额度桶数据缺失")
            .with_detail("billing/balance 响应中没有可用的额度桶"));
    }

    // 百分比由 units 推导而非服务端断言；used>total 的数据瑕疵按满格夹取，
    // 不让单次异常数据杀掉整个浮窗
    let used_percent = if total > 0.0 {
        (used / total * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };

    Ok(ZCodeQuotaSnapshot {
        source_state: SourceState::Healthy,
        five_hour: Some(ZCodeQuotaWindow {
            used_percent,
            remaining_percent: 100.0 - used_percent,
            // 体验套餐没有固定窗口长度
            window_duration_mins: 0,
            resets_at: earliest_expiry.map(|value| value as u64),
            quota_total: total as u64,
            quota_used: used as u64,
            quota_remaining: remaining as u64,
        }),
        weekly: None,
        plan_level: Some("Start".to_owned()),
        plan_kind: Some(PlanKind::Start.snapshot_kind().to_owned()),
        observed_at_ms: now_ms(),
    })
}

fn is_five_hour_window(limit: &QuotaLimit) -> bool {
    matches!((limit.unit, limit.number), (Some(3), Some(5)))
}

fn is_weekly_window(limit: &QuotaLimit) -> bool {
    matches!((limit.unit, limit.number), (Some(6), Some(1)))
}

fn to_window(limit: &QuotaLimit) -> Result<ZCodeQuotaWindow, Diagnostic> {
    let invalid =
        |detail: &str| Diagnostic::new("CRV-508", "ZCode 配额窗口数据异常").with_detail(detail);
    let Some(percentage) = limit.percentage else {
        return Err(invalid("配额窗口缺少 percentage"));
    };
    if !percentage.is_finite() || !(0.0..=100.0).contains(&percentage) {
        return Err(invalid("percentage 超出 0-100 范围"));
    }
    let Some(quota_total) = limit.usage else {
        return Err(invalid("配额窗口缺少 usage"));
    };
    let Some(quota_used) = limit.current_value else {
        return Err(invalid("配额窗口缺少 currentValue"));
    };
    let Some(quota_remaining) = limit.remaining else {
        return Err(invalid("配额窗口缺少 remaining"));
    };
    Ok(ZCodeQuotaWindow {
        used_percent: percentage,
        remaining_percent: 100.0 - percentage,
        window_duration_mins: window_duration_mins(limit.unit, limit.number),
        resets_at: limit.next_reset_time.map(|value| value / 1000),
        quota_total,
        quota_used,
        quota_remaining,
    })
}

fn window_duration_mins(unit: Option<u64>, number: Option<u64>) -> u64 {
    match (unit, number) {
        (Some(3), Some(5)) => 300,
        (Some(6), Some(1)) => 10_080,
        _ => 0,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn repo_fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("fixtures")
            .join("zcode-quota-fixture.json")
    }

    fn fixture_raw() -> String {
        fs::read_to_string(repo_fixture_path()).expect("read zcode quota fixture")
    }

    #[test]
    fn parses_fixture_dual_windows_and_classifies_by_reset_time() {
        let snapshot = parse_quota_payload(&fixture_raw()).expect("parse fixture payload");

        let five_hour = snapshot.five_hour.expect("five hour window");
        assert!((five_hour.used_percent - 24.0).abs() < f64::EPSILON);
        assert!((five_hour.remaining_percent - 76.0).abs() < f64::EPSILON);
        assert_eq!(five_hour.window_duration_mins, 300);
        assert_eq!(five_hour.resets_at, Some(1_787_810_092));
        assert_eq!(five_hour.quota_total, 2000);
        assert_eq!(five_hour.quota_used, 480);
        assert_eq!(five_hour.quota_remaining, 1520);

        let weekly = snapshot.weekly.expect("weekly window");
        assert!((weekly.used_percent - 58.0).abs() < f64::EPSILON);
        assert_eq!(weekly.window_duration_mins, 10_080);
        assert_eq!(weekly.resets_at, Some(1_788_395_128));

        assert_eq!(snapshot.plan_level.as_deref(), Some("pro"));
        assert!(snapshot.observed_at_ms > 0);
    }

    #[test]
    fn single_window_falls_into_five_hour_slot() {
        let raw = r#"{"code":200,"success":true,"data":{"limits":[{"type":"CREDIT_LIMIT","unit":3,"number":5,"usage":120,"currentValue":30,"remaining":90,"percentage":25,"nextResetTime":1787810092514}],"level":"lite"}}"#;
        let snapshot = parse_quota_payload(raw).expect("parse single window");
        assert!(snapshot.five_hour.is_some());
        assert!(snapshot.weekly.is_none());
        assert_eq!(snapshot.plan_level.as_deref(), Some("lite"));
    }

    #[test]
    fn non_success_payload_maps_to_crv_507_with_message() {
        let raw = r#"{"code":500,"msg":"user has no coding plan","success":false}"#;
        let error = parse_quota_payload(raw).expect_err("expect failure");
        assert_eq!(error.code, "CRV-507");
        assert!(error.detail.expect("detail").contains("no coding plan"));
    }

    #[test]
    fn malformed_json_maps_to_crv_506() {
        let error = parse_quota_payload("not json").expect_err("expect failure");
        assert_eq!(error.code, "CRV-506");
    }

    #[test]
    fn missing_data_maps_to_crv_506() {
        let raw = r#"{"code":200,"success":true}"#;
        let error = parse_quota_payload(raw).expect_err("expect failure");
        assert_eq!(error.code, "CRV-506");
    }

    #[test]
    fn out_of_range_percentage_maps_to_crv_508() {
        let raw = r#"{"code":200,"success":true,"data":{"limits":[{"type":"CREDIT_LIMIT","percentage":140,"nextResetTime":1787810092514}]}}"#;
        let error = parse_quota_payload(raw).expect_err("expect failure");
        assert_eq!(error.code, "CRV-508");
    }

    #[test]
    fn missing_credit_limits_maps_to_crv_508() {
        let raw = r#"{"code":200,"success":true,"data":{"limits":[]}}"#;
        let error = parse_quota_payload(raw).expect_err("expect failure");
        assert_eq!(error.code, "CRV-508");
    }

    #[test]
    fn missing_next_reset_time_yields_window_without_reset() {
        let raw = r#"{"code":200,"success":true,"data":{"limits":[{"type":"CREDIT_LIMIT","usage":120,"currentValue":30,"remaining":90,"percentage":25}]}}"#;
        let snapshot = parse_quota_payload(raw).expect("parse window without reset time");
        let five_hour = snapshot.five_hour.expect("five hour window");
        assert!(five_hour.resets_at.is_none());
        assert!((five_hour.used_percent - 25.0).abs() < f64::EPSILON);
    }

    #[test]
    fn unused_five_hour_window_without_reset_time_parses_both_chambers() {
        let raw = r#"{"code":200,"success":true,"data":{"limits":[
            {"type":"CREDIT_LIMIT","unit":3,"number":5,"usage":2000,"currentValue":0,"remaining":2000,"percentage":0},
            {"type":"CREDIT_LIMIT","unit":6,"number":1,"usage":10000,"currentValue":8209,"remaining":1790,"percentage":82,"nextResetTime":1788395128998}
        ],"level":"lite"}}"#;
        let snapshot = parse_quota_payload(raw).expect("parse live payload");
        let five_hour = snapshot.five_hour.expect("five hour window");
        assert_eq!(five_hour.quota_total, 2000);
        assert!(five_hour.resets_at.is_none());
        let weekly = snapshot.weekly.expect("weekly window");
        assert_eq!(weekly.resets_at, Some(1_788_395_128));
    }

    #[test]
    fn fresh_weekly_window_without_reset_time_is_not_swapped_into_five_hour_slot() {
        let raw = r#"{"code":200,"success":true,"data":{"limits":[
            {"type":"CREDIT_LIMIT","unit":6,"number":1,"usage":10000,"currentValue":0,"remaining":10000,"percentage":0},
            {"type":"CREDIT_LIMIT","unit":3,"number":5,"usage":2000,"currentValue":480,"remaining":1520,"percentage":24,"nextResetTime":1787810092514}
        ]}}"#;
        let snapshot = parse_quota_payload(raw).expect("parse payload");
        let five_hour = snapshot.five_hour.expect("five hour window");
        assert_eq!(five_hour.quota_total, 2000);
        let weekly = snapshot.weekly.expect("weekly window");
        assert_eq!(weekly.quota_total, 10000);
    }

    #[test]
    fn missing_quota_count_maps_to_crv_508() {
        let raw = r#"{"code":200,"success":true,"data":{"limits":[{"type":"CREDIT_LIMIT","usage":120,"remaining":90,"percentage":25,"nextResetTime":1787810092514}]}}"#;
        let error = parse_quota_payload(raw).expect_err("expect failure");
        assert_eq!(error.code, "CRV-508");
        assert!(error.detail.expect("detail").contains("currentValue"));
    }

    #[test]
    fn curl_process_failure_maps_to_crv_504() {
        let error = parse_curl_output(false, Some(28), "").expect_err("expect failure");
        assert_eq!(error.code, "CRV-504");
        assert!(error.detail.expect("detail").contains("28"));
    }

    #[test]
    fn curl_http_failure_maps_to_crv_505() {
        let error = parse_curl_output(true, Some(0), "{\"error\":\"unauthorized\"}\n401")
            .expect_err("expect failure");
        assert_eq!(error.code, "CRV-505");
        assert!(error.detail.expect("detail").contains("HTTP 401"));
    }

    #[test]
    fn successful_curl_output_returns_body_without_status_line() {
        let body = parse_curl_output(true, Some(0), "{\"code\":200}\n200")
            .expect("expect successful response");
        assert_eq!(body, "{\"code\":200}");
    }

    #[test]
    fn quota_url_derives_from_provider_base_url_origin() {
        assert_eq!(
            quota_url_from_base_url("https://open.bigmodel.cn/api/anthropic").as_deref(),
            Some("https://open.bigmodel.cn/api/monitor/usage/quota/limit")
        );
        assert_eq!(
            quota_url_from_base_url("https://api.z.ai/api/anthropic").as_deref(),
            Some("https://api.z.ai/api/monitor/usage/quota/limit")
        );
        assert_eq!(
            quota_url_from_base_url("https://host.example:8443/base/path").as_deref(),
            Some("https://host.example:8443/api/monitor/usage/quota/limit")
        );
        assert_eq!(quota_url_from_base_url("not a url"), None);
        assert_eq!(quota_url_from_base_url(""), None);
    }

    fn lookup_from<'a>(map: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| {
            map.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).to_owned())
        }
    }

    #[test]
    fn resolve_quota_request_prefers_environment_overrides() {
        let lookup = lookup_from(&[
            ("ZCODE_BIGMODEL_USAGE_API_KEY", "test-key"),
            ("BIGMODEL_USAGE_QUOTA_URL", "https://example.test/quota"),
        ]);
        let request = resolve_quota_request(&lookup).expect("resolve from env");
        assert_eq!(request.api_key, "test-key");
        assert_eq!(request.url, "https://example.test/quota");
    }

    #[test]
    fn resolve_quota_request_reports_missing_config() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let missing_dir = std::env::temp_dir()
            .join(format!("crv-zcode-missing-{unique}"))
            .to_string_lossy()
            .into_owned();
        let entries = [("CODEX_CREDITS_ZCODE_CONFIG_DIR", missing_dir.as_str())];
        let lookup = lookup_from(&entries);
        let error = resolve_quota_request(&lookup).expect_err("expect failure");
        assert_eq!(error.code, "CRV-501");
    }

    #[test]
    fn resolve_quota_request_rejects_keys_unsafe_for_curl_config() {
        let lookup = lookup_from(&[
            ("ZCODE_BIGMODEL_USAGE_API_KEY", "bad\"key"),
            ("BIGMODEL_USAGE_QUOTA_URL", "https://example.test/quota"),
        ]);
        let error = resolve_quota_request(&lookup).expect_err("expect failure");
        assert_eq!(error.code, "CRV-503");
    }

    fn write_temp_config(content: &serde_json::Value) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("crv-zcode-config-{unique}"));
        fs::create_dir_all(&dir).expect("config dir");
        fs::write(
            dir.join("config.json"),
            serde_json::to_string_pretty(content).expect("config json"),
        )
        .expect("write config");
        dir
    }

    fn coding_plan_config(enabled: bool, api_key: &str) -> serde_json::Value {
        serde_json::json!({
            "provider": {
                "builtin:bigmodel-coding-plan": {
                    "name": "BigModel - Coding Plan",
                    "kind": "anthropic",
                    "options": {
                        "apiKey": api_key,
                        "baseURL": "https://open.bigmodel.cn/api/anthropic"
                    },
                    "enabled": enabled
                },
                "builtin:bigmodel-start-plan": {
                    "kind": "anthropic",
                    "options": {"apiKey": "jwt-token", "baseURL": "https://zcode.z.ai/api/v1/zcode-plan/anthropic"},
                    "enabled": false,
                    "systemDisabledReason": "coding_plan_not_entitled"
                }
            }
        })
    }

    #[test]
    fn resolve_quota_request_reads_enabled_coding_plan_from_config() {
        let dir = write_temp_config(&coding_plan_config(true, "config-key"));
        let lookup = |name: &str| {
            (name == "CODEX_CREDITS_ZCODE_CONFIG_DIR").then(|| dir.to_string_lossy().into_owned())
        };
        let request = resolve_quota_request(&lookup).expect("resolve from config");
        assert_eq!(request.api_key, "config-key");
        assert_eq!(
            request.url,
            "https://open.bigmodel.cn/api/monitor/usage/quota/limit"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_quota_request_reads_config_from_home_fallback() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let home = std::env::temp_dir().join(format!("crv-zcode-home-{unique}"));
        let config_dir = home.join(".zcode").join("v2");
        fs::create_dir_all(&config_dir).expect("config dir");
        fs::write(
            config_dir.join("config.json"),
            serde_json::to_string_pretty(&coding_plan_config(true, "home-key"))
                .expect("config json"),
        )
        .expect("write config");
        let home_for_lookup = home.clone();
        let lookup = move |name: &str| {
            (name == "HOME").then(|| home_for_lookup.to_string_lossy().into_owned())
        };

        let request = resolve_quota_request(&lookup).expect("resolve from home");
        assert_eq!(request.api_key, "home-key");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn explicit_provider_quota_url_overrides_derived_path() {
        let mut config = coding_plan_config(true, "config-key");
        config["provider"]["builtin:bigmodel-coding-plan"]["options"]["quotaURL"] =
            serde_json::json!("https://quota.example.test/custom/path");
        let dir = write_temp_config(&config);
        let lookup = |name: &str| {
            (name == "CODEX_CREDITS_ZCODE_CONFIG_DIR").then(|| dir.to_string_lossy().into_owned())
        };

        let request = resolve_quota_request(&lookup).expect("resolve from config");
        assert_eq!(request.url, "https://quota.example.test/custom/path");
        assert_eq!(request.api_key, "config-key");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_dir_falls_back_to_versionless_zcode_dir() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let home = std::env::temp_dir().join(format!("crv-zcode-root-{unique}"));
        let config_dir = home.join(".zcode");
        fs::create_dir_all(&config_dir).expect("config dir");
        fs::write(
            config_dir.join("config.json"),
            serde_json::to_string_pretty(&coding_plan_config(true, "root-key"))
                .expect("config json"),
        )
        .expect("write config");
        let home_for_lookup = home.clone();
        let lookup = move |name: &str| {
            (name == "HOME").then(|| home_for_lookup.to_string_lossy().into_owned())
        };

        let request = resolve_quota_request(&lookup).expect("resolve from versionless dir");
        assert_eq!(request.api_key, "root-key");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn resolve_quota_request_reports_no_enabled_coding_plan() {
        let dir = write_temp_config(&coding_plan_config(false, "config-key"));
        let lookup = |name: &str| {
            (name == "CODEX_CREDITS_ZCODE_CONFIG_DIR").then(|| dir.to_string_lossy().into_owned())
        };
        let error = resolve_quota_request(&lookup).expect_err("expect failure");
        assert_eq!(error.code, "CRV-502");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_quota_request_reports_missing_key() {
        let dir = write_temp_config(&coding_plan_config(true, ""));
        let lookup = |name: &str| {
            (name == "CODEX_CREDITS_ZCODE_CONFIG_DIR").then(|| dir.to_string_lossy().into_owned())
        };
        let error = resolve_quota_request(&lookup).expect_err("expect failure");
        assert_eq!(error.code, "CRV-503");
        let _ = fs::remove_dir_all(&dir);
    }

    fn config_dir_lookup(dir: &PathBuf) -> impl Fn(&str) -> Option<String> {
        let path = dir.to_string_lossy().into_owned();
        move |name: &str| (name == "CODEX_CREDITS_ZCODE_CONFIG_DIR").then(|| path.clone())
    }

    /// coding-plan 与 start-plan（体验套餐）并存的配置；start 条目形态镜像
    /// 本机 config.json 的系统写入结果——enabled/systemDisabledReason 与真实
    /// 授权状态脱节（网关 active 而本地标记 not_entitled），解析时被有意忽略。
    fn multi_plan_config() -> serde_json::Value {
        serde_json::json!({
            "provider": {
                "builtin:bigmodel-coding-plan": {
                    "name": "BigModel - Coding Plan",
                    "kind": "anthropic",
                    "options": {
                        "apiKey": "coding-key",
                        "baseURL": "https://open.bigmodel.cn/api/anthropic"
                    },
                    "enabled": true
                },
                "builtin:bigmodel-start-plan": {
                    "name": "BigModel- Coding Plan",
                    "kind": "anthropic",
                    "source": "custom",
                    "options": {
                        "apiKey": "start-jwt",
                        "baseURL": "https://zcode.z.ai/api/v1/zcode-plan/anthropic"
                    },
                    "enabled": false,
                    "systemDisabledReason": "coding_plan_not_entitled"
                }
            }
        })
    }

    fn write_telemetry(dir: &PathBuf, device_mid: &str) {
        fs::write(
            dir.join("telemetry-state.json"),
            format!(r#"{{"deviceMid":"{device_mid}"}}"#),
        )
        .expect("write telemetry");
    }

    #[test]
    fn start_plan_request_resolved_from_config_credential_and_device_mid() {
        let dir = write_temp_config(&multi_plan_config());
        write_telemetry(&dir, "device-uuid-1");
        let request =
            resolve_start_plan_request(&config_dir_lookup(&dir)).expect("resolve start");
        assert_eq!(request.kind, PlanKind::Start);
        assert_eq!(request.api_key, "start-jwt");
        assert_eq!(request.device_mid.as_deref(), Some("device-uuid-1"));
        assert_eq!(
            request.url,
            format!(
                "https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version={}",
                env!("CARGO_PKG_VERSION")
            )
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn start_plan_request_skipped_without_device_mid() {
        let dir = write_temp_config(&multi_plan_config());
        assert!(resolve_start_plan_request(&config_dir_lookup(&dir)).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn start_plan_request_skipped_without_credential() {
        let mut config = multi_plan_config();
        config["provider"]["builtin:bigmodel-start-plan"]["options"]["apiKey"] =
            serde_json::json!("");
        let dir = write_temp_config(&config);
        write_telemetry(&dir, "device-uuid-1");
        assert!(resolve_start_plan_request(&config_dir_lookup(&dir)).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn start_plan_request_defaults_gateway_when_base_url_unresolvable() {
        let mut config = multi_plan_config();
        config["provider"]["builtin:bigmodel-start-plan"]["options"]["baseURL"] =
            serde_json::json!("not a url");
        let dir = write_temp_config(&config);
        write_telemetry(&dir, "device-uuid-1");
        let request =
            resolve_start_plan_request(&config_dir_lookup(&dir)).expect("resolve start");
        assert_eq!(
            request.url,
            format!(
                "{DEFAULT_ZCODE_PLAN_GATEWAY}{BALANCE_PATH}?app_version={}",
                env!("CARGO_PKG_VERSION")
            )
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn explicit_quota_url_wins_for_start_plan() {
        let mut config = multi_plan_config();
        config["provider"]["builtin:bigmodel-start-plan"]["options"]["quotaURL"] =
            serde_json::json!("https://quota.example.test/balance");
        let dir = write_temp_config(&config);
        write_telemetry(&dir, "device-uuid-1");
        let request =
            resolve_start_plan_request(&config_dir_lookup(&dir)).expect("resolve start");
        assert_eq!(request.url, "https://quota.example.test/balance");
        let _ = fs::remove_dir_all(&dir);
    }

    fn start_plan_payload() -> String {
        r#"{"code":0,"msg":"","data":{"server_time":1788400000,"plans":[{"plan_id":"p-start","user_plan_id":"up-1","status":"active","ends_at":1789000000}],"balances":[{"bucket_id":"b1","plan_id":"p-start","user_plan_id":"up-1","total_units":1000,"used_units":250,"remaining_units":750,"expires_at":1789600000}]}}"#
            .to_owned()
    }

    fn coding_payload() -> String {
        r#"{"code":200,"success":true,"data":{"limits":[{"type":"CREDIT_LIMIT","unit":3,"number":5,"usage":120,"currentValue":30,"remaining":90,"percentage":25,"nextResetTime":1787810092514}],"level":"lite"}}"#
            .to_owned()
    }

    /// 按探测顺序出队预设响应的 fetch 桩，同时记录实际探测的套餐类型
    type FetchBody = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<String, Diagnostic>> + Send>,
    >;

    fn fetch_from_queue(
        seen: std::rc::Rc<std::cell::RefCell<Vec<PlanKind>>>,
        results: std::rc::Rc<
            std::cell::RefCell<std::collections::VecDeque<Result<String, Diagnostic>>>,
        >,
    ) -> impl Fn(QuotaRequest) -> FetchBody {
        move |request: QuotaRequest| -> FetchBody {
            seen.borrow_mut().push(request.kind);
            let result = results
                .borrow_mut()
                .pop_front()
                .unwrap_or_else(|| Err(zcode_network_failure("fetch stub exhausted")));
            Box::pin(std::future::ready(result))
        }
    }

    #[tokio::test]
    async fn live_read_prefers_start_plan_payload() {
        let dir = write_temp_config(&multi_plan_config());
        write_telemetry(&dir, "device-uuid-1");
        let seen = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let results = std::rc::Rc::new(std::cell::RefCell::new(
            [Ok(start_plan_payload())].into_iter().collect(),
        ));
        let snapshot = read_live(config_dir_lookup(&dir), true, fetch_from_queue(seen.clone(), results))
            .await
            .expect("snapshot");
        assert_eq!(snapshot.plan_kind.as_deref(), Some("start_plan"));
        assert_eq!(*seen.borrow(), vec![PlanKind::Start]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn live_read_falls_back_to_coding_when_start_probe_fails() {
        let dir = write_temp_config(&multi_plan_config());
        write_telemetry(&dir, "device-uuid-1");
        let seen = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let results = std::rc::Rc::new(std::cell::RefCell::new(
            [
                Err(Diagnostic::new("CRV-507", "体验套餐不可用")),
                Ok(coding_payload()),
            ]
            .into_iter()
            .collect(),
        ));
        let snapshot = read_live(config_dir_lookup(&dir), true, fetch_from_queue(seen.clone(), results))
            .await
            .expect("snapshot");
        assert_eq!(snapshot.plan_kind.as_deref(), Some("coding_plan"));
        assert_eq!(*seen.borrow(), vec![PlanKind::Start, PlanKind::Coding]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn live_read_surfaces_coding_error_when_both_probes_fail() {
        let dir = write_temp_config(&multi_plan_config());
        write_telemetry(&dir, "device-uuid-1");
        let results = std::rc::Rc::new(std::cell::RefCell::new(
            [
                Err(Diagnostic::new("CRV-507", "体验套餐不可用")),
                Err(zcode_network_failure("monitor unreachable")),
            ]
            .into_iter()
            .collect(),
        ));
        let error = read_live(
            config_dir_lookup(&dir),
            true,
            fetch_from_queue(std::rc::Rc::new(std::cell::RefCell::new(Vec::new())), results),
        )
        .await
        .expect_err("expect failure");
        assert_eq!(error.code, "CRV-504");
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn live_read_skips_start_probe_under_env_override() {
        let dir = write_temp_config(&multi_plan_config());
        write_telemetry(&dir, "device-uuid-1");
        let dir_for_lookup = dir.clone();
        let lookup = move |name: &str| {
            if name == "ZCODE_BIGMODEL_USAGE_API_KEY" {
                return Some("env-key".to_owned());
            }
            if name == "CODEX_CREDITS_ZCODE_CONFIG_DIR" {
                return Some(dir_for_lookup.to_string_lossy().into_owned());
            }
            None
        };
        let seen = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let results = std::rc::Rc::new(std::cell::RefCell::new(
            [Ok(coding_payload())].into_iter().collect(),
        ));
        let snapshot = read_live(&lookup, true, fetch_from_queue(seen.clone(), results))
            .await
            .expect("snapshot");
        assert_eq!(snapshot.plan_kind.as_deref(), Some("coding_plan"));
        // 显式 env 覆盖是个人套餐调试语义，不应产生体验套餐网关探测
        assert_eq!(*seen.borrow(), vec![PlanKind::Coding]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn live_read_skips_start_probe_when_user_prefers_coding_plan() {
        let dir = write_temp_config(&multi_plan_config());
        write_telemetry(&dir, "device-uuid-1");
        let seen = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let results = std::rc::Rc::new(std::cell::RefCell::new(
            [Ok(coding_payload())].into_iter().collect(),
        ));
        // 用户显式选择仅个人套餐：即使体验套餐凭证齐备也不探测，队列里只有个人套餐响应
        let snapshot = read_live(config_dir_lookup(&dir), false, fetch_from_queue(seen.clone(), results))
            .await
            .expect("snapshot");
        assert_eq!(snapshot.plan_kind.as_deref(), Some("coding_plan"));
        assert_eq!(*seen.borrow(), vec![PlanKind::Coding]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn start_plan_balance_url_derives_gateway_from_anthropic_base() {
        let balance = |path: &str| {
            format!("https://zcode.z.ai{path}?app_version={}", env!("CARGO_PKG_VERSION"))
        };
        assert_eq!(
            start_plan_balance_url("https://zcode.z.ai/api/v1/zcode-plan/anthropic").as_deref(),
            Some(balance("/api/v1/zcode-plan/billing/balance").as_str())
        );
        assert_eq!(
            start_plan_balance_url("https://zcode.z.ai/api/v1/zcode-plan/anthropic/").as_deref(),
            Some(balance("/api/v1/zcode-plan/billing/balance").as_str())
        );
        assert_eq!(
            start_plan_balance_url("https://zcode.z.ai/api/v1/zcode-plan").as_deref(),
            Some(balance("/api/v1/zcode-plan/billing/balance").as_str())
        );
        // 监控端点路径在 zcode-plan 网关上不存在，裸 origin 无法推导
        assert_eq!(start_plan_balance_url("https://zcode.z.ai"), None);
        assert_eq!(start_plan_balance_url("not a url"), None);
        assert_eq!(start_plan_balance_url(""), None);
    }

    const START_BALANCE_OK: &str = r#"{"code":0,"msg":"ok","data":{"server_time":1788400000,"plans":[
        {"plan_id":"p-start","user_plan_id":"up-1","status":"active","ends_at":1789000000},
        {"plan_id":"p-old","user_plan_id":"up-2","status":"active","ends_at":1788300000}
    ],"balances":[
        {"bucket_id":"b1","plan_id":"p-start","user_plan_id":"up-1","entitlement_id":"e1","meter":"model_usage","capabilities":["model:GLM-5.3"],"show_name":"GLM-5.3","total_units":1000,"used_units":250,"remaining_units":750,"expires_at":1789600000},
        {"bucket_id":"b2","plan_id":"p-start","user_plan_id":"up-1","entitlement_id":"e2","total_units":"500","used_units":"100","remaining_units":"400","expires_at":1789700000},
        {"bucket_id":"b3","plan_id":"p-old","user_plan_id":"up-2","total_units":900,"used_units":900,"remaining_units":0,"expires_at":1789800000}
    ]}}"#;

    #[test]
    fn balance_payload_aggregates_active_buckets_and_drops_expired_plans() {
        let snapshot = parse_balance_payload(START_BALANCE_OK).expect("parse balance");
        let pool = snapshot.five_hour.expect("trial pool");
        assert_eq!(pool.quota_total, 1500);
        assert_eq!(pool.quota_used, 350);
        assert_eq!(pool.quota_remaining, 1150);
        assert!((pool.used_percent - 350.0 / 1500.0 * 100.0).abs() < 1e-9);
        assert!((pool.remaining_percent - (100.0 - 350.0 / 1500.0 * 100.0)).abs() < 1e-9);
        // 已到期套餐（p-old）的额度桶被丢弃，剩余桶中最早的 expires_at 胜出
        assert_eq!(pool.resets_at, Some(1_789_600_000));
        assert_eq!(pool.window_duration_mins, 0);
        assert!(snapshot.weekly.is_none());
        assert_eq!(snapshot.plan_level.as_deref(), Some("Start"));
        assert_eq!(snapshot.plan_kind.as_deref(), Some("start_plan"));
    }

    #[test]
    fn balance_payload_keeps_orphan_buckets() {
        let raw = r#"{"code":0,"data":{"server_time":1788400000,"plans":[
            {"plan_id":"p-start","user_plan_id":"up-1","status":"active","ends_at":1789000000}
        ],"balances":[
            {"bucket_id":"b1","plan_id":"p-orphan","total_units":100,"used_units":10,"remaining_units":90,"expires_at":1789600000}
        ]}}"#;
        let snapshot = parse_balance_payload(raw).expect("parse orphan balance");
        let pool = snapshot.five_hour.expect("orphan pool");
        assert_eq!(pool.quota_remaining, 90);
    }

    #[test]
    fn balance_payload_drops_buckets_of_expired_status_plans() {
        let raw = r#"{"code":0,"data":{"server_time":1788400000,"plans":[
            {"plan_id":"p-live","user_plan_id":"up-1","status":"active","ends_at":1789000000},
            {"plan_id":"p-gone","user_plan_id":"up-2","status":"expired"}
        ],"balances":[
            {"bucket_id":"b1","plan_id":"p-live","user_plan_id":"up-1","total_units":100,"used_units":10,"remaining_units":90,"expires_at":1789600000},
            {"bucket_id":"b2","plan_id":"p-gone","user_plan_id":"up-2","total_units":500,"used_units":500,"remaining_units":0,"expires_at":1789600000}
        ]}}"#;
        let snapshot = parse_balance_payload(raw).expect("parse expired balance");
        let pool = snapshot.five_hour.expect("pool");
        assert_eq!(pool.quota_total, 100);
        assert_eq!(pool.quota_used, 10);
    }

    #[test]
    fn balance_payload_skips_buckets_without_any_units() {
        let raw = r#"{"code":0,"data":{"server_time":1788400000,"plans":[],"balances":[
            {"bucket_id":"b-empty"},
            {"bucket_id":"b1","plan_id":"p-start","total_units":100,"used_units":10,"remaining_units":90,"expires_at":1789600000}
        ]}}"#;
        let snapshot = parse_balance_payload(raw).expect("parse balance");
        assert_eq!(snapshot.five_hour.expect("pool").quota_total, 100);
    }

    #[test]
    fn balance_payload_without_usable_buckets_maps_to_crv_508() {
        let raw = r#"{"code":0,"data":{"server_time":1788400000,"plans":[],"balances":[]}}"#;
        let error = parse_balance_payload(raw).expect_err("expect failure");
        assert_eq!(error.code, "CRV-508");
    }

    #[test]
    fn balance_payload_zero_total_yields_zero_used_percent() {
        let raw = r#"{"code":0,"data":{"server_time":1788400000,"plans":[],"balances":[
            {"bucket_id":"b1","total_units":0,"used_units":0,"remaining_units":0}
        ]}}"#;
        let snapshot = parse_balance_payload(raw).expect("parse balance");
        let pool = snapshot.five_hour.expect("pool");
        assert!((pool.used_percent - 0.0).abs() < f64::EPSILON);
        assert!((pool.remaining_percent - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn balance_payload_business_error_maps_to_crv_507() {
        let error =
            parse_balance_payload(r#"{"code":3001,"msg":"parameter error"}"#).expect_err("failure");
        assert_eq!(error.code, "CRV-507");
        assert!(error.detail.expect("detail").contains("parameter error"));
    }

    #[test]
    fn balance_payload_malformed_json_and_missing_data_map_to_crv_506() {
        assert_eq!(
            parse_balance_payload("not json").expect_err("failure").code,
            "CRV-506"
        );
        assert_eq!(
            parse_balance_payload(r#"{"code":0}"#).expect_err("failure").code,
            "CRV-506"
        );
    }

    #[tokio::test]
    async fn fixture_file_completes_the_read_snapshot_journey() {
        let service = ZCodeQuotaService::from_fixture_path(repo_fixture_path());
        let snapshot = service.read_snapshot(true).await.expect("fixture snapshot");
        assert!(snapshot.five_hour.is_some());
        assert!(snapshot.weekly.is_some());
        assert_eq!(snapshot.plan_level.as_deref(), Some("pro"));
        assert_eq!(snapshot.plan_kind.as_deref(), Some("coding_plan"));
    }

    /// 真实环境联调：读本机 ~/.zcode 真实配置并向 zcode-plan 网关发起真实探测。
    /// 仅在装有 ZCode 并登录的机器上手工执行：cargo test --lib -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn real_gateway_start_plan_probe_is_prioritized() {
        let snapshot = ZCodeQuotaService::from_environment()
            .read_snapshot(true)
            .await
            .expect("live snapshot");
        println!("plan_kind: {:?}", snapshot.plan_kind);
        println!("plan_level: {:?}", snapshot.plan_level);
        if snapshot.plan_kind.as_deref() == Some("start_plan") {
            let pool = snapshot.five_hour.expect("trial pool");
            println!("trial used_percent: {:.1}", pool.used_percent);
            println!("trial resets_at: {:?}", pool.resets_at);
        }
    }
}

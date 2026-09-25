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

    /// 候选排序：体验套餐优先，其余保持 id 字典序（BTreeMap 迭代序）。
    fn priority(self) -> u8 {
        match self {
            PlanKind::Start => 0,
            PlanKind::Coding => 1,
        }
    }
}

fn plan_kind_from_id(id: &str) -> Option<PlanKind> {
    if id.ends_with("-start-plan") {
        Some(PlanKind::Start)
    } else if id.ends_with("-coding-plan") {
        Some(PlanKind::Coding)
    } else {
        None
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

/// `~/.zcode` 下 coding-plan-cache.json 的可用性缓存，由 ZCode CLI 维护，
/// 是体验套餐授权状态的第二信号（config.json 的 enabled 写入时机不可靠）。
#[derive(Debug, Deserialize)]
struct PlanCacheFile {
    #[serde(default, rename = "entryStatus")]
    entry_status: Option<PlanCacheEntryStatus>,
}

#[derive(Debug, Deserialize)]
struct PlanCacheEntryStatus {
    #[serde(default, rename = "items")]
    items: BTreeMap<String, PlanCacheItem>,
}

#[derive(Debug, Deserialize)]
struct PlanCacheItem {
    #[serde(default)]
    status: Option<String>,
}

impl PlanCacheFile {
    fn available_ids(&self) -> Vec<&str> {
        self.entry_status
            .as_ref()
            .map(|status| {
                status
                    .items
                    .iter()
                    .filter(|(_, item)| {
                        item.status.as_deref().map(str::trim) == Some("available")
                    })
                    .map(|(id, _)| id.as_str())
                    .collect()
            })
            .unwrap_or_default()
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

    pub async fn read_snapshot(&self) -> Result<ZCodeQuotaSnapshot, Diagnostic> {
        if let Some(path) = &self.fixture_path {
            let raw = fs::read_to_string(path).map_err(|error| {
                Diagnostic::new("CRV-506", "ZCode 配额 fixture 无法读取")
                    .with_detail(error.to_string())
            })?;
            // fixture 路径保持个人套餐（监控端点）解析语义，体验套餐由单元测试覆盖
            return parse_quota_payload(&raw);
        }

        let request = resolve_quota_request(&env_lookup)?;
        let body = fetch_quota_body(&request).await?;
        match request.kind {
            PlanKind::Coding => parse_quota_payload(&body),
            PlanKind::Start => parse_balance_payload(&body),
        }
    }
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
    let env_key = lookup("ZCODE_BIGMODEL_USAGE_API_KEY").or_else(|| lookup("BIGMODEL_USAGE_API_KEY"));
    let env_url = lookup("ZCODE_BIGMODEL_USAGE_QUOTA_URL").or_else(|| lookup("BIGMODEL_USAGE_QUOTA_URL"));
    let api_key = env_key.clone().or_else(|| {
        config
            .as_ref()
            .ok()
            .map(|request| request.api_key.clone())
            .filter(|key| !key.is_empty())
    });
    let url = env_url.clone().or_else(|| {
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
        // env 覆盖固定为个人套餐（监控端点）语义；无覆盖时透传 config 的套餐选择
        let kind = if env_key.is_some() || env_url.is_some() {
            PlanKind::Coding
        } else {
            config
                .as_ref()
                .map(|request| request.kind)
                .unwrap_or(PlanKind::Coding)
        };
        return Ok(QuotaRequest {
            kind,
            url: url.clone(),
            api_key: api_key.clone(),
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

fn read_config_request(
    lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<QuotaRequest, Diagnostic> {
    let mut tried = Vec::new();
    let mut raw = None;
    for dir in zcode_config_candidates(lookup) {
        let path = dir.join("config.json");
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
    let config: ZCodeConfigFile = serde_json::from_str(&raw).map_err(|error| {
        Diagnostic::new("CRV-501", "ZCode 配置无法解析").with_detail(error.to_string())
    })?;

    let cache = read_plan_cache_availability(lookup);
    // BTreeMap 迭代即 id 字典序；稳定排序后体验套餐整体优先
    let mut candidates = config
        .provider
        .iter()
        .filter_map(|(id, entry)| {
            plan_kind_from_id(id).map(|kind| (kind, id.as_str(), entry))
        })
        .filter(|(kind, id, entry)| {
            entry.system_disabled_reason.is_none()
                && match kind {
                    PlanKind::Coding => entry.enabled,
                    // 体验套餐由系统发放，config 的 enabled 写入时机不可靠，
                    // 授权状态以 coding-plan-cache.json 作为第二信号
                    PlanKind::Start => entry.enabled || cache.iter().any(|available| available.as_str() == *id),
                }
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|(kind, _, _)| kind.priority());

    if candidates.is_empty() {
        return Err(
            Diagnostic::new("CRV-502", "ZCode 编程包未启用").with_detail(
                "config.json 中没有可用的 coding-plan/start-plan provider，请在 ZCode 内订阅并启用编程包",
            ),
        );
    }

    let mut missing_keys = 0usize;
    let mut url_failures = Vec::new();
    for (kind, id, entry) in candidates {
        let api_key = entry.options.api_key.trim();
        if api_key.is_empty() {
            missing_keys += 1;
            continue;
        }
        match plan_request_url(kind, id, &entry.options) {
            Ok(url) => {
                return Ok(QuotaRequest {
                    kind,
                    url,
                    api_key: api_key.to_owned(),
                });
            }
            Err(diagnostic) => url_failures.push(diagnostic),
        }
    }

    if !url_failures.is_empty() {
        let detail = url_failures
            .iter()
            .map(|diagnostic| diagnostic.detail.clone().unwrap_or_default())
            .collect::<Vec<_>>()
            .join("; ");
        return Err(Diagnostic::new("CRV-503", "ZCode 编程包配置不完整").with_detail(detail));
    }
    Err(Diagnostic::new("CRV-503", "ZCode 编程包未配置 API Key")
        .with_detail(format!("{missing_keys} 个启用的套餐 provider 均未携带 apiKey")))
}

fn plan_request_url(
    kind: PlanKind,
    id: &str,
    options: &ZCodeProviderOptions,
) -> Result<String, Diagnostic> {
    let explicit_quota_url = options.quota_url.trim();
    if !explicit_quota_url.is_empty() {
        return Ok(explicit_quota_url.to_owned());
    }
    let invalid = || {
        Diagnostic::new("CRV-503", "ZCode 编程包配置不完整").with_detail(format!(
            "provider {id} 的 baseURL 无法解析: {}",
            options.base_url
        ))
    };
    match kind {
        PlanKind::Coding => quota_url_from_base_url(&options.base_url).ok_or_else(invalid),
        PlanKind::Start => start_plan_balance_url(&options.base_url).ok_or_else(invalid),
    }
}

/// coding-plan-cache.json 与 config.json 同目录（~/.zcode/v2 优先，~/.zcode 兜底）；
/// 文件缺失或无法解析时返回空集，不阻塞探测。
fn read_plan_cache_availability(lookup: &dyn Fn(&str) -> Option<String>) -> Vec<String> {
    for dir in zcode_config_candidates(lookup) {
        let path = dir.join("coding-plan-cache.json");
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(cache) = serde_json::from_str::<PlanCacheFile>(&raw) {
                return cache.available_ids().into_iter().map(str::to_owned).collect();
            }
        }
    }
    Vec::new()
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

async fn fetch_quota_body(request: &QuotaRequest) -> Result<String, Diagnostic> {
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
    // Authorization 头经 stdin 配置传入，key 不进入进程命令行
    let stdin_config = format!("header = \"Authorization: {}\"\n", request.api_key);
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

    /// coding-plan 与 start-plan（体验套餐）同时存在的配置；start 条目形态
    /// 镜像本机 config.json 的系统写入结果。
    fn multi_plan_config(start_enabled: bool, start_reason: Option<&str>) -> serde_json::Value {
        let mut start = serde_json::json!({
            "name": "BigModel- Coding Plan",
            "kind": "anthropic",
            "source": "custom",
            "options": {
                "apiKey": "start-jwt",
                "baseURL": "https://zcode.z.ai/api/v1/zcode-plan/anthropic"
            },
            "enabled": start_enabled
        });
        if let Some(reason) = start_reason {
            start["systemDisabledReason"] = serde_json::json!(reason);
        }
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
                "builtin:bigmodel-start-plan": start
            }
        })
    }

    fn write_cache(dir: &PathBuf, available_ids: &[&str]) {
        let items = available_ids
            .iter()
            .map(|id| (id.to_string(), serde_json::json!({"status": "available"})))
            .collect::<serde_json::Map<String, serde_json::Value>>();
        let cache = serde_json::json!({
            "version": 1,
            "entryStatus": {"updatedAt": 1_789_565_582_189u64, "items": items}
        });
        fs::write(
            dir.join("coding-plan-cache.json"),
            serde_json::to_string(&cache).expect("cache json"),
        )
        .expect("write cache");
    }

    #[test]
    fn usable_start_plan_is_selected_over_coding_plan() {
        let dir = write_temp_config(&multi_plan_config(true, None));
        let request = resolve_quota_request(&config_dir_lookup(&dir)).expect("resolve");
        assert_eq!(request.kind, PlanKind::Start);
        assert_eq!(request.api_key, "start-jwt");
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
    fn start_plan_cache_available_enables_selection_without_enabled_flag() {
        let dir = write_temp_config(&multi_plan_config(false, None));
        write_cache(&dir, &["builtin:bigmodel-start-plan"]);
        let request = resolve_quota_request(&config_dir_lookup(&dir)).expect("resolve");
        assert_eq!(request.kind, PlanKind::Start);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn start_plan_cache_unavailable_does_not_enable_selection() {
        let dir = write_temp_config(&multi_plan_config(false, None));
        write_cache(&dir, &["builtin:bigmodel-coding-plan"]);
        let request = resolve_quota_request(&config_dir_lookup(&dir)).expect("resolve");
        assert_eq!(request.kind, PlanKind::Coding);
        assert_eq!(
            request.url,
            "https://open.bigmodel.cn/api/monitor/usage/quota/limit"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn start_plan_without_entitlement_falls_back_to_coding_plan() {
        let dir = write_temp_config(&multi_plan_config(false, Some("coding_plan_not_entitled")));
        let request = resolve_quota_request(&config_dir_lookup(&dir)).expect("resolve");
        assert_eq!(request.kind, PlanKind::Coding);
        assert_eq!(request.api_key, "coding-key");
        assert_eq!(
            request.url,
            "https://open.bigmodel.cn/api/monitor/usage/quota/limit"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unresolvable_start_plan_base_url_falls_back_to_coding_candidate() {
        let mut config = multi_plan_config(true, None);
        config["provider"]["builtin:bigmodel-start-plan"]["options"]["baseURL"] =
            serde_json::json!("not a url");
        let dir = write_temp_config(&config);
        let request = resolve_quota_request(&config_dir_lookup(&dir)).expect("resolve");
        assert_eq!(request.kind, PlanKind::Coding);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn explicit_quota_url_wins_for_start_plan() {
        let mut config = multi_plan_config(true, None);
        config["provider"]["builtin:bigmodel-start-plan"]["options"]["quotaURL"] =
            serde_json::json!("https://quota.example.test/balance");
        let dir = write_temp_config(&config);
        let request = resolve_quota_request(&config_dir_lookup(&dir)).expect("resolve");
        assert_eq!(request.kind, PlanKind::Start);
        assert_eq!(request.url, "https://quota.example.test/balance");
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
        let snapshot = service.read_snapshot().await.expect("fixture snapshot");
        assert!(snapshot.five_hour.is_some());
        assert!(snapshot.weekly.is_some());
        assert_eq!(snapshot.plan_level.as_deref(), Some("pro"));
        assert_eq!(snapshot.plan_kind.as_deref(), Some("coding_plan"));
    }
}

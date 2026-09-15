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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZCodeQuotaSnapshot {
    pub source_state: SourceState,
    pub five_hour: Option<ZCodeQuotaWindow>,
    pub weekly: Option<ZCodeQuotaWindow>,
    pub plan_level: Option<String>,
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
            return parse_quota_payload(&raw);
        }

        let request = resolve_quota_request(&env_lookup)?;
        let body = fetch_quota_body(&request).await?;
        parse_quota_payload(&body)
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
        return Ok(QuotaRequest { url, api_key });
    }

    Err(Diagnostic::new("CRV-503", "ZCode 编程包未配置 API Key")
        .with_detail("启用的 coding-plan provider 均未携带 apiKey"))
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

    #[tokio::test]
    async fn fixture_file_completes_the_read_snapshot_journey() {
        let service = ZCodeQuotaService::from_fixture_path(repo_fixture_path());
        let snapshot = service.read_snapshot().await.expect("fixture snapshot");
        assert!(snapshot.five_hour.is_some());
        assert!(snapshot.weekly.is_some());
        assert_eq!(snapshot.plan_level.as_deref(), Some("pro"));
    }
}

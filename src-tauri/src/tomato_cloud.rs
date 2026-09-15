use crate::capacity::Diagnostic;
use serde::Serialize;
use std::{
    collections::HashSet,
    env,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{process::Command, time::timeout};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const PROCESS_TIMEOUT: Duration = Duration::from_secs(2);
const REGISTRY_TIMEOUT: Duration = Duration::from_secs(2);
const HEALTH_PROBE_TIMEOUT: Duration = Duration::from_secs(9);
const COUNTRY_PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const HEALTH_CONNECT_TIMEOUT: &str = "5";
const HEALTH_MAX_TIME: &str = "8";
const COUNTRY_CONNECT_TIMEOUT: &str = "1";
const COUNTRY_MAX_TIME: &str = "2";
const COUNTRY_ENDPOINT: &str = "https://api.country.is/";
const HEALTH_ENDPOINT: &str = "https://www.gstatic.com/generate_204";

#[cfg(target_os = "windows")]
const REQUIRED_PROCESSES: [&str; 2] = ["tomato-cloud.exe", "tomato-dataplane-agent.exe"];
// macOS 客户端由 tomato-cloud + 特权助手 io.tomato.cloud.helper.bundle 组成
#[cfg(not(target_os = "windows"))]
const REQUIRED_PROCESSES: [&str; 2] = ["tomato-cloud", "tomato-helper"];

/// 上游改名/迁移时的逃生门：探测端点与必需进程可用
/// `CODEX_CREDITS_HEALTH_ENDPOINT` / `CODEX_CREDITS_COUNTRY_ENDPOINT` /
/// `CODEX_CREDITS_TOMATO_PROCESSES` 环境变量覆盖。
fn resolve_endpoint(lookup: &dyn Fn(&str) -> Option<String>, var: &str, default: &str) -> String {
    lookup(var)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default.to_owned())
}

fn resolve_required_processes(lookup: &dyn Fn(&str) -> Option<String>) -> Vec<String> {
    if let Some(raw) = lookup("CODEX_CREDITS_TOMATO_PROCESSES") {
        let names = raw
            .split([',', ';'])
            .map(|name| name.trim().to_owned())
            .filter(|name| !name.is_empty())
            .collect::<Vec<_>>();
        if !names.is_empty() {
            return names;
        }
    }
    REQUIRED_PROCESSES
        .iter()
        .map(|name| (*name).to_owned())
        .collect()
}

#[derive(Clone, Copy)]
struct ProbeSettings {
    connect_timeout: &'static str,
    max_time: &'static str,
    command_timeout: Duration,
}

const HEALTH_PROBE: ProbeSettings = ProbeSettings {
    connect_timeout: HEALTH_CONNECT_TIMEOUT,
    max_time: HEALTH_MAX_TIME,
    command_timeout: HEALTH_PROBE_TIMEOUT,
};

const COUNTRY_PROBE: ProbeSettings = ProbeSettings {
    connect_timeout: COUNTRY_CONNECT_TIMEOUT,
    max_time: COUNTRY_MAX_TIME,
    command_timeout: COUNTRY_PROBE_TIMEOUT,
};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TomatoConnectionState {
    Healthy,
    Blocked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TomatoConnectionSnapshot {
    pub state: TomatoConnectionState,
    pub country_code: Option<String>,
    pub latency_ms: Option<u64>,
    pub observed_at_ms: u64,
    pub diagnostic: Option<Diagnostic>,
}

#[derive(Debug)]
pub struct TomatoCloudService {
    last_country_code: Mutex<Option<String>>,
}

impl TomatoCloudService {
    pub fn new() -> Self {
        Self {
            last_country_code: Mutex::new(None),
        }
    }

    pub async fn read_connection(&self) -> TomatoConnectionSnapshot {
        let lookup = |name: &str| {
            env::var(name)
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        };
        let required_processes = resolve_required_processes(&lookup);
        let health_endpoint =
            resolve_endpoint(&lookup, "CODEX_CREDITS_HEALTH_ENDPOINT", HEALTH_ENDPOINT);
        let country_endpoint =
            resolve_endpoint(&lookup, "CODEX_CREDITS_COUNTRY_ENDPOINT", COUNTRY_ENDPOINT);
        let country_code = self
            .last_country_code
            .lock()
            .ok()
            .and_then(|value| value.clone());

        let running_processes = match read_running_processes().await {
            Ok(processes) => processes,
            Err(diagnostic) => return TomatoConnectionSnapshot::blocked(country_code, diagnostic),
        };
        let missing = required_processes
            .iter()
            .filter(|process| !running_processes.contains(process.as_str()))
            .map(String::as_str)
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return TomatoConnectionSnapshot::blocked(
                country_code,
                Diagnostic::new("CRV-401", "TomatoCloud runtime is not running")
                    .with_detail(format!("Missing required runtime: {}", missing.join(", "))),
            );
        }

        let proxy = match read_system_proxy().await {
            Ok(proxy) => proxy,
            Err(diagnostic) => return TomatoConnectionSnapshot::blocked(country_code, diagnostic),
        };
        if !is_loopback_proxy(&proxy) {
            return TomatoConnectionSnapshot::blocked(
                country_code,
                Diagnostic::new("CRV-403", "TomatoCloud local proxy is unavailable")
                    .with_detail("The enabled system HTTPS proxy is not a loopback endpoint"),
            );
        }

        let health_probe = match route_probe(&proxy, &health_endpoint, HEALTH_PROBE).await {
            Ok(probe) if (200..300).contains(&probe.http_status) => probe,
            Ok(probe) => {
                return TomatoConnectionSnapshot::blocked(
                    country_code,
                    Diagnostic::new("CRV-404", "TomatoCloud route is unavailable")
                        .with_detail(format!("Health probe returned HTTP {}", probe.http_status)),
                );
            }
            Err(diagnostic) => return TomatoConnectionSnapshot::blocked(country_code, diagnostic),
        };

        let country_code = match route_probe(&proxy, &country_endpoint, COUNTRY_PROBE).await {
            Ok(probe) if probe.http_status == 200 => {
                let country_code = country_code_from_body(&probe.body).or(country_code);
                if let Some(country_code) = country_code.as_ref() {
                    if let Ok(mut remembered) = self.last_country_code.lock() {
                        *remembered = Some(country_code.clone());
                    }
                }
                country_code
            }
            _ => country_code,
        };

        TomatoConnectionSnapshot::healthy(country_code, health_probe.latency_ms)
    }
}

impl TomatoConnectionSnapshot {
    fn healthy(country_code: Option<String>, latency_ms: u64) -> Self {
        Self {
            state: TomatoConnectionState::Healthy,
            country_code,
            latency_ms: Some(latency_ms),
            observed_at_ms: now_ms(),
            diagnostic: None,
        }
    }

    fn blocked(country_code: Option<String>, diagnostic: Diagnostic) -> Self {
        Self {
            state: TomatoConnectionState::Blocked,
            country_code,
            latency_ms: None,
            observed_at_ms: now_ms(),
            diagnostic: Some(diagnostic),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct RouteProbeResult {
    http_status: u16,
    latency_ms: u64,
    body: String,
}

#[cfg(target_os = "windows")]
async fn read_running_processes() -> Result<HashSet<String>, Diagnostic> {
    let output = command_output(
        Command::new("tasklist.exe")
            .args(["/FO", "CSV", "/NH"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null()),
        PROCESS_TIMEOUT,
        "CRV-400",
        "Unable to inspect the TomatoCloud runtime",
    )
    .await?;
    if !output.status.success() {
        return Err(Diagnostic::new(
            "CRV-400",
            "Unable to inspect the TomatoCloud runtime",
        ));
    }
    Ok(parse_tasklist(&String::from_utf8_lossy(&output.stdout)))
}

#[cfg(not(target_os = "windows"))]
async fn read_running_processes() -> Result<HashSet<String>, Diagnostic> {
    let output = command_output(
        Command::new("ps")
            .args(["-axc", "-o", "comm"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null()),
        PROCESS_TIMEOUT,
        "CRV-400",
        "Unable to inspect the TomatoCloud runtime",
    )
    .await?;
    if !output.status.success() {
        return Err(Diagnostic::new(
            "CRV-400",
            "Unable to inspect the TomatoCloud runtime",
        ));
    }
    Ok(parse_process_list(&String::from_utf8_lossy(&output.stdout)))
}

#[cfg(target_os = "windows")]
async fn read_system_proxy() -> Result<String, Diagnostic> {
    let output = command_output(
        Command::new("reg.exe")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                "/v",
                "ProxyEnable",
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null()),
        REGISTRY_TIMEOUT,
        "CRV-402",
        "TomatoCloud local proxy is unavailable",
    )
    .await?;
    if !output.status.success()
        || !registry_flag_is_enabled(&String::from_utf8_lossy(&output.stdout))
    {
        return Err(
            Diagnostic::new("CRV-402", "TomatoCloud local proxy is unavailable")
                .with_detail("Windows system proxy is not enabled"),
        );
    }

    let output = command_output(
        Command::new("reg.exe")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                "/v",
                "ProxyServer",
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null()),
        REGISTRY_TIMEOUT,
        "CRV-402",
        "TomatoCloud local proxy is unavailable",
    )
    .await?;
    if !output.status.success() {
        return Err(
            Diagnostic::new("CRV-402", "TomatoCloud local proxy is unavailable")
                .with_detail("Windows system proxy does not provide a server"),
        );
    }

    extract_proxy_server(&String::from_utf8_lossy(&output.stdout)).ok_or_else(|| {
        Diagnostic::new("CRV-402", "TomatoCloud local proxy is unavailable")
            .with_detail("Windows system proxy server could not be parsed")
    })
}

#[cfg(not(target_os = "windows"))]
async fn read_system_proxy() -> Result<String, Diagnostic> {
    let output = command_output(
        Command::new("scutil").arg("--proxy"),
        REGISTRY_TIMEOUT,
        "CRV-402",
        "TomatoCloud local proxy is unavailable",
    )
    .await?;
    if !output.status.success() {
        return Err(
            Diagnostic::new("CRV-402", "TomatoCloud local proxy is unavailable")
                .with_detail("The system proxy configuration could not be read"),
        );
    }

    extract_scutil_proxy(&String::from_utf8_lossy(&output.stdout)).ok_or_else(|| {
        Diagnostic::new("CRV-402", "TomatoCloud local proxy is unavailable")
            .with_detail("The enabled system HTTPS proxy is not a loopback endpoint")
    })
}

#[cfg(not(target_os = "windows"))]
fn extract_scutil_proxy(raw: &str) -> Option<String> {
    let field = |name: &str| -> Option<String> {
        raw.lines().find_map(|line| {
            let (key, value) = line.split_once(':')?;
            (key.trim().eq_ignore_ascii_case(name)).then(|| value.trim().to_owned())
        })
    };
    let enabled = field("HTTPSEnable")?.eq_ignore_ascii_case("1");
    if !enabled {
        return None;
    }
    let host = field("HTTPSProxy")?;
    if host.is_empty() {
        return None;
    }
    let port = field("HTTPSPort").unwrap_or_else(|| "80".to_owned());
    Some(format!("{host}:{port}"))
}

async fn route_probe(
    proxy: &str,
    endpoint: &str,
    settings: ProbeSettings,
) -> Result<RouteProbeResult, Diagnostic> {
    let proxy_url = format!("http://{proxy}");
    let output = command_output(
        Command::new(crate::platform::curl_executable())
            .args([
                "--silent",
                "--show-error",
                "--output",
                "-",
                "--write-out",
                "\n%{http_code} %{time_total}",
                "--connect-timeout",
                settings.connect_timeout,
                "--max-time",
                settings.max_time,
                "--retry",
                "0",
                "--proxy",
                &proxy_url,
                endpoint,
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null()),
        settings.command_timeout,
        "CRV-404",
        "TomatoCloud route is unavailable",
    )
    .await?;
    parse_curl_output(&String::from_utf8_lossy(&output.stdout)).ok_or_else(|| {
        Diagnostic::new("CRV-404", "TomatoCloud route is unavailable")
            .with_detail("Route probe did not return a valid HTTP result")
    })
}

async fn command_output(
    command: &mut Command,
    duration: Duration,
    code: &'static str,
    message: &'static str,
) -> Result<std::process::Output, Diagnostic> {
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    timeout(duration, command.output())
        .await
        .map_err(|_| Diagnostic::new(code, message).with_detail("The check timed out"))?
        .map_err(|error| Diagnostic::new(code, message).with_detail(error.to_string()))
}

#[cfg(target_os = "windows")]
fn parse_tasklist(raw: &str) -> HashSet<String> {
    raw.lines()
        .filter_map(|line| line.trim().strip_prefix('"'))
        .filter_map(|line| line.split('"').next())
        .map(|name| name.to_ascii_lowercase())
        .collect()
}

#[cfg(not(target_os = "windows"))]
fn parse_process_list(raw: &str) -> HashSet<String> {
    raw.lines()
        .map(|line| line.trim().to_ascii_lowercase())
        .filter(|name| !name.is_empty())
        .collect()
}

#[cfg(target_os = "windows")]
fn registry_flag_is_enabled(raw: &str) -> bool {
    raw.lines().any(|line| {
        let tokens = line.split_whitespace().collect::<Vec<_>>();
        tokens.len() >= 3
            && tokens[0].eq_ignore_ascii_case("ProxyEnable")
            && tokens[1].eq_ignore_ascii_case("REG_DWORD")
            && tokens[2].eq_ignore_ascii_case("0x1")
    })
}

#[cfg(target_os = "windows")]
fn extract_proxy_server(raw: &str) -> Option<String> {
    let value = raw
        .lines()
        .find_map(|line| line.split_once("REG_SZ").map(|(_, value)| value.trim()))?;
    let protocol_specific = value
        .split(';')
        .find_map(|segment| segment.trim().strip_prefix("https="))
        .or_else(|| {
            value
                .split(';')
                .find_map(|segment| segment.trim().strip_prefix("http="))
        });
    protocol_specific
        .or(Some(value))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn is_loopback_proxy(proxy: &str) -> bool {
    let endpoint = proxy
        .trim()
        .strip_prefix("http://")
        .or_else(|| proxy.trim().strip_prefix("https://"))
        .unwrap_or(proxy.trim());
    let Some((host, port)) = endpoint.rsplit_once(':') else {
        return false;
    };
    let host = host.trim_matches(['[', ']']);
    matches!(host, "127.0.0.1" | "localhost" | "::1")
        && port.parse::<u16>().is_ok_and(|port| port > 0)
}

fn parse_curl_output(raw: &str) -> Option<RouteProbeResult> {
    let (body, metadata) = raw.rsplit_once('\n')?;
    let mut fields = metadata.split_whitespace();
    let http_status = fields.next()?.parse::<u16>().ok()?;
    let latency_seconds = fields.next()?.parse::<f64>().ok()?;
    if !latency_seconds.is_finite() || latency_seconds < 0.0 {
        return None;
    }
    Some(RouteProbeResult {
        http_status,
        latency_ms: (latency_seconds * 1_000.0).round() as u64,
        body: body.trim().to_owned(),
    })
}

fn country_code_from_body(body: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(body).ok()?;
    let country = value.get("country")?.as_str()?.trim().to_ascii_uppercase();
    let normalized = if country == "GB" {
        "UK".to_owned()
    } else {
        country
    };
    (normalized.len() == 2
        && normalized
            .chars()
            .all(|character| character.is_ascii_alphabetic()))
    .then_some(normalized)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn parses_running_processes_without_relying_on_localized_tasklist_headers() {
        let processes = parse_tasklist(
            "\"tomato-cloud.exe\",\"108\",\"Console\",\"1\",\"10,000 K\"\n\"tomato-dataplane-agent.exe\",\"109\",\"Console\",\"1\",\"12,000 K\"",
        );
        assert!(processes.contains("tomato-cloud.exe"));
        assert!(processes.contains("tomato-dataplane-agent.exe"));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn parses_process_names_from_ps_comm_output() {
        // 夹具取自真实 TomatoCloud macOS 客户端的 ps -axc -o comm 输出
        let processes = parse_process_list(
            "launchd\nWindowServer\ntomato-cloud\ntomato-helper\n\nloginwindow",
        );
        assert!(processes.contains("tomato-cloud"));
        assert!(processes.contains("tomato-helper"));
        assert!(processes.contains("loginwindow"));
        assert!(!processes.contains(""));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parses_a_protocol_specific_loopback_proxy() {
        let raw = "    ProxyServer    REG_SZ    http=127.0.0.1:7888;https=127.0.0.1:7888";
        assert_eq!(extract_proxy_server(raw).as_deref(), Some("127.0.0.1:7888"));
        assert!(is_loopback_proxy("127.0.0.1:7888"));
        assert!(!is_loopback_proxy("example.org:443"));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn parses_a_loopback_proxy_from_scutil_output() {
        let raw = "<dictionary> {\n  HTTPSEnable : 1\n  HTTPSPort : 7888\n  HTTPSProxy : 127.0.0.1\n  SOCKSEnable : 0\n}";
        assert_eq!(
            extract_scutil_proxy(raw).as_deref(),
            Some("127.0.0.1:7888")
        );
        assert!(is_loopback_proxy("127.0.0.1:7888"));
        assert!(!is_loopback_proxy("example.org:443"));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn ignores_disabled_or_incomplete_scutil_proxies() {
        let disabled = "<dictionary> {\n  HTTPSEnable : 0\n  HTTPSProxy : 127.0.0.1\n}";
        assert_eq!(extract_scutil_proxy(disabled), None);
        let no_proxy = "<dictionary> {\n  HTTPSEnable : 1\n}";
        assert_eq!(extract_scutil_proxy(no_proxy), None);
    }

    #[test]
    fn parses_curl_metadata_and_normalizes_exit_country() {
        let result = parse_curl_output("{\"ip\":\"203.0.113.10\",\"country\":\"GB\"}\n200 0.0427")
            .expect("probe result");
        assert_eq!(result.http_status, 200);
        assert_eq!(result.latency_ms, 43);
        assert_eq!(country_code_from_body(&result.body).as_deref(), Some("UK"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn rejects_disabled_proxy_and_malformed_probe_metadata() {
        assert!(!registry_flag_is_enabled("ProxyEnable    REG_DWORD    0x0"));
        assert!(parse_curl_output("not a probe result").is_none());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn rejects_malformed_probe_metadata() {
        assert!(parse_curl_output("not a probe result").is_none());
    }

    fn lookup_from<'a>(map: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| {
            map.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).to_owned())
        }
    }

    #[test]
    fn endpoints_can_be_overridden_and_blank_values_fall_back() {
        let lookup = lookup_from(&[(
            "CODEX_CREDITS_HEALTH_ENDPOINT",
            "https://probe.example.test/204",
        )]);
        assert_eq!(
            resolve_endpoint(&lookup, "CODEX_CREDITS_HEALTH_ENDPOINT", HEALTH_ENDPOINT),
            "https://probe.example.test/204"
        );
        assert_eq!(
            resolve_endpoint(&lookup, "CODEX_CREDITS_COUNTRY_ENDPOINT", COUNTRY_ENDPOINT),
            COUNTRY_ENDPOINT
        );

        let blank = lookup_from(&[("CODEX_CREDITS_HEALTH_ENDPOINT", "   ")]);
        assert_eq!(
            resolve_endpoint(&blank, "CODEX_CREDITS_HEALTH_ENDPOINT", HEALTH_ENDPOINT),
            HEALTH_ENDPOINT
        );
    }

    #[test]
    fn process_requirements_can_be_overridden_per_deployment() {
        let lookup = lookup_from(&[(
            "CODEX_CREDITS_TOMATO_PROCESSES",
            "tomato-cloud, tomato-agent ;",
        )]);
        assert_eq!(
            resolve_required_processes(&lookup),
            vec!["tomato-cloud".to_owned(), "tomato-agent".to_owned()]
        );

        let defaults = REQUIRED_PROCESSES
            .iter()
            .map(|name| (*name).to_owned())
            .collect::<Vec<_>>();
        assert_eq!(resolve_required_processes(&lookup_from(&[])), defaults);
        assert_eq!(
            resolve_required_processes(&lookup_from(&[(
                "CODEX_CREDITS_TOMATO_PROCESSES",
                " , ;"
            )])),
            defaults
        );
    }
}

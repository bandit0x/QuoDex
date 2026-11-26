//! Official Antigravity CLI (`agy`) quota sources inspired by
//! `yuhuan-dev/antigravity-usage-monitor` (zero-network `/statusline` hook)
//! and `steipete/CodexBar` (`agy -p /usage --output-format json`).
//!
//! Priority:
//! 1. Zero-network local snapshot written by the official `agy` `/statusline` hook.
//! 2. Official unmodified `agy -p /usage --output-format json` invocation (cooldown-gated).
use super::{Pool, Window};
use crate::capacity::Diagnostic;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant, UNIX_EPOCH},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const AGY_CLI_INSTALL_URL: &str = "https://antigravity.google/docs/cli";
const STATUSLINE_BRIDGE_SCRIPT: &str = include_str!("../../../scripts/agy-statusline-bridge.ps1");

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgyCliStatus {
    pub cli_installed: bool,
    pub cli_path: Option<String>,
    pub statusline_configured: bool,
    pub statusline_fresh: bool,
    pub desktop_installed: bool,
}

fn agy_settings_path() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)?;
    Some(home.join(".gemini/antigravity-cli/settings.json"))
}

fn bridge_script_path() -> Option<PathBuf> {
    #[cfg(windows)]
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
    #[cfg(not(windows))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))?;
    Some(base.join("QuoDex/GeminiQuota/agy-statusline-bridge.ps1"))
}

fn is_statusline_configured(settings_path: &Path, script_path: &Path) -> bool {
    let Ok(text) = fs::read_to_string(settings_path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        return false;
    };
    let Some(sl) = value.get("statusLine").and_then(Value::as_object) else {
        return false;
    };
    if sl.get("enabled").and_then(Value::as_bool) == Some(false) {
        return false;
    }
    let Some(cmd) = sl.get("command").and_then(Value::as_str) else {
        return false;
    };
    let expected = script_path.to_string_lossy();
    cmd.contains("agy-statusline-bridge.ps1") && (script_path.is_file() || cmd.contains(expected.as_ref()))
}

fn has_desktop_installation() -> bool {
    #[cfg(windows)]
    {
        ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"]
            .into_iter()
            .filter_map(std::env::var_os)
            .flat_map(|root| {
                [
                    PathBuf::from(&root).join("Programs/Antigravity/resources"),
                    PathBuf::from(root).join("Antigravity/resources"),
                ]
            })
            .any(|root| {
                root.join("app.asar").is_file() && root.join("bin/language_server.exe").is_file()
            })
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub(crate) fn status() -> AgyCliStatus {
    let binary = find_agy_binary();
    let script = bridge_script_path();
    let settings = agy_settings_path();
    let statusline_configured = match (&settings, &script) {
        (Some(settings), Some(script)) => is_statusline_configured(settings, script),
        _ => false,
    };
    let now_ms = chrono::Utc::now().timestamp_millis();
    let statusline_fresh = statusline_path()
        .and_then(|path| read_statusline_from_path(&path, "status-check", now_ms))
        .is_some();
    AgyCliStatus {
        cli_installed: binary.is_some(),
        cli_path: binary.map(|p| p.to_string_lossy().into_owned()),
        statusline_configured,
        statusline_fresh,
        desktop_installed: has_desktop_installation(),
    }
}

pub(crate) fn login_cli() -> Result<String, Diagnostic> {
    let Some(binary) = find_agy_binary() else {
        open::that(AGY_CLI_INSTALL_URL).map_err(|_| {
            Diagnostic::new(
                "QGM-261",
                "本机未安装 agy CLI，且无法打开浏览器；请手动访问 antigravity.google/docs/cli",
            )
        })?;
        return Ok(
            "本机未检测到 agy CLI，已为你打开官方安装说明；安装后再点「登录 agy CLI」即可一键登录"
                .into(),
        );
    };
    #[cfg(windows)]
    {
        let bin = binary.to_string_lossy();
        let command_line = format!(
            "echo [QuoDex] 正在启动官方 agy 登录，请按提示在浏览器完成授权... && \"{bin}\" auth login"
        );
        Command::new("cmd.exe")
            .args(["/k", &command_line])
            .spawn()
            .map_err(|_| {
                Diagnostic::new("QGM-262", "无法启动终端执行 agy auth login，请手动在终端登录")
            })?;
        Ok("已在终端启动官方 agy auth login；完成登录后返回点「刷新后台额度」".into())
    }
    #[cfg(not(windows))]
    {
        let _ = binary;
        Err(Diagnostic::new(
            "QGM-262",
            "请在终端手动运行 agy auth login 完成登录",
        ))
    }
}

pub(crate) fn setup_statusline() -> Result<String, Diagnostic> {
    let settings_path = agy_settings_path()
        .ok_or_else(|| Diagnostic::new("QGM-263", "找不到用户主目录，无法写入 agy 配置"))?;
    let script_path = bridge_script_path()
        .ok_or_else(|| Diagnostic::new("QGM-263", "找不到本地数据目录，无法释放状态栏桥接脚本"))?;
    setup_statusline_in_paths(&settings_path, &script_path)?;
    Ok("已配置 agy /statusline 零请求钩子；下次使用 agy 对话时将零请求同步额度".into())
}

fn setup_statusline_in_paths(settings_path: &Path, script_path: &Path) -> Result<(), Diagnostic> {
    let write_err = || Diagnostic::new("QGM-263", "无法写入 agy statusLine 配置，请检查目录权限");
    if let Some(parent) = script_path.parent() {
        fs::create_dir_all(parent).map_err(|_| write_err())?;
    }
    fs::write(script_path, STATUSLINE_BRIDGE_SCRIPT).map_err(|_| write_err())?;

    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|_| write_err())?;
    }
    let mut root = match fs::read_to_string(settings_path) {
        Ok(text) if !text.trim().is_empty() => serde_json::from_str::<Value>(&text)
            .map_err(|_| Diagnostic::new("QGM-264", "现有 agy settings.json 格式损坏，已中止修改以防覆盖"))?,
        Ok(_) => json!({}),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(_) => return Err(write_err()),
    };
    let obj = root
        .as_object_mut()
        .ok_or_else(|| Diagnostic::new("QGM-264", "现有 agy settings.json 根节点不是对象，已中止修改"))?;
    let command = format!(
        "powershell -NoProfile -ExecutionPolicy Bypass -File \"{}\"",
        script_path.to_string_lossy()
    );
    obj.insert(
        "statusLine".into(),
        json!({
            "type": "command",
            "command": command,
            "enabled": true
        }),
    );
    let formatted = serde_json::to_string_pretty(&root).map_err(|_| write_err())?;
    let tmp = settings_path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    fs::write(&tmp, format!("{formatted}\n")).map_err(|_| write_err())?;
    if fs::rename(&tmp, settings_path).is_err() {
        let _ = fs::remove_file(settings_path);
        fs::rename(&tmp, settings_path).map_err(|_| {
            let _ = fs::remove_file(&tmp);
            write_err()
        })?;
    }
    Ok(())
}

const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_STATUSLINE_BYTES: u64 = 512 * 1024;
const CLI_TIMEOUT: Duration = Duration::from_secs(20);
pub(super) const STATUSLINE_MAX_AGE_MS: i64 = 35 * 60 * 1000;
const STATUSLINE_FUTURE_SKEW_MS: i64 = 60 * 1000;
const RATE_LIMIT_FALLBACK: Duration = Duration::from_secs(120);

static CLI_RATE_LIMIT_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);

pub(super) fn statusline_path() -> Option<PathBuf> {
    if let Some(override_path) = std::env::var_os("QUODEX_AGY_STATUSLINE_FILE") {
        let path = PathBuf::from(override_path);
        if !path.as_os_str().is_empty() {
            return Some(path);
        }
    }
    #[cfg(windows)]
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
    #[cfg(not(windows))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))?;
    Some(base.join("QuoDex/GeminiQuota/statusline-quota.json"))
}

/// Layer 1: Zero-network read from the local file written by `agy`'s `/statusline` hook.
pub(super) fn read_statusline(salt: &str, now_ms: i64) -> Option<[Pool; 2]> {
    let path = statusline_path()?;
    read_statusline_from_path(&path, salt, now_ms)
}

pub(super) fn read_statusline_from_path(
    path: &Path,
    salt: &str,
    now_ms: i64,
) -> Option<[Pool; 2]> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_STATUSLINE_BYTES {
        return None;
    }
    let text = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    let file_mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(now_ms);
    let observed_at_ms = value
        .get("observedAtMs")
        .or_else(|| value.get("observed_at_ms"))
        .and_then(Value::as_i64)
        .unwrap_or(file_mtime_ms);
    if observed_at_ms > now_ms + STATUSLINE_FUTURE_SKEW_MS
        || now_ms.saturating_sub(observed_at_ms) > STATUSLINE_MAX_AGE_MS
    {
        return None;
    }
    let payload = value.get("payload").unwrap_or(&value);
    decode_quota_payload(payload, "statusline", observed_at_ms, salt, "ag-cli:statusline").ok()
}

/// Locate the user's installed official `agy` CLI binary without downloading or bundling anything.
pub(super) fn find_agy_binary() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("ANTIGRAVITY_CLI_PATH") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(path);
        }
    }
    let names: &[&str] = if cfg!(windows) {
        &["agy.exe", "agy.cmd", "agy.bat", "agy"]
    } else {
        &["agy"]
    };
    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            for name in names {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    let mut candidates = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let home = PathBuf::from(home);
        for rel in [
            ".local/bin/agy.exe",
            ".local/bin/agy",
            ".gemini/antigravity-cli/bin/agy.exe",
            ".gemini/antigravity-cli/bin/agy",
            ".antigravity/bin/agy.exe",
            ".antigravity/bin/agy",
        ] {
            candidates.push(home.join(rel));
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let local = PathBuf::from(local);
        for rel in [
            "Programs/antigravity-cli/agy.exe",
            "Programs/Antigravity/bin/agy.exe",
            "Programs/Antigravity/resources/bin/agy.exe",
            "antigravity-cli/agy.exe",
        ] {
            candidates.push(local.join(rel));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

fn cli_workdir() -> Result<PathBuf, Diagnostic> {
    #[cfg(windows)]
    let root = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| Diagnostic::new("QGM-248", "找不到本地应用数据目录"))?
        .join("QuoDex/GeminiQuota/cli-workdir");
    #[cfg(not(windows))]
    let root = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .ok_or_else(|| Diagnostic::new("QGM-248", "找不到本地应用数据目录"))?
        .join("QuoDex/GeminiQuota/cli-workdir");
    fs::create_dir_all(&root)
        .map_err(|_| Diagnostic::new("QGM-248", "无法创建 agy 隔离工作目录"))?;
    Ok(root)
}

/// Layer 2: Invoke the official `agy -p /usage --output-format json` command directly.
/// Returns `Ok(None)` when `agy` is not installed so callers can fall back cleanly.
pub(super) fn read_cli(salt: &str) -> Result<Option<[Pool; 2]>, Diagnostic> {
    let Some(binary) = find_agy_binary() else {
        return Ok(None);
    };
    if CLI_RATE_LIMIT_UNTIL
        .lock()
        .ok()
        .and_then(|until| *until)
        .is_some_and(|until| until > Instant::now())
    {
        return Err(Diagnostic::new(
            "QGM-254",
            "agy 额度服务限流，正在等待退避时间",
        ));
    }
    let workdir = cli_workdir()?;
    let mut cmd = Command::new(&binary);
    cmd.args(["-p", "/usage", "--output-format", "json"])
        .current_dir(&workdir)
        // Avoid triggering background self-updates during read-only usage checks (CodexBar lesson).
        .env("ANTIGRAVITY_CLI_DISABLE_AUTO_UPDATE", "1")
        .env("AGY_DISABLE_AUTO_UPDATE", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);

    let mut child = cmd.spawn().map_err(|_| {
        Diagnostic::new("QGM-242", "无法启动官方 agy CLI，请检查 agy 安装状态")
    })?;
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let out_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout
            .by_ref()
            .take((MAX_OUTPUT_BYTES + 1) as u64)
            .read_to_end(&mut buf);
        buf
    });
    let err_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.by_ref().take(64 * 1024).read_to_end(&mut buf);
        buf
    });

    let deadline = Instant::now() + CLI_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(Diagnostic::new(
                    "QGM-252",
                    "agy /usage 命令超时，请检查网络或登录后重试",
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => {
                let _ = child.kill();
                return Err(Diagnostic::new("QGM-243", "无法等待 agy CLI 结束"));
            }
        }
    };

    let stdout_bytes = out_thread.join().unwrap_or_default();
    let stderr_bytes = err_thread.join().unwrap_or_default();
    if stdout_bytes.len() > MAX_OUTPUT_BYTES {
        return Err(Diagnostic::new(
            "QGM-245",
            "agy 额度输出过大，请更新 QuoDex",
        ));
    }
    let stdout_text = String::from_utf8_lossy(&stdout_bytes);
    let stderr_text = String::from_utf8_lossy(&stderr_bytes);

    if let Some(diag) = classify_cli_error(&stdout_text, &stderr_text) {
        if diag.code == "QGM-254" {
            if let Ok(mut until) = CLI_RATE_LIMIT_UNTIL.lock() {
                *until = Instant::now().checked_add(RATE_LIMIT_FALLBACK);
            }
        }
        return Err(diag);
    }
    if !status.success() && stdout_text.trim().is_empty() {
        return Err(
            Diagnostic::new("QGM-255", "agy /usage 返回非零状态，请确认已完成 agy auth login")
                .with_detail(format!("exit={status}")),
        );
    }
    let now_ms = chrono::Utc::now().timestamp_millis();
    parse_cli_usage(&stdout_text, now_ms, salt).map(Some)
}

fn classify_cli_error(stdout: &str, stderr: &str) -> Option<Diagnostic> {
    let combined = format!("{stdout}\n{stderr}").to_lowercase();
    if combined.contains("429")
        || combined.contains("rate limit")
        || combined.contains("too many requests")
        || combined.contains("resource_exhausted")
    {
        return Some(Diagnostic::new(
            "QGM-254",
            "agy 额度服务限流，将自动退避后重试",
        ));
    }
    if combined.contains("not logged in")
        || combined.contains("login required")
        || combined.contains("unauthenticated")
        || combined.contains("agy auth login")
        || combined.contains("http 401")
        || combined.contains("status 401")
        || combined.contains("http 403")
        || combined.contains("terms of service")
    {
        return Some(Diagnostic::new(
            "QGM-244",
            "agy 未登录或会话已失效，请在终端执行 agy auth login 后刷新",
        ));
    }
    None
}

pub(super) fn parse_cli_usage(
    raw: &str,
    observed_at_ms: i64,
    salt: &str,
) -> Result<[Pool; 2], Diagnostic> {
    let value = extract_json_value(raw).ok_or_else(|| {
        Diagnostic::new(
            "QGM-247",
            "agy /usage 未返回可识别的 JSON 额度结构，请更新 agy 或 QuoDex",
        )
    })?;
    decode_quota_payload(&value, "cli", observed_at_ms, salt, "ag-cli:local")
}

fn extract_json_value(raw: &str) -> Option<Value> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return Some(value);
    }
    // Some CLI builds emit diagnostic/log lines before a single- or multi-line JSON envelope.
    // Find the first `{` at start-of-line that parses cleanly as a complete JSON object to EOF.
    for (idx, _) in trimmed.match_indices('{') {
        if idx == 0 || trimmed.as_bytes()[idx - 1] == b'\n' {
            if let Ok(value) = serde_json::from_str::<Value>(&trimmed[idx..]) {
                return Some(value);
            }
        }
    }
    for line in trimmed.lines().rev() {
        let line = line.trim();
        if line.starts_with('{') && line.ends_with('}') {
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                return Some(value);
            }
        }
    }
    None
}

fn extract_email(value: &Value) -> Option<String> {
    for ptr in [
        "/userStatus/email",
        "/user/email",
        "/account/email",
        "/email",
        "/response/email",
        "/usage/email",
    ] {
        if let Some(email) = value
            .pointer(ptr)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| s.contains('@') && s.len() <= 320)
        {
            return Some(email.to_lowercase());
        }
    }
    None
}

fn remaining_percent_from_bucket(bucket: &Value) -> Option<f64> {
    let direct_fraction = bucket
        .get("remainingFraction")
        .or_else(|| bucket.get("remaining_fraction"));
    let nested_fraction = bucket.get("remaining").and_then(|r| {
        r.get("remainingFraction")
            .or_else(|| r.get("remaining_fraction"))
            .or_else(|| {
                (r.get("case").and_then(Value::as_str) == Some("remainingFraction"))
                    .then(|| r.get("value"))
                    .flatten()
            })
    });
    if let (Some(a), Some(b)) = (direct_fraction, nested_fraction) {
        if a.as_f64()? != b.as_f64()? {
            return None;
        }
    }
    if let Some(raw) = direct_fraction.or(nested_fraction).and_then(Value::as_f64) {
        if !raw.is_finite() {
            return None;
        }
        if (0.0..=1.0).contains(&raw) {
            return Some(raw * 100.0);
        }
        return None;
    }
    if let Some(pct) = bucket
        .get("remainingPercent")
        .or_else(|| bucket.get("remaining_percent"))
        .and_then(Value::as_f64)
    {
        if pct.is_finite() && (0.0..=100.0).contains(&pct) {
            return Some(pct);
        }
        return None;
    }
    None
}

fn reset_from_bucket(bucket: &Value, observed_at_ms: i64) -> Option<String> {
    for key in ["resetTime", "reset_time", "resetsAt", "resets_at"] {
        if let Some(ts) = bucket.get(key).and_then(Value::as_str) {
            if chrono::DateTime::parse_from_rfc3339(ts).is_ok() {
                return Some(ts.to_owned());
            }
        }
    }
    for key in ["resetInSeconds", "reset_in_seconds"] {
        if let Some(seconds) = bucket.get(key).and_then(Value::as_i64) {
            if (0..=30 * 24 * 60 * 60).contains(&seconds) {
                let target_ms = observed_at_ms.saturating_add(seconds.saturating_mul(1000));
                if let Some(dt) = chrono::DateTime::from_timestamp_millis(target_ms) {
                    return Some(dt.to_rfc3339());
                }
            }
        }
    }
    None
}

#[derive(Clone)]
struct NormalizedBucket {
    id: String,
    window: Option<String>,
    disabled: bool,
    remaining_percent: Option<f64>,
    reset: Option<String>,
}

fn collect_buckets(value: &Value, observed_at_ms: i64) -> Option<Vec<NormalizedBucket>> {
    let mut out = Vec::new();
    let mut found_container = false;

    // Candidate roots (supports `response.groups`, `summary.groups`, `usage.groups`, top-level `groups`,
    // `quota` map/array, `buckets` array, or JSON embedded inside `response` string if structured).
    let roots: Vec<&Value> = [
        Some(value),
        value.get("response"),
        value.get("summary"),
        value.get("quotaSummary"),
        value.get("quota_summary"),
        value.get("quota"),
        value.get("usage"),
        value.get("structured_output"),
    ]
    .into_iter()
    .flatten()
    .collect();

    for root in &roots {
        if let Some(groups) = root.get("groups").and_then(Value::as_array) {
            found_container = true;
            for group in groups {
                if let Some(buckets) = group.get("buckets").and_then(Value::as_array) {
                    for bucket in buckets {
                        if let Some(id) = bucket
                            .get("bucketId")
                            .or_else(|| bucket.get("bucket_id"))
                            .or_else(|| bucket.get("id"))
                            .and_then(Value::as_str)
                        {
                            out.push(NormalizedBucket {
                                id: id.to_owned(),
                                window: bucket
                                    .get("window")
                                    .and_then(Value::as_str)
                                    .map(str::to_owned),
                                disabled: bucket.get("disabled").and_then(Value::as_bool)
                                    == Some(true),
                                remaining_percent: remaining_percent_from_bucket(bucket),
                                reset: reset_from_bucket(bucket, observed_at_ms),
                            });
                        }
                    }
                }
            }
            if !out.is_empty() {
                return Some(out);
            }
        }
    }

    // Flat `buckets` array
    for root in &roots {
        if let Some(buckets) = root.get("buckets").and_then(Value::as_array) {
            found_container = true;
            for bucket in buckets {
                if let Some(id) = bucket
                    .get("bucketId")
                    .or_else(|| bucket.get("bucket_id"))
                    .or_else(|| bucket.get("id"))
                    .and_then(Value::as_str)
                {
                    out.push(NormalizedBucket {
                        id: id.to_owned(),
                        window: bucket
                            .get("window")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        disabled: bucket.get("disabled").and_then(Value::as_bool) == Some(true),
                        remaining_percent: remaining_percent_from_bucket(bucket),
                        reset: reset_from_bucket(bucket, observed_at_ms),
                    });
                }
            }
            if !out.is_empty() {
                return Some(out);
            }
        }
    }

    // Map form used by official `agy` `/statusline` stdin: `{ "quota": { "gemini-5h": { ... } } }`
    for root in &roots {
        if let Some(map) = root.get("quota").and_then(Value::as_object) {
            if map.keys().any(|k| {
                matches!(
                    k.as_str(),
                    "gemini-5h" | "gemini-weekly" | "3p-5h" | "3p-weekly"
                )
            }) {
                for (id, bucket) in map {
                    if !bucket.is_object() {
                        continue;
                    }
                    out.push(NormalizedBucket {
                        id: id.clone(),
                        window: bucket
                            .get("window")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        disabled: bucket.get("disabled").and_then(Value::as_bool) == Some(true),
                        remaining_percent: remaining_percent_from_bucket(bucket),
                        reset: reset_from_bucket(bucket, observed_at_ms),
                    });
                }
                return Some(out);
            }
        }
    }

    found_container.then_some(out)
}

pub(super) fn decode_quota_payload(
    value: &Value,
    source: &'static str,
    observed_at_ms: i64,
    salt: &str,
    fallback_account: &str,
) -> Result<[Pool; 2], Diagnostic> {
    if value.get("code").is_some_and(|code| {
        code.as_i64() != Some(0) && !matches!(code.as_str(), Some("0" | "OK" | "SUCCESS"))
    }) || value
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(|s| s.eq_ignore_ascii_case("error") || s.eq_ignore_ascii_case("failed"))
        || value.get("error").is_some_and(|e| !e.is_null())
    {
        return Err(Diagnostic::new(
            "QGM-255",
            "AG 额度接口报告错误，请稍后刷新",
        ));
    }

    let buckets = collect_buckets(value, observed_at_ms).ok_or_else(|| {
        Diagnostic::new("QGM-247", "AG 未返回额度分组，请更新 agy 或 QuoDex 后重试")
    })?;

    let account = match extract_email(value) {
        Some(email) => format!("ag:{:x}", Sha256::digest(format!("{salt}\0{email}").as_bytes())),
        None => fallback_account.to_owned(),
    };

    let mut pools = std::array::from_fn(|_| Pool {
        source,
        account_key: Some(account.clone()),
        ..Pool::unavailable("unreadable")
    });

    for (group_index, prefix) in ["gemini", "3p"].into_iter().enumerate() {
        let pool = &mut pools[group_index];
        let mut incomplete = false;
        for (suffix, period) in [("5h", "fiveHour"), ("weekly", "weekly")] {
            let id = format!("{prefix}-{suffix}");
            let mut matches = buckets.iter().filter(|b| b.id == id);
            let Some(bucket) = matches.next() else {
                incomplete = true;
                continue;
            };
            if matches.next().is_some()
                || bucket.disabled
                || bucket.window.as_deref().is_some_and(|w| w != suffix)
            {
                incomplete = true;
                continue;
            }
            let Some(remaining_percent) = bucket.remaining_percent else {
                incomplete = true;
                continue;
            };
            pool.windows.push(Window {
                period,
                remaining_percent,
                reset: bucket.reset.clone(),
            });
        }
        if !pool.windows.is_empty() {
            pool.state = "available";
            pool.observed_at_ms = Some(observed_at_ms);
        }
        if incomplete {
            pool.diagnostic = Some(Diagnostic::new(
                "QGM-247",
                "AG 部分周期缺失、禁用或格式改变；缺失周期不会推算余额",
            ));
        }
    }

    if pools.iter().all(|p| p.windows.is_empty()) {
        return Err(Diagnostic::new(
            "QGM-247",
            "AG 额度返回中没有可用周期，请确认登录或稍后重试",
        ));
    }
    Ok(pools)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_official_statusline_quota_map_and_computes_reset_from_seconds() {
        let now_ms = 1_700_000_000_000i64;
        let payload = json!({
            "agent_state": "idle",
            "quota": {
                "gemini-5h": {
                    "remaining_fraction": 0.85,
                    "reset_time": "2026-11-26T18:00:00Z"
                },
                "gemini-weekly": {
                    "remaining_fraction": 0.42,
                    "reset_in_seconds": 3600
                },
                "3p-5h": {
                    "remaining_fraction": 1.0
                },
                "3p-weekly": {
                    "remaining_fraction": 0.5,
                    "disabled": true
                }
            }
        });
        let pools = decode_quota_payload(&payload, "statusline", now_ms, "salt", "ag-cli:statusline")
            .unwrap();
        assert_eq!(pools[0].source, "statusline");
        assert_eq!(pools[0].windows.len(), 2);
        assert_eq!(pools[0].windows[0].remaining_percent, 85.0);
        assert_eq!(pools[0].windows[0].reset.as_deref(), Some("2026-11-26T18:00:00Z"));
        assert_eq!(pools[0].windows[1].remaining_percent, 42.0);
        assert!(pools[0].windows[1].reset.is_some());
        // Disabled 3p-weekly must NOT be fabricated as 0% or 100%.
        assert_eq!(pools[1].windows.len(), 1);
        assert_eq!(pools[1].windows[0].remaining_percent, 100.0);
        assert_eq!(pools[1].diagnostic.as_ref().unwrap().code, "QGM-247");
    }

    #[test]
    fn parses_codexbar_style_cli_usage_groups_and_ignores_log_prefix() {
        let raw = r#"
[info] refreshing usage
{"status":"SUCCESS","userStatus":{"email":"User@Example.Test"},"response":{"groups":[{"buckets":[
  {"bucketId":"gemini-5h","window":"5h","remainingFraction":0.95,"resetTime":"2026-11-26T12:00:00Z"},
  {"bucketId":"gemini-weekly","window":"weekly","remaining":{"case":"remainingFraction","value":0.71}},
  {"bucketId":"3p-5h","window":"5h","remainingFraction":1},
  {"bucketId":"3p-weekly","window":"weekly","remainingFraction":0.5}
]}]}}
"#;
        let pools = parse_cli_usage(raw, 1_700_000_000_000, "salt").unwrap();
        assert_eq!(pools[0].source, "cli");
        assert_eq!(pools[0].windows[0].remaining_percent, 95.0);
        assert_eq!(pools[0].windows[1].remaining_percent, 71.0);
        assert_eq!(pools[1].windows[0].remaining_percent, 100.0);
        assert_eq!(pools[1].windows[1].remaining_percent, 50.0);
        assert!(pools[0].account_key.as_ref().unwrap().starts_with("ag:"));
        assert!(!pools[0].account_key.as_ref().unwrap().contains("example"));
    }

    #[test]
    fn rejects_inference_token_stats_without_quota_buckets() {
        let raw = r#"{"status":"SUCCESS","usage":{"input_tokens":1200,"output_tokens":50,"total_tokens":1250}}"#;
        let err = parse_cli_usage(raw, 1_700_000_000_000, "salt").unwrap_err();
        assert_eq!(err.code, "QGM-247");
    }

    #[test]
    fn reads_statusline_file_only_when_fresh() {
        let dir = std::env::temp_dir().join(format!("quodex-sl-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("statusline-quota.json");
        let now_ms = 1_700_000_000_000i64;
        fs::write(
            &file,
            serde_json::to_string(&json!({
                "observedAtMs": now_ms - 60_000,
                "payload": {
                    "quota": {
                        "gemini-5h": { "remaining_fraction": 0.9 },
                        "gemini-weekly": { "remaining_fraction": 0.8 },
                        "3p-5h": { "remaining_fraction": 1.0 },
                        "3p-weekly": { "remaining_fraction": 0.5 }
                    }
                }
            }))
            .unwrap(),
        )
        .unwrap();
        let fresh = read_statusline_from_path(&file, "salt", now_ms).unwrap();
        assert_eq!(fresh[0].windows[0].remaining_percent, 90.0);
        assert_eq!(fresh[0].observed_at_ms, Some(now_ms - 60_000));

        // Stale snapshot (> 35m) is ignored so caller refreshes via CLI/desktop.
        assert!(read_statusline_from_path(&file, "salt", now_ms + STATUSLINE_MAX_AGE_MS + 1000).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn setup_statusline_preserves_existing_settings_and_marks_configured() {
        let dir = std::env::temp_dir().join(format!("quodex-sl-cfg-{}", uuid::Uuid::new_v4()));
        let settings = dir.join("settings.json");
        let script = dir.join("agy-statusline-bridge.ps1");
        fs::create_dir_all(&dir).unwrap();
        fs::write(&settings, r#"{"theme":"dark","model":"gemini-4"}"#).unwrap();

        assert!(!is_statusline_configured(&settings, &script));
        setup_statusline_in_paths(&settings, &script).unwrap();
        assert!(script.is_file());
        assert!(is_statusline_configured(&settings, &script));

        let saved: Value = serde_json::from_str(&fs::read_to_string(&settings).unwrap()).unwrap();
        assert_eq!(saved["theme"], "dark");
        assert_eq!(saved["model"], "gemini-4");
        assert_eq!(saved["statusLine"]["enabled"], true);
        assert!(saved["statusLine"]["command"]
            .as_str()
            .unwrap()
            .contains("agy-statusline-bridge.ps1"));
        let _ = fs::remove_dir_all(&dir);
    }
}

use super::{Pool, Window};
use crate::capacity::Diagnostic;
use dom_query::Document;
use regex::Regex;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io,
    os::windows::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::LazyLock,
    time::Duration,
};
use tauri::Emitter;
use tokio::io::AsyncReadExt;

const HOME_PAGE: &str = "https://gemini.google.com/app";
const USAGE: &str = "https://gemini.google.com/usage";
const MAX_DOM: usize = 12 * 1024 * 1024;
const COMMON: [&str; 5] = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
    "--disable-sync",
    "--disable-extensions",
];

fn browser() -> Option<PathBuf> {
    [
        "Google/Chrome/Application/chrome.exe",
        "Microsoft/Edge/Application/msedge.exe",
    ]
    .into_iter()
    .flat_map(|suffix| {
        ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
            .into_iter()
            .filter_map(std::env::var_os)
            .map(move |root| PathBuf::from(root).join(suffix))
    })
    .find(|p| p.is_file())
}

fn profile() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|root| {
        PathBuf::from(root)
            .join("QuoDex")
            .join("GeminiWebSession")
            .join("profile")
    })
}

fn operation_lock(profile: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .share_mode(0)
        .open(profile.with_file_name("operation.lock"))
}

// A running Windows Chromium instance holds its profile lockfile with write sharing disabled.
fn browser_owns_profile(profile: &Path) -> bool {
    match OpenOptions::new()
        .write(true)
        .open(profile.join("lockfile"))
    {
        Ok(_) => false,
        Err(e) => e.kind() != io::ErrorKind::NotFound,
    }
}

fn command(exe: &Path, profile: &Path) -> Command {
    let mut cmd = Command::new(exe);
    let mut path = std::ffi::OsString::from("--user-data-dir=");
    path.push(profile.as_os_str());
    cmd.arg(path)
        .args(COMMON)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    cmd
}

pub(crate) fn connect(app: tauri::AppHandle) -> Result<(), Diagnostic> {
    let exe = browser()
        .ok_or_else(|| Diagnostic::new("QGM-216", "请安装 Chrome 或 Edge 以连接 Gemini Web"))?;
    let path = profile().ok_or_else(|| Diagnostic::new("QGM-217", "找不到本地用户配置目录"))?;
    fs::create_dir_all(&path)
        .map_err(|_| Diagnostic::new("QGM-217", "无法建立 Web 专用浏览器目录"))?;
    let lease = operation_lock(&path)
        .map_err(|_| Diagnostic::new("QGM-218", "专用浏览器正在登录或采样，请稍后再试"))?;
    if browser_owns_profile(&path) {
        return Err(Diagnostic::new("QGM-218", "请在已打开的专用浏览器完成连接"));
    }
    let mut child = command(&exe, &path)
        .args(["--new-window", HOME_PAGE])
        .stdout(Stdio::null())
        .spawn()
        .map_err(|_| Diagnostic::new("QGM-217", "无法启动 Web 专用登录窗口"))?;
    let _ = app.emit("gemini-web-session", true);
    std::thread::spawn(move || {
        let _ = child.wait();
        drop(lease);
        let _ = app.emit("gemini-web-session", false);
    });
    Ok(())
}

static USED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)已使用|已用|已消耗|\bused\b|\bconsumed\b").unwrap());
static LEFT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)剩余|剩餘|可用|\bremaining\b|\bleft\b").unwrap());
static ACCOUNT_EMAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)[a-z0-9.!#$%&'*+/=?^_{}|~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+").unwrap()
});
static ACCOUNT_SALT: LazyLock<uuid::Uuid> = LazyLock::new(uuid::Uuid::new_v4);
static RESET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)(重置(?:时间|時間)?[：:]?\s*(?:\d{1,2}月\d{1,2}日\s*)?\d{1,2}:\d{2}|resets?\s+(?:in|at|on)\s+[^%]{1,48}?)\s*(?:$|已使用|\d+(?:\.\d+)?\s*%\s*used)"
).unwrap()
});

fn period(label: &str) -> Option<usize> {
    let lower = label.to_lowercase();
    let weekly = ["weekly", "week limit", "每周", "每週", "本周", "本週"]
        .iter()
        .any(|s| lower.contains(s));
    let current = ["current usage", "当前用量", "目前用量"]
        .iter()
        .any(|s| lower.contains(s))
        || super::FIVE.is_match(&lower);
    (weekly != current).then_some(usize::from(weekly))
}

fn parse_window(label: &str, period: usize) -> Option<Window> {
    if USED.is_match(label) == LEFT.is_match(label) {
        return None;
    }
    let mut values = super::PERCENT.find_iter(label);
    let pct: f64 = values
        .next()?
        .as_str()
        .trim_end_matches(['%', '％'])
        .trim()
        .replace(',', ".")
        .parse()
        .ok()?;
    if values.next().is_some() || !(0.0..=100.0).contains(&pct) {
        return None;
    }
    let reset = RESET
        .captures(label)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string());
    Some(Window {
        period: ["fiveHour", "weekly"][period],
        remaining_percent: if USED.is_match(label) {
            100.0 - pct
        } else {
            pct
        },
        reset,
    })
}

fn parse_dom(html: &str) -> Pool {
    let doc = Document::from(html);
    if doc.select("body.neterror, #main-frame-error").length() > 0 {
        return Pool::error("failed", "QGM-219", "网页采样未成功，请检查网络或稍后刷新");
    }
    let lists = doc.select(
        r#"[aria-label="Usage cycles" i], [aria-label="用量周期"], [aria-label="用量週期"]"#,
    );
    if lists.length() != 1 {
        let signin = doc.select(r#"input[type="email"], a[href*="accounts.google.com/ServiceLogin"],a[href*="accounts.google.com/signin"]"#);
        if signin.length() > 0 {
            return Pool::error(
                "authRequired",
                "QGM-212",
                "请登录 Gemini Web 专用浏览器，然后关闭该窗口",
            );
        }
        return Pool::error(
            "unreadable",
            "QGM-213",
            "未取得网页用量周期，请在专用浏览器核对账号或网页状态",
        );
    }
    let accounts = doc.select(r#"[aria-label^="Google Account" i], [aria-label^="Google 账号"], [aria-label^="Google 帐号"], [aria-label^="Google 帳戶"], [aria-label^="Google 帳號"]"#);
    let identities: std::collections::BTreeSet<_> = accounts
        .nodes()
        .iter()
        .filter_map(|node| node.attr("aria-label"))
        .flat_map(|label| {
            ACCOUNT_EMAIL
                .find_iter(&label)
                .map(|m| m.as_str().to_ascii_lowercase())
                .collect::<Vec<_>>()
        })
        .collect();
    if identities.len() != 1 {
        return Pool::error("ambiguous", "QGM-230", "无法确认 Gemini 网页用量对应的账号");
    }
    let rows = lists.select("li, [role=listitem]");
    let mut windows = [None, None];
    let mut seen = [false; 2];
    for row in rows.nodes() {
        let label = row
            .attr("aria-label")
            .map(|value| value.to_string())
            .unwrap_or_else(|| {
                row.descendants_it()
                    .filter(|node| node.is_text())
                    .map(|node| node.text().trim().to_owned())
                    .filter(|text| !text.is_empty())
                    .collect::<Vec<_>>()
                    .join(" ")
            });
        let Some(index) = period(&label) else {
            continue;
        };
        if seen[index] {
            windows[index] = None;
            continue;
        }
        seen[index] = true;
        windows[index] = parse_window(&label, index).map(|mut window| {
            let reset = row
                .descendants_it()
                .filter(|time| time.node_name().as_deref() == Some("time"))
                .filter_map(|time| time.attr("datetime"))
                .filter_map(|value| chrono::DateTime::parse_from_rfc3339(&value).ok())
                .collect::<Vec<_>>();
            if let [reset] = reset.as_slice() {
                window.reset = Some(reset.to_rfc3339());
            }
            window
        });
    }
    let windows: Vec<_> = windows.into_iter().flatten().collect();
    if windows.is_empty() {
        return Pool::error(
            "unreadable",
            "QGM-213",
            "网页未显示五小时与每周两个额度周期",
        );
    }
    let partial = windows.len() < 2;
    let email = identities.first().expect("exactly one recognized account");
    let mut hash = Sha256::new();
    hash.update(ACCOUNT_SALT.as_bytes());
    hash.update(email.as_bytes());
    let mut pool = Pool::background(windows, chrono::Utc::now().timestamp_millis());
    pool.account_key = Some(format!("{:x}", hash.finalize()));
    if partial {
        pool.diagnostic = Some(Diagnostic::new("QGM-213", "网页只提供了一个可信额度周期"));
    }
    pool
}

pub(super) async fn read() -> Pool {
    let Some(path) = profile().filter(|p| p.is_dir()) else {
        return Pool::error("notConnected", "QGM-211", "请连接 Gemini Web 专用浏览器");
    };
    let Some(exe) = browser() else {
        return Pool::error("notConnected", "QGM-216", "找不到可用的 Chrome 或 Edge");
    };
    let Ok(_lease) = operation_lock(&path) else {
        return Pool::error("pending", "QGM-218", "专用窗口正在登录或采样，请稍后刷新");
    };
    if browser_owns_profile(&path) {
        return Pool::error("pending", "QGM-218", "关闭专用登录窗口后将自动采样");
    }
    let mut cmd: tokio::process::Command = command(&exe, &path).into();
    let Ok(mut child) = cmd
        .args([
            "--headless",
            "--dump-dom",
            "--virtual-time-budget=8000",
            USAGE,
        ])
        .creation_flags(0x08000000)
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
    else {
        return Pool::error("failed", "QGM-217", "无法启动后台浏览器，请检查浏览器安装");
    };
    let mut output = Vec::new();
    let capture = async {
        let mut reader = child.stdout.take()?.take((MAX_DOM + 1) as u64);
        reader.read_to_end(&mut output).await.ok()?;
        if output.len() > MAX_DOM {
            return None;
        }
        child.wait().await.ok()?.success().then_some(())
    };
    if !matches!(
        tokio::time::timeout(Duration::from_secs(35), capture).await,
        Ok(Some(()))
    ) {
        let _ = child.kill().await;
        return Pool::error("failed", "QGM-219", "网页采样未成功，请检查网络或稍后刷新");
    }
    std::str::from_utf8(&output)
        .map(parse_dom)
        .unwrap_or_else(|_| Pool::error("unreadable", "QGM-213", "网页响应编码不可识别"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_only_labeled_quota_rows() {
        let english = parse_dom(
            r#"<button aria-label="Google Account: user (person@example.test)"></button><ul aria-label="Usage cycles">
            <li><b>Current usage</b><span>5% used</span><span>Resets at 1:00 PM</span></li>
            <li><b>Weekly limit</b><span>1% used</span></li></ul>"#,
        );
        assert_eq!(english.windows[0].remaining_percent, 95.0);
        let p = parse_dom(
            r#"<script>let bait='Weekly remaining 2%';</script><button aria-label="Google 账号：用户 (person@example.test)"></button><ul aria-label="用量周期">
            <li aria-label="当前用量已使用 2%重置时间：13:26"></li>
            <li aria-label="每周限额重置时间：11月30日14:26已使用 0%"></li></ul>"#,
        );
        assert_eq!(p.state, "available");
        assert_eq!(p.windows[0].remaining_percent, 98.);
        assert_eq!(p.windows[1].remaining_percent, 100.);
        assert!(p.windows[1].reset.as_deref().unwrap().contains("11月30日"));
        assert_eq!(
            parse_dom("<main>Weekly remaining 80%</main>").state,
            "unreadable"
        );
        assert_eq!(parse_dom("<input type=email>").state, "authRequired");
    }

    #[test]
    fn isolates_duplicate_periods_and_unconfirmed_accounts() {
        let usage = r#"<ul aria-label="Usage cycles">
            <li>Current usage 100% used</li>
            <li>Weekly limit 1% used</li><li>Weekly limit 2% used</li>
            </ul>"#;
        let known = parse_dom(&format!(
            r#"<button aria-label="Google Account: First (first@example.test)"></button>{usage}"#,
        ));
        assert_eq!(known.state, "available");
        assert_eq!(known.windows.len(), 1);
        assert_eq!(known.windows[0].remaining_percent, 0.);
        assert!(known.account_key.is_some());
        assert_eq!(parse_dom(usage).state, "ambiguous");
        let other = parse_dom(&format!(
            r#"<button aria-label="Google Account: Second (second@example.test)"></button>{usage}"#,
        ));
        assert_ne!(known.account_key, other.account_key);
    }
}

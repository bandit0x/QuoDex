//! Dedicated visible browser launcher for Gemini Web (`/usage`).
//!
//! Automatic background `--headless --dump-dom` scraping of `gemini.google.com/usage`
//! has been intentionally removed to eliminate main-account anti-bot/ToS suspension risk.
//! Instead, `connect()` opens a normal visible browser window and `windows_reader`
//! passively synchronizes quota rows via Windows UI Automation while the page is visible.
use crate::capacity::Diagnostic;
use std::{
    fs::{self, File, OpenOptions},
    io,
    os::windows::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use tauri::Emitter;

const USAGE: &str = "https://gemini.google.com/usage";
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
        .map_err(|_| Diagnostic::new("QGM-218", "专用浏览器正在打开中，请稍后再试"))?;
    if browser_owns_profile(&path) {
        return Err(Diagnostic::new("QGM-218", "请在已打开的浏览器窗口查看 Gemini 用量页"));
    }
    let mut child = command(&exe, &path)
        .args(["--new-window", USAGE])
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

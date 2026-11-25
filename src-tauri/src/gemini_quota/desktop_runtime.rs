//! A short-lived copy of the installed official service owns Google authentication.
//! No credentials are extracted from the user's Desktop process.
use crate::capacity::Diagnostic;
use regex::Regex;
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    os::windows::{io::AsRawHandle, process::CommandExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, LazyLock, Mutex},
    time::{Duration, Instant},
};
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{CloseHandle, HANDLE},
        NetworkManagement::IpHelper::{
            GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
        },
        System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
    },
};

const MAX_RESPONSE: usize = 2 * 1024 * 1024;
static RATE_LIMIT_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
static PORT_LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"random port at (\d{1,5}) for HTTPS").unwrap());
static CERTIFICATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----").unwrap()
});

pub(super) struct Sample {
    pub before: Value,
    pub quota: Value,
    pub after: Value,
}

fn installation() -> Result<PathBuf, Diagnostic> {
    ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"]
        .into_iter()
        .filter_map(std::env::var_os)
        .flat_map(|root| {
            [
                PathBuf::from(&root).join("Programs/Antigravity/resources"),
                PathBuf::from(root).join("Antigravity/resources"),
            ]
        })
        .find(|root| {
            root.join("app.asar").is_file() && root.join("bin/language_server.exe").is_file()
        })
        .ok_or_else(|| Diagnostic::new("QGM-230", "未找到 Antigravity Desktop，请安装并登录后刷新"))
}

fn archive_file(
    archive: &mut File,
    header: &Value,
    base: u64,
    path: &str,
) -> Result<String, Diagnostic> {
    let invalid = || Diagnostic::new("QGM-240", "AG 安装包结构不兼容，请更新 Antigravity 后重试");
    let mut entry = header;
    for part in path.split('/') {
        entry = entry
            .get("files")
            .and_then(|v| v.get(part))
            .ok_or_else(invalid)?;
    }
    let size = entry
        .get("size")
        .and_then(Value::as_u64)
        .filter(|s| *s <= 1024 * 1024)
        .ok_or_else(invalid)?;
    let offset = entry
        .get("offset")
        .and_then(Value::as_str)
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or_else(invalid)?;
    let start = base.checked_add(offset).ok_or_else(invalid)?;
    if entry.get("unpacked").and_then(Value::as_bool) == Some(true)
        || start
            .checked_add(size)
            .filter(|end| *end <= archive.metadata().map(|m| m.len()).unwrap_or(0))
            .is_none()
    {
        return Err(invalid());
    }
    archive
        .seek(SeekFrom::Start(start))
        .map_err(|_| invalid())?;
    let mut data = vec![0; size as usize];
    archive.read_exact(&mut data).map_err(|_| invalid())?;
    String::from_utf8(data).map_err(|_| invalid())
}

fn configuration(root: &Path) -> Result<(String, Client), Diagnostic> {
    let invalid = || {
        Diagnostic::new(
            "QGM-240",
            "无法读取 AG 安装包，请修复 Antigravity 安装后重试",
        )
    };
    let mut file = File::open(root.join("app.asar")).map_err(|_| invalid())?;
    let mut prefix = [0; 16];
    file.read_exact(&mut prefix).map_err(|_| invalid())?;
    let size = u32::from_le_bytes(prefix[12..16].try_into().unwrap()) as usize;
    let base = 8 + u64::from(u32::from_le_bytes(prefix[4..8].try_into().unwrap()));
    if size > 8 * 1024 * 1024 || base < (16 + size) as u64 {
        return Err(invalid());
    }
    let mut bytes = vec![0; size];
    file.read_exact(&mut bytes).map_err(|_| invalid())?;
    let header: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    let package: Value =
        serde_json::from_str(&archive_file(&mut file, &header, base, "package.json")?)
            .map_err(|_| invalid())?;
    let version = package
        .get("version")
        .and_then(Value::as_str)
        .filter(|v| {
            !v.is_empty()
                && v.len() < 64
                && v.chars()
                    .all(|c| c.is_ascii_alphanumeric() || ".-+".contains(c))
        })
        .ok_or_else(invalid)?
        .to_owned();
    let pem = archive_file(&mut file, &header, base, "dist/actuator/pinnedLsCert.js")?;
    let mut client = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .tls_built_in_root_certs(false)
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(10))
        .pool_max_idle_per_host(0);
    let mut count = 0;
    for cert in CERTIFICATE.find_iter(&pem) {
        let certificate =
            reqwest::Certificate::from_pem(cert.as_str().as_bytes()).map_err(|_| {
                Diagnostic::new("QGM-241", "AG 本机证书不可读，请更新 Antigravity 后重试")
            })?;
        client = client.add_root_certificate(certificate);
        count += 1;
    }
    if count == 0 {
        return Err(Diagnostic::new(
            "QGM-241",
            "AG 安装包缺少本机证书，请更新 Antigravity",
        ));
    }
    Ok((
        version,
        client
            .build()
            .map_err(|_| Diagnostic::new("QGM-241", "无法建立 AG 证书校验连接"))?,
    ))
}

struct Job(HANDLE);
impl Job {
    fn new() -> Result<Self, Diagnostic> {
        let failure = || Diagnostic::new("QGM-250", "无法建立 AG 子进程保护，请重启 QuoDex 后重试");
        unsafe {
            let job = Self(CreateJobObjectW(None, PCWSTR::null()).map_err(|_| failure())?);
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as _,
                size_of_val(&limits) as u32,
            )
            .map_err(|_| failure())?;
            Ok(job)
        }
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

struct Runtime {
    child: Child,
    job: Job,
    data_dir: PathBuf,
    cleaned: bool,
}
impl Runtime {
    fn stop(&mut self) -> Result<(), Diagnostic> {
        if self.cleaned {
            return Ok(());
        }
        let job_stopped = unsafe { TerminateJobObject(self.job.0, 0) }.is_ok();
        if self.child.kill().is_err()
            && !job_stopped
            && self.child.try_wait().ok().flatten().is_none()
        {
            return Err(Diagnostic::new(
                "QGM-249",
                "无法停止 AG 采样服务，请退出 QuoDex 后重试",
            ));
        }
        self.child
            .wait()
            .map_err(|_| Diagnostic::new("QGM-249", "无法确认 AG 采样服务退出，请重启 QuoDex"))?;
        // data_dir is constructed only from the user's home and our fresh UUID;
        // never point this cleanup at the user's Antigravity application data.
        if self.data_dir.exists() {
            fs::remove_dir_all(&self.data_dir)
                .map_err(|_| Diagnostic::new("QGM-248", "AG 采样临时目录被占用，请稍后刷新"))?;
        }
        self.cleaned = true;
        Ok(())
    }
}
impl Drop for Runtime {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn owns_port(pid: u32, port: u16) -> bool {
    // GetExtendedTcpTable returns a DWORD count followed by fixed-size IPv4 rows.
    unsafe {
        let mut size = 0;
        GetExtendedTcpTable(None, &mut size, false, 2, TCP_TABLE_OWNER_PID_LISTENER, 0);
        if size < 4 || size > 16 * 1024 * 1024 {
            return false;
        }
        let mut data = vec![0u32; (size as usize).div_ceil(4)];
        if GetExtendedTcpTable(
            Some(data.as_mut_ptr().cast()),
            &mut size,
            false,
            2,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        ) != 0
        {
            return false;
        }
        let count = data[0] as usize;
        if 4 + count.saturating_mul(size_of::<MIB_TCPROW_OWNER_PID>()) > size as usize {
            return false;
        }
        (0..count).any(|index| {
            let row = (data.as_ptr().add(1) as *const MIB_TCPROW_OWNER_PID)
                .add(index)
                .read_unaligned();
            row.dwOwningPid == pid
                && u16::from_be(row.dwLocalPort as u16) == port
                && (row.dwLocalAddr == u32::from_ne_bytes([127, 0, 0, 1]) || row.dwLocalAddr == 0)
        })
    }
}

fn request(
    run: &mut Runtime,
    client: &Client,
    port: u16,
    session: &str,
    method: &str,
    body: Value,
) -> Result<Value, Diagnostic> {
    if run
        .child
        .try_wait()
        .map_err(|_| Diagnostic::new("QGM-243", "无法检查 AG 采样服务，请重试"))?
        .is_some()
        || !owns_port(run.child.id(), port)
    {
        return Err(Diagnostic::new(
            "QGM-243",
            "AG 采样服务已退出或端口变化，请刷新重试",
        ));
    }
    let failure = |error: reqwest::Error| {
        let code = if error.is_timeout() {
            "QGM-252"
        } else {
            "QGM-253"
        };
        Diagnostic::new(
            code,
            if error.is_timeout() {
                "AG 额度请求超时，请检查网络后刷新"
            } else {
                "AG 本机连接或证书校验失败，请更新 Antigravity 后重试"
            },
        )
    };
    let mut response = client
        .post(format!(
            "https://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/{method}"
        ))
        .header("x-codeium-csrf-token", session)
        .header("Connect-Protocol-Version", "1")
        .json(&body)
        .send()
        .map_err(failure)?;
    let status = response.status().as_u16();
    if status == 429 {
        let delay = retry_after(
            response
                .headers()
                .get("Retry-After")
                .and_then(|v| v.to_str().ok()),
            chrono::Utc::now().timestamp(),
        );
        if let Ok(mut until) = RATE_LIMIT_UNTIL.lock() {
            *until = Instant::now().checked_add(delay);
        }
    }
    if status != 200 {
        let (code, message) = match status {
            401 | 403 => ("QGM-244", "AG 登录已失效，请在 Antigravity 重新登录后刷新"),
            429 => ("QGM-254", "AG 额度服务限流，将稍后重试"),
            _ => ("QGM-255", "AG 额度服务暂不可用，请稍后刷新"),
        };
        return Err(Diagnostic::new(code, message).with_detail(format!("{method}: HTTP {status}")));
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take((MAX_RESPONSE + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| Diagnostic::new("QGM-256", "AG 额度响应中断，请刷新重试"))?;
    if bytes.len() > MAX_RESPONSE {
        return Err(Diagnostic::new("QGM-245", "AG 额度响应过大，请更新 QuoDex"));
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| Diagnostic::new("QGM-247", "AG 额度响应格式改变，请更新 QuoDex"))
}

pub(super) fn sample() -> Result<Sample, Diagnostic> {
    if RATE_LIMIT_UNTIL
        .lock()
        .ok()
        .and_then(|until| *until)
        .is_some_and(|until| until > Instant::now())
    {
        return Err(Diagnostic::new(
            "QGM-254",
            "AG 额度服务限流，正在等待服务端要求的重试时间",
        ));
    }
    let root = installation()?;
    let (version, client) = configuration(&root)?;
    let home = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .ok_or_else(|| Diagnostic::new("QGM-248", "找不到当前用户的 AG 数据目录"))?;
    let directory_name = format!("quodex-quota-{}", uuid::Uuid::new_v4());
    let session = uuid::Uuid::new_v4().to_string();
    let job = Job::new()?;
    let mut child = Command::new(root.join("bin/language_server.exe"))
        .args([
            "--standalone",
            "--override_ide_name",
            "antigravity",
            "--subclient_type",
            "hub",
            "--override_ide_version",
            &version,
            "--override_user_agent_name",
            "antigravity",
            "--https_server_port",
            "0",
            "--app_data_dir",
            &directory_name,
            "--api_server_url",
            "https://generativelanguage.googleapis.com",
            "--cloud_code_endpoint",
            "https://daily-cloudcode-pa.googleapis.com",
            "--disable_telemetry",
        ])
        .env("ANTIGRAVITY_SERVER_CSRF_TOKEN", &session)
        .env("AGY_REQUIRE_AUTHENTICATED_UI_BOOTSTRAP", "1")
        .creation_flags(0x0800_0000)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| {
            Diagnostic::new(
                "QGM-242",
                "无法启动已安装的 AG 服务，请修复 Antigravity 后重试",
            )
        })?;
    if unsafe { AssignProcessToJobObject(job.0, HANDLE(child.as_raw_handle())) }.is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return Err(Diagnostic::new(
            "QGM-250",
            "无法保护 AG 采样子进程，本次采样已停止",
        ));
    }
    let mut run = Runtime {
        child,
        job,
        data_dir: home.join(".gemini").join(directory_name),
        cleaned: false,
    };
    let (send, receive) = mpsc::sync_channel(1);
    fn drain(mut stream: impl Read + Send + 'static, send: mpsc::SyncSender<u16>) {
        std::thread::spawn(move || {
            let mut buffer = [0; 4096];
            let mut tail = String::new();
            while let Ok(size) = stream.read(&mut buffer) {
                if size == 0 {
                    break;
                }
                tail.push_str(&String::from_utf8_lossy(&buffer[..size]));
                if let Some(port) = PORT_LINE
                    .captures(&tail)
                    .and_then(|c| c[1].parse::<u16>().ok())
                    .filter(|p| *p > 0)
                {
                    let _ = send.try_send(port);
                }
                // Retain only a short suffix for split log lines. Never log or persist it.
                if tail.len() > 256 {
                    let start = tail.floor_char_boundary(tail.len() - 256);
                    tail.drain(..start);
                }
            }
        });
    }
    drain(run.child.stdout.take().unwrap(), send.clone());
    drain(run.child.stderr.take().unwrap(), send);
    let result = (|| {
        let deadline = Instant::now() + Duration::from_secs(15);
        let port = loop {
            match receive.recv_timeout(Duration::from_millis(200)) {
                Ok(port) => break port,
                Err(_)
                    if Instant::now() >= deadline
                        || run.child.try_wait().ok().flatten().is_some() =>
                {
                    return Err(Diagnostic::new(
                        "QGM-242",
                        "AG 采样服务启动超时或已退出，请重试",
                    ))
                }
                Err(_) => {}
            }
        };
        let before = request(
            &mut run,
            &client,
            port,
            &session,
            "GetUserStatus",
            json!({}),
        )?;
        if before
            .pointer("/userStatus/email")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .is_none()
        {
            return Err(Diagnostic::new(
                "QGM-244",
                "请先在 Antigravity 登录账号，再刷新额度",
            ));
        }
        let quota = request(
            &mut run,
            &client,
            port,
            &session,
            "RetrieveUserQuotaSummary",
            json!({"forceRefresh": true}),
        )?;
        let after = request(
            &mut run,
            &client,
            port,
            &session,
            "GetUserStatus",
            json!({}),
        )?;
        Ok(Sample {
            before,
            quota,
            after,
        })
    })();
    let cleanup = run.stop();
    result.and_then(|sample| cleanup.map(|_| sample))
}

fn retry_after(value: Option<&str>, now: i64) -> Duration {
    let seconds = value
        .and_then(|s| {
            s.parse::<u64>().ok().or_else(|| {
                chrono::DateTime::parse_from_rfc2822(s)
                    .ok()
                    .map(|at| at.timestamp().saturating_sub(now).max(0) as u64)
            })
        })
        .unwrap_or(120);
    // Avoid Instant overflow for malformed, excessively large server values.
    Duration::from_secs(seconds.clamp(1, 365 * 24 * 60 * 60))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limit_supports_both_http_retry_after_formats() {
        assert_eq!(retry_after(Some("600"), 0), Duration::from_secs(600));
        assert_eq!(
            retry_after(Some("Thu, 01 Jan 1970 00:10:00 GMT"), 0),
            Duration::from_secs(600)
        );
        assert_eq!(retry_after(None, 0), Duration::from_secs(120));
    }

    #[test]
    fn job_close_terminates_owned_process_without_touching_other_instances() {
        let job = Job::new().unwrap();
        let mut child = Command::new("cmd.exe")
            .args(["/c", "pause"])
            .creation_flags(0x0800_0000)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .spawn()
            .unwrap();
        unsafe {
            AssignProcessToJobObject(job.0, HANDLE(child.as_raw_handle())).unwrap();
        }
        assert!(child.try_wait().unwrap().is_none());
        drop(job);
        let deadline = Instant::now() + Duration::from_secs(3);
        while child.try_wait().unwrap().is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        let stopped = child.try_wait().unwrap().is_some();
        if !stopped {
            let _ = child.kill();
            let _ = child.wait();
        }
        assert!(
            stopped,
            "Job Object must terminate its child when QuoDex exits"
        );
    }
}

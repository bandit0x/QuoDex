//! 本机只读统计服务：监听 127.0.0.1，提供静态用量页与快照接口。
//!
//! 规则来自 `.scratch/token-usage/spec.md`：只读服务、不读取聊天正文或凭据；
//! 页面断开时保留已显示数字；服务端不区分来源地暴露同一份快照。

use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use crate::capacity::Diagnostic;
use crate::usage_service::UsageService;

const PAGE_INDEX: &str = include_str!("../usage-page/index.html");
const PAGE_CSS: &str = include_str!("../usage-page/usage.css");
const PAGE_CORE_JS: &str = include_str!("../usage-page/usage-core.js");
const PAGE_APP_JS: &str = include_str!("../usage-page/usage.js");
const PAGE_MATERIAL_JS: &str = include_str!("../usage-page/usage-material.js");

pub struct UsageServer {
    pub url: String,
}

impl UsageServer {
    /// 绑定 127.0.0.1 的随机可用端口并开始服务。
    pub async fn start(service: Arc<UsageService>) -> Result<UsageServer, Diagnostic> {
        let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|error| {
            Diagnostic::new("QUT-701", "无法准备本机用量页，请重试")
                .with_detail(format!("本机服务端口绑定失败：{error}"))
        })?;
        let address = listener.local_addr().map_err(|error| {
            Diagnostic::new("QUT-701", "无法准备本机用量页，请重试")
                .with_detail(format!("本机服务地址读取失败：{error}"))
        })?;
        let accept_loop = async move {
            while let Ok((stream, _)) = listener.accept().await {
                let service = Arc::clone(&service);
                tokio::spawn(serve_connection(stream, service));
            }
        };
        tauri::async_runtime::spawn(async move {
            tokio::select! {
                _ = accept_loop => {},
                _ = tokio::time::sleep(std::time::Duration::from_secs(3600 * 24 * 365)) => {},
            }
        });
        Ok(UsageServer {
            url: format!("http://{address}/"),
        })
    }
}

async fn serve_connection(mut stream: TcpStream, service: Arc<UsageService>) {
    let _ = stream.set_nodelay(true);
    let mut head = Vec::new();
    let mut chunk = [0u8; 2048];
    // 读取请求头；单次 GET 请求头很小，超时或超长直接断开。
    let request_line = loop {
        match tokio::time::timeout(std::time::Duration::from_secs(5), stream.read(&mut chunk)).await {
            Ok(Ok(0)) | Ok(Err(_)) | Err(_) => return,
            Ok(Ok(read)) => {
                head.extend_from_slice(&chunk[..read]);
                if let Some(position) = find_head_end(&head) {
                    break parse_request_line(&head[..position]);
                }
                if head.len() > 16 * 1024 {
                    return;
                }
            }
        }
    };
    let Some((method, target)) = request_line else {
        let _ = stream.write_all(&response("400 Bad Request", "text/plain; charset=utf-8", b"bad request".to_vec())).await;
        return;
    };
    // 单来源重试：POST /api/refresh?source=codex|zcode|all，在阻塞线程执行读取。
    if method == "POST" && target.split(['?', '#']).next() == Some("/api/refresh") {
        let source = target
            .split_once('?')
            .map(|(_, query)| query)
            .unwrap_or("")
            .split('&')
            .find_map(|pair| pair.split_once('=').filter(|(key, _)| *key == "source").map(|(_, value)| value.to_string()))
            .unwrap_or_else(|| "all".to_string());
        let refresh_service = Arc::clone(&service);
        drop(tauri::async_runtime::spawn_blocking(move || match source.as_str() {
            "codex" => refresh_service.refresh_source("codex"),
            "zcode" => refresh_service.refresh_source("zcode"),
            _ => refresh_service.refresh(),
        }));
        let _ = stream
            .write_all(&response(
                "202 Accepted",
                "application/json; charset=utf-8",
                br#"{"accepted":true}"#.to_vec(),
            ))
            .await;
        let _ = stream.shutdown().await;
        return;
    }
    let (status, content_type, body) = route(method, target, &service);
    let _ = stream
        .write_all(&response(status, content_type, body))
        .await;
    let _ = stream.shutdown().await;
}

fn find_head_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_request_line(head: &[u8]) -> Option<(&str, &str)> {
    let line = head.split(|byte| *byte == b'\n').next()?;
    let line = std::str::from_utf8(line).ok()?.trim_end_matches('\r');
    let mut parts = line.split_whitespace();
    let method = parts.next()?;
    let target = parts.next()?;
    Some((method, target))
}

fn route(method: &str, target: &str, service: &UsageService) -> (&'static str, &'static str, Vec<u8>) {
    let path = target.split(['?', '#']).next().unwrap_or("/");
    if method != "GET" {
        return ("405 Method Not Allowed", "text/plain; charset=utf-8", b"method not allowed".to_vec());
    }
    match path {
        "/" | "/index.html" => ("200 OK", "text/html; charset=utf-8", PAGE_INDEX.as_bytes().to_vec()),
        "/usage.css" => ("200 OK", "text/css; charset=utf-8", PAGE_CSS.as_bytes().to_vec()),
        "/usage-core.js" => ("200 OK", "text/javascript; charset=utf-8", PAGE_CORE_JS.as_bytes().to_vec()),
        "/usage.js" => ("200 OK", "text/javascript; charset=utf-8", PAGE_APP_JS.as_bytes().to_vec()),
        "/usage-material.js" => ("200 OK", "text/javascript; charset=utf-8", PAGE_MATERIAL_JS.as_bytes().to_vec()),
        "/api/usage" => match serde_json::to_vec(&service.snapshot()) {
            Ok(body) => ("200 OK", "application/json; charset=utf-8", body),
            Err(_) => ("500 Internal Server Error", "application/json", b"{}".to_vec()),
        },
        _ => ("404 Not Found", "text/plain; charset=utf-8", b"not found".to_vec()),
    }
}

fn response(status: &str, content_type: &str, body: Vec<u8>) -> Vec<u8> {
    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    head.extend_from_slice(&body);
    head
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usage_service::UsageService;

    async fn start_test_service(tag: &str) -> (UsageServer, Arc<UsageService>, std::path::PathBuf) {
        let home = std::env::temp_dir().join(format!("quodex-server-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        let service = Arc::new(UsageService::new(
            home.clone(),
            home.join("ledger.sqlite"),
        ));
        let server = UsageServer::start(Arc::clone(&service)).await.expect("start server");
        (server, service, home)
    }

    async fn get(url: &str, path: &str) -> (u16, String, Vec<u8>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let authority = url.trim_start_matches("http://").trim_end_matches('/');
        let mut stream = tokio::net::TcpStream::connect(authority).await.unwrap();
        stream
            .write_all(format!("GET {path} HTTP/1.1\r\nHost: localhost\r\n\r\n").as_bytes())
            .await
            .unwrap();
        let mut buffer = Vec::new();
        stream.read_to_end(&mut buffer).await.unwrap();
        let text = String::from_utf8_lossy(&buffer).to_string();
        let status: u16 = text
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse().ok())
            .unwrap_or(0);
        let content_type = text
            .split("\r\n")
            .find(|line| line.to_ascii_lowercase().starts_with("content-type"))
            .map(|line| line.split_once(':').unwrap().1.trim().to_string())
            .unwrap_or_default();
        let body = buffer
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|position| buffer[position + 4..].to_vec())
            .unwrap_or_default();
        (status, content_type, body)
    }

    #[tokio::test]
    async fn serves_page_assets_and_snapshot_api() {
        let (server, _service, home) = start_test_service("assets").await;
        let (status, content_type, body) = get(&server.url, "/").await;
        assert_eq!(status, 200);
        assert!(content_type.starts_with("text/html"));
        let html = String::from_utf8(body).unwrap();
        assert!(html.contains("用量统计"));
        assert!(html.contains("本机所有项目"));

        let (status, _, body) = get(&server.url, "/usage.css").await;
        assert_eq!(status, 200);
        assert!(String::from_utf8_lossy(&body).contains("--lv1"));

        let (status, content_type, body) = get(&server.url, "/api/usage").await;
        assert_eq!(status, 200);
        assert!(content_type.starts_with("application/json"));
        let snapshot: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(snapshot["codex"]["state"], "backfill");
        assert_eq!(snapshot["zcode"]["state"], "backfill");
        assert!(snapshot["generatedAtMs"].as_i64().unwrap() > 0);

        let (status, _, _) = get(&server.url, "/usage.js").await;
        assert_eq!(status, 200);
        let (status, _, _) = get(&server.url, "/usage-core.js").await;
        assert_eq!(status, 200);
        let (status, content_type, body) = get(&server.url, "/usage-material.js").await;
        assert_eq!(status, 200);
        assert!(content_type.starts_with("text/javascript"));
        assert!(String::from_utf8_lossy(&body).contains("initUsageMaterial"));
        let (status, _, _) = get(&server.url, "/../etc/passwd").await;
        assert_eq!(status, 404);
        let _ = std::fs::remove_dir_all(home);
    }

    #[tokio::test]
    async fn rejects_non_get_requests() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (server, _service, home) = start_test_service("post").await;
        let authority = server.url.trim_start_matches("http://").trim_end_matches('/');
        let mut stream = tokio::net::TcpStream::connect(authority).await.unwrap();
        stream
            .write_all(b"POST /api/usage HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n")
            .await
            .unwrap();
        let mut buffer = Vec::new();
        stream.read_to_end(&mut buffer).await.unwrap();
        let text = String::from_utf8_lossy(&buffer).to_string();
        assert!(text.starts_with("HTTP/1.1 405"), "POST must be rejected: {text}");
        let _ = std::fs::remove_dir_all(home);
    }
}

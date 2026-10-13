//! Official Baidu endpoints only. No credential-bearing URL enters a diagnostic.
use crate::{
    capacity::Diagnostic,
    sync_engine::{Object, Store},
    usage_sync::{error, MAX_BATCH_BYTES},
};
use reqwest::{
    blocking::{multipart, Client, RequestBuilder},
    Url,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, io::Read, time::Duration};

const FILE: &str = "https://pan.baidu.com/rest/2.0/xpan/file";
const TOKEN: &str = "https://openapi.baidu.com/oauth/2.0/token";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub app_key: String,
    pub secret_key: String,
    pub folder: String,
    pub token: Option<Token>,
    #[serde(default)]
    pub refresh_in_flight: bool,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Token {
    pub access: String,
    pub refresh: String,
    pub expires_at: i64,
}
pub struct DeviceCode {
    pub code: String,
    pub user_code: String,
    pub url: String,
    pub expires_at: i64,
    pub interval: u64,
}
pub enum Authorization {
    Pending,
    Slow,
    Ready(Token),
}
fn protocol() -> Diagnostic {
    error(
        "QDS-105",
        "百度返回了无法识别的数据；同步已暂停，请稍后重试或更新 QuoDex",
    )
}
fn network() -> Diagnostic {
    error("QDS-103", "无法连接百度网盘；请检查网络，账目已保存在本机")
}
pub fn client() -> Result<Client, Diagnostic> {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("pan.baidu.com")
        .build()
        .map_err(|_| network())
}
fn bytes(response: reqwest::blocking::Response, limit: usize) -> Result<Vec<u8>, Diagnostic> {
    if !response.status().is_success() {
        return Err(network());
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(protocol());
    }
    let mut body = Vec::new();
    response
        .take(limit as u64 + 1)
        .read_to_end(&mut body)
        .map_err(|_| network())?;
    if body.len() > limit {
        return Err(protocol());
    }
    Ok(body)
}
fn request(request: RequestBuilder) -> Result<Value, Diagnostic> {
    let response = request.send().map_err(|_| network())?;
    // OAuth errors can be HTTP 400. Parse their bounded body before classifying.
    let status = response.status();
    let mut body = Vec::new();
    response
        .take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut body)
        .map_err(|_| network())?;
    if body.len() > 4 * 1024 * 1024 {
        return Err(protocol());
    }
    let value: Value = serde_json::from_slice(&body).map_err(|_| network())?;
    if !status.is_success() && value.get("error").is_none() {
        return Err(network());
    }
    Ok(value)
}
fn required(v: &Value, key: &str) -> Result<String, Diagnostic> {
    v[key]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() < 8192)
        .map(str::to_owned)
        .ok_or_else(protocol)
}
fn api_error(n: i64) -> Diagnostic {
    match n {
        110 | 111 | 1101 => error("QDS-101", "百度授权已失效；请在同步设置中重新授权"),
        -10 => error("QDS-106", "百度网盘空间不足；请释放空间后重试"),
        -7 | 31024 | 31064 => error("QDS-102", "应用目录或网盘权限不正确；请检查开发者应用配置"),
        _ => error(
            "QDS-104",
            &format!("百度拒绝了请求（接口代码 {n}）；请检查应用权限或稍后重试"),
        ),
    }
}
fn checked(v: Value) -> Result<Value, Diagnostic> {
    let n = v["errno"].as_i64().ok_or_else(protocol)?;
    if n != 0 {
        return Err(api_error(n));
    }
    if let Some(n) = v["data"]["errno"].as_i64() {
        if n != 0 {
            return Err(api_error(n));
        }
    }
    Ok(v)
}
fn token(v: Value) -> Result<Token, Diagnostic> {
    if v.get("error").is_some() {
        return Err(error("QDS-101", "百度授权未完成或已失效；请重新授权"));
    }
    let ttl = v["expires_in"]
        .as_i64()
        .filter(|n| *n > 0 && *n < 366 * 86400)
        .ok_or_else(protocol)?;
    Ok(Token {
        access: required(&v, "access_token")?,
        refresh: required(&v, "refresh_token")?,
        expires_at: crate::usage_ledger::now_ms() + ttl * 1000,
    })
}
pub fn validate(c: &Credentials) -> Result<(), Diagnostic> {
    if c.app_key.trim().is_empty()
        || c.secret_key.trim().is_empty()
        || c.app_key.len() > 256
        || c.secret_key.len() > 512
        || c.folder.trim().is_empty()
        || c.folder.len() > 200
        || c.folder == "."
        || c.folder == ".."
        || c.folder
            .chars()
            .any(|x| x.is_control() || "/\\:*?\"<>|".contains(x))
    {
        return Err(error(
            "QDS-102",
            "请填写 AppKey、SecretKey 和申请时的应用文件夹名称（不含路径分隔符）",
        ));
    }
    Ok(())
}
pub fn device_code(c: &Credentials) -> Result<DeviceCode, Diagnostic> {
    validate(c)?;
    let v = request(
        client()?
            .get("https://openapi.baidu.com/oauth/2.0/device/code")
            .query(&[
                ("response_type", "device_code"),
                ("client_id", &c.app_key),
                ("scope", "basic,netdisk"),
            ]),
    )?;
    if v.get("error").is_some() {
        return Err(error(
            "QDS-102",
            "百度拒绝发放设备码；请检查 AppKey 和网盘授权权限",
        ));
    }
    let ttl = v["expires_in"]
        .as_i64()
        .filter(|n| *n > 0 && *n <= 3600)
        .ok_or_else(protocol)?;
    let user_code = required(&v, "user_code")?;
    let mut url = Url::parse("https://openapi.baidu.com/device").expect("constant URL");
    url.query_pairs_mut()
        .append_pair("display", "mobile")
        .append_pair("code", &user_code);
    Ok(DeviceCode {
        code: required(&v, "device_code")?,
        user_code,
        url: url.into(),
        expires_at: crate::usage_ledger::now_ms() + ttl * 1000,
        interval: v["interval"].as_u64().unwrap_or(6).clamp(6, 300),
    })
}
pub fn poll(c: &Credentials, code: &str) -> Result<Authorization, Diagnostic> {
    let v = request(client()?.get(TOKEN).query(&[
        ("grant_type", "device_token"),
        ("code", code),
        ("client_id", &c.app_key),
        ("client_secret", &c.secret_key),
    ]))?;
    match v["error"].as_str() {
        Some("authorization_pending") => Ok(Authorization::Pending),
        Some("slow_down") => Ok(Authorization::Slow),
        Some("authorization_declined" | "access_denied") => {
            Err(error("QDS-101", "你已取消百度授权；需要时可重新连接"))
        }
        _ => token(v).map(Authorization::Ready),
    }
}
pub fn refresh(c: &Credentials) -> Result<Token, Diagnostic> {
    let old = c
        .token
        .as_ref()
        .ok_or_else(|| error("QDS-101", "请先授权百度网盘"))?;
    token(request(client()?.get(TOKEN).query(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", old.refresh.as_str()),
        ("client_id", &c.app_key),
        ("client_secret", &c.secret_key),
    ]))?)
}

fn trusted(url: &Url, upload: bool) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.host_str().is_some_and(|h| {
            h.ends_with(".pcs.baidu.com")
                || h == "pcs.baidu.com"
                || (!upload && (h == "baidupcs.com" || h.ends_with(".baidupcs.com")))
        })
        && (!upload || (url.path() == "/" && url.query().is_none() && url.fragment().is_none()))
}
fn rejected_download(url: &Url) -> Diagnostic {
    error(
        "QDS-112",
        &format!(
            "下载地址未通过安全校验（主机：{}）；已停止请求，请反馈此主机名以检查支持情况",
            url.host_str().unwrap_or("无有效主机")
        ),
    )
}
pub struct BaiduStore {
    client: Client,
    access: String,
    root: String,
    files: BTreeMap<String, Value>,
    #[cfg(test)]
    test_origin: Option<String>,
}
impl BaiduStore {
    pub fn new(c: &Credentials) -> Result<Self, Diagnostic> {
        validate(c)?;
        let token = c
            .token
            .as_ref()
            .ok_or_else(|| error("QDS-101", "请先授权百度网盘"))?;
        let mut store = Self {
            client: client()?,
            access: token.access.clone(),
            root: format!("/apps/{}/QuoDex", c.folder),
            files: BTreeMap::new(),
            #[cfg(test)]
            test_origin: None,
        };
        store.mkdir()?;
        Ok(store)
    }
    fn endpoint(&self, url: &str) -> String {
        #[cfg(test)]
        if let Some(origin) = &self.test_origin {
            return format!("{}{}", origin, Url::parse(url).unwrap().path());
        }
        url.into()
    }
    fn trusted(&self, url: &Url, upload: bool) -> bool {
        #[cfg(test)]
        if self
            .test_origin
            .as_ref()
            .is_some_and(|o| url.origin().ascii_serialization() == *o)
        {
            return true;
        }
        trusted(url, upload)
    }
    fn get(&self, url: &str, method: &str) -> RequestBuilder {
        self.client
            .get(self.endpoint(url))
            .query(&[("method", method), ("access_token", &self.access)])
    }
    fn post(&self, method: &str) -> RequestBuilder {
        self.client
            .post(self.endpoint(FILE))
            .query(&[("method", method), ("access_token", &self.access)])
    }
    fn path(&self, name: &str) -> Result<String, Diagnostic> {
        if name.is_empty()
            || name.len() > 100
            || !name
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
            || name.contains("..")
        {
            return Err(protocol());
        }
        Ok(format!("{}/{name}", self.root))
    }
    fn mkdir(&mut self) -> Result<(), Diagnostic> {
        let v = request(self.post("create").form(&[
            ("path", self.root.as_str()),
            ("isdir", "1"),
            ("rtype", "0"),
        ]))?;
        if v["errno"] == -8 {
            // list fails if an existing object is a file or is inaccessible.
            self.list()?;
            return Ok(());
        }
        let v = checked(v)?;
        if v["path"] != self.root || v["isdir"] != 1 {
            return Err(protocol());
        }
        Ok(())
    }
}
impl Store for BaiduStore {
    fn list(&mut self) -> Result<Vec<Object>, Diagnostic> {
        let mut out = BTreeMap::new();
        self.files.clear();
        for page in 0..100 {
            let v = checked(request(self.get(FILE, "list").query(&[
                ("dir", self.root.clone()),
                ("order", "name".into()),
                ("desc", "0".into()),
                ("start", (page * 1000).to_string()),
                ("limit", "1000".into()),
                ("folder", "0".into()),
            ]))?)?;
            let rows = v
                .get("list")
                .or_else(|| v["data"].get("list"))
                .and_then(Value::as_array)
                .ok_or_else(protocol)?;
            for row in rows {
                if row["isdir"] != 0 {
                    continue;
                }
                let name = required(row, "server_filename")?;
                if row["path"] != self.path(&name)? {
                    return Err(protocol());
                }
                if row["fs_id"].as_u64().is_none() {
                    return Err(protocol());
                }
                out.insert(
                    name.clone(),
                    Object {
                        name: name.clone(),
                        modified_ms: row["server_mtime"]
                            .as_i64()
                            .unwrap_or(0)
                            .saturating_mul(1000),
                    },
                );
                self.files.insert(name, row.clone());
            }
            if rows.len() < 1000 {
                return Ok(out.into_values().collect());
            }
        }
        Err(error(
            "QDS-108",
            "同步目录超过首期 100,000 个文件上限；本机记账继续，请联系维护者迁移账本",
        ))
    }
    fn read(&mut self, name: &str) -> Result<Vec<u8>, Diagnostic> {
        self.path(name)?;
        if !self.files.contains_key(name) {
            self.list()?;
        }
        let item = self
            .files
            .get(name)
            .ok_or_else(|| error("QDS-103", "同步文件尚未可见；稍后会自动补齐"))?;
        let id = item["fs_id"].as_u64().ok_or_else(protocol)?;
        if item["size"]
            .as_u64()
            .is_some_and(|n| n > MAX_BATCH_BYTES as u64)
        {
            return Err(protocol());
        }
        let v = checked(request(
            self.get(
                "https://pan.baidu.com/rest/2.0/xpan/multimedia",
                "filemetas",
            )
            .query(&[("fsids", format!("[{id}]")), ("dlink", "1".into())]),
        )?)?;
        let row = v["list"]
            .as_array()
            .and_then(|a| a.iter().find(|r| r["fs_id"].as_u64() == Some(id)))
            .ok_or_else(protocol)?;
        if row["errno"].as_i64().is_some_and(|n| n != 0) || row["isdir"] != 0 {
            return Err(protocol());
        }
        let mut url = Url::parse(&required(row, "dlink")?).map_err(|_| protocol())?;
        for _ in 0..5 {
            if !self.trusted(&url, false) {
                return Err(rejected_download(&url));
            }
            let pairs: Vec<(String, String)> = url
                .query_pairs()
                .filter(|(k, _)| k != "access_token")
                .map(|(k, v)| (k.into(), v.into()))
                .collect();
            url.set_query(None);
            url.query_pairs_mut()
                .extend_pairs(pairs)
                .append_pair("access_token", &self.access);
            let response = self.client.get(url.clone()).send().map_err(|_| network())?;
            if response.status().is_redirection() {
                let next = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|h| h.to_str().ok())
                    .ok_or_else(protocol)?;
                url = url.join(next).map_err(|_| protocol())?;
                continue;
            }
            return bytes(response, MAX_BATCH_BYTES);
        }
        Err(protocol())
    }
    fn create(&mut self, name: &str, body: &[u8]) -> Result<(), Diagnostic> {
        use md5::{Digest, Md5};
        if body.is_empty() || body.len() > MAX_BATCH_BYTES {
            return Err(protocol());
        }
        let path = self.path(name)?;
        let size = body.len().to_string();
        let md5 = format!("{:x}", Md5::digest(body));
        let blocks = json!([md5]).to_string();
        let pre = checked(request(self.post("precreate").form(&[
            ("path", path.as_str()),
            ("size", &size),
            ("isdir", "0"),
            ("autoinit", "1"),
            ("rtype", "0"),
            ("block_list", &blocks),
        ]))?)?;
        let upload = required(&pre, "uploadid")?;
        let parts = pre["block_list"].as_array().ok_or_else(protocol)?;
        if parts.len() > 1 || parts.iter().any(|p| p != 0) {
            return Err(protocol());
        }
        let location = request(
            self.get("https://d.pcs.baidu.com/rest/2.0/pcs/file", "locateupload")
                .query(&[
                    ("appid", "250528"),
                    ("path", path.as_str()),
                    ("uploadid", &upload),
                    ("upload_version", "2.0"),
                ]),
        )?;
        let code = location["error_code"].as_i64().ok_or_else(protocol)?;
        if code != 0 {
            return Err(api_error(code));
        }
        let mut host =
            Url::parse(&required(&location["servers"][0], "server")?).map_err(|_| protocol())?;
        if !self.trusted(&host, true) {
            return Err(error(
                "QDS-112",
                "百度返回了尚未支持的上传域名；请更新 QuoDex",
            ));
        }
        host.set_path("/rest/2.0/pcs/superfile2");
        let part = request(
            self.client
                .post(host)
                .query(&[
                    ("method", "upload"),
                    ("access_token", &self.access),
                    ("type", "tmpfile"),
                    ("path", &path),
                    ("uploadid", &upload),
                    ("partseq", "0"),
                ])
                .multipart(multipart::Form::new().part(
                    "file",
                    multipart::Part::bytes(body.to_vec()).file_name("batch.json"),
                )),
        )?;
        for key in ["errno", "error_code"] {
            if let Some(n) = part[key].as_i64() {
                if n != 0 {
                    return Err(api_error(n));
                }
            }
        }
        if part["md5"] != md5 {
            return Err(protocol());
        }
        let result = checked(request(self.post("create").form(&[
            ("path", path.as_str()),
            ("size", &size),
            ("isdir", "0"),
            ("rtype", "0"),
            ("uploadid", &upload),
            ("block_list", &blocks),
        ]))?)?;
        if result["path"] != path
            || result["size"].as_u64() != Some(body.len() as u64)
            || result["fs_id"].as_u64().is_none()
        {
            return Err(protocol());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_baidu_download_cdn_without_expanding_upload_hosts() {
        let cdn =
            Url::parse("https://qdbh-cu01.baidupcs.com/file/synthetic?sign=synthetic").unwrap();
        assert!(
            trusted(&cdn, false),
            "Baidu download CDN incorrectly triggers QDS-112"
        );
        assert!(!trusted(
            &Url::parse("https://qdbh-cu01.baidupcs.com/").unwrap(),
            true
        ));
    }
    #[test]
    fn refuses_credential_forwarding_to_untrusted_hosts() {
        for u in [
            "http://c.pcs.baidu.com/",
            "https://c.pcs.baidu.com.evil.org/",
            "https://user@c.pcs.baidu.com/",
            "https://127.0.0.1/",
            "https://c.pcs.baidu.com:8443/",
            "https://baidupcs.com.evil.org/file",
            "https://evilbaidupcs.com/file",
            "http://cdn.baidupcs.com/file",
            "https://cdn.baidupcs.com:8443/file",
            "https://secret@cdn.baidupcs.com/file",
        ] {
            assert!(!trusted(&Url::parse(u).unwrap(), false), "{u}");
        }
        assert!(trusted(
            &Url::parse("https://c3.pcs.baidu.com/").unwrap(),
            true
        ));
    }
    #[test]
    fn errors_are_actionable_without_echoing_server_secrets() {
        let rejected = rejected_download(&Url::parse("https://secret@unknown.example/private-path?access_token=sensitive-token#private-fragment").unwrap());
        assert!(rejected.message.contains("unknown.example"));
        for secret in [
            "secret",
            "private-path",
            "sensitive-token",
            "private-fragment",
        ] {
            assert!(!rejected.to_string().contains(secret));
        }
        let e = checked(json!({"errno":110,"errmsg":"sensitive-token"})).unwrap_err();
        assert_eq!(e.code, "QDS-101");
        assert!(!e.to_string().contains("sensitive"));
        assert!(checked(json!({"list":[]})).is_err());
    }
    #[test]
    fn fake_http_reads_oauth_pending_returned_as_http_400() {
        use std::io::Write;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut b = [0; 2048];
            assert!(s.read(&mut b).unwrap() > 0, "client sent no request bytes");
            let body = r#"{"error":"authorization_pending"}"#;
            write!(
                s,
                "HTTP/1.1 400 Bad Request\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        assert_eq!(
            request(client().unwrap().get(format!("http://{address}"))).unwrap()["error"],
            "authorization_pending"
        );
        worker.join().unwrap();
    }

    #[test]
    fn official_upload_and_download_contract_through_loopback_http() {
        use md5::{Digest, Md5};
        use std::io::Write;
        let body = br#"{"synthetic":true}"#.to_vec();
        let md5 = format!("{:x}", Md5::digest(&body));
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let remote = origin.clone();
        let expected_body = body.clone();
        let worker = std::thread::spawn(move || {
            let replies=vec![
                json!({"errno":0,"path":"/apps/Test/QuoDex","isdir":1}).to_string(),
                json!({"errno":0,"uploadid":"synthetic-upload","block_list":[]}).to_string(),
                json!({"error_code":0,"servers":[{"server":remote}]}).to_string(),
                json!({"md5":md5}).to_string(),
                json!({"errno":0,"path":"/apps/Test/QuoDex/batch.json","size":expected_body.len(),"fs_id":123u64}).to_string(),
                json!({"errno":0,"data":{"list":[{"fs_id":123u64,"path":"/apps/Test/QuoDex/batch.json","server_filename":"batch.json","isdir":0,"size":expected_body.len()}]}}).to_string(),
                json!({"errno":0,"list":[{"fs_id":123u64,"isdir":0,"dlink":format!("{remote}/download")}]}).to_string(),
                String::from_utf8(expected_body.clone()).unwrap(),
            ];
            for (step, reply) in replies.into_iter().enumerate() {
                let (mut s, _) = listener.accept().unwrap();
                s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut request = Vec::new();
                let mut buffer = [0; 4096];
                loop {
                    let n = s.read(&mut buffer).unwrap();
                    assert!(n > 0);
                    request.extend_from_slice(&buffer[..n]);
                    if let Some(pos) = request.windows(4).position(|x| x == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&request[..pos]);
                        let length = head
                            .lines()
                            .filter_map(|l| l.split_once(':'))
                            .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                            .map(|(_, v)| v.trim().parse::<usize>().unwrap())
                            .unwrap_or(0);
                        if request.len() >= pos + 4 + length {
                            break;
                        }
                    }
                }
                let text = String::from_utf8_lossy(&request);
                assert!(text.contains("access_token=synthetic-access"));
                if step == 1 {
                    assert!(text.contains("rtype=0"));
                    assert!(text.contains("block_list="));
                }
                if step == 2 {
                    assert!(text.contains("appid=250528"));
                    assert!(text.contains("uploadid=synthetic-upload"));
                }
                if step == 3 {
                    assert!(text.contains("/rest/2.0/pcs/superfile2"));
                    assert!(text.contains("name=\"file\""));
                    assert!(text.contains("partseq=0"));
                }
                if step == 4 {
                    assert!(text.contains("rtype=0"));
                }
                write!(
                    s,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    reply.len(),
                    reply
                )
                .unwrap();
            }
        });
        let mut store = BaiduStore {
            client: client().unwrap(),
            access: "synthetic-access".into(),
            root: "/apps/Test/QuoDex".into(),
            files: BTreeMap::new(),
            test_origin: Some(origin),
        };
        store.mkdir().unwrap();
        store.create("batch.json", &body).unwrap();
        assert_eq!(store.read("batch.json").unwrap(), body);
        worker.join().unwrap();
    }
}

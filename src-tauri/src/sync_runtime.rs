//! One worker serializes authorization, single-use token rotation, and scheduled sync.
use crate::{
    baidu_sync::{self, Authorization, Credentials, DeviceCode},
    capacity::Diagnostic,
    sync_engine::{self, Device},
    usage_service::{UsageService, UsageSourceSnapshot},
    usage_sync::{self, error},
};
use serde::Serialize;
use std::{
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, RwLock,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncView {
    pub state: String,
    pub last_success_at_ms: Option<i64>,
    pub pending: u64,
    pub devices: Vec<Device>,
    pub conflicts: u64,
    pub incomplete: u64,
    pub unidentified: u64,
    pub pending_downloads: u64,
    pub diagnostic: Option<Diagnostic>,
    pub user_code: Option<String>,
    pub authorization_url: Option<String>,
    pub authorization_expires_at_ms: Option<i64>,
    pub app_key: String,
    pub folder: String,
}
impl Default for SyncView {
    fn default() -> Self {
        Self {
            state: "disconnected".into(),
            last_success_at_ms: None,
            pending: 0,
            devices: Vec::new(),
            conflicts: 0,
            incomplete: 0,
            unidentified: 0,
            pending_downloads: 0,
            diagnostic: None,
            user_code: None,
            authorization_url: None,
            authorization_expires_at_ms: None,
            app_key: String::new(),
            folder: String::new(),
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AllDevices {
    pub codex: UsageSourceSnapshot,
    pub zcode: UsageSourceSnapshot,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(flatten)]
    pub local: crate::usage_service::UsageSnapshot,
    pub all_devices: AllDevices,
    pub sync: SyncView,
}
enum Command {
    Connect(Credentials),
    Sync,
    Disconnect,
}
pub struct SyncRuntime {
    pub service: Arc<UsageService>,
    view: RwLock<SyncView>,
    last_totals: RwLock<usage_sync::Totals>,
    sender: mpsc::Sender<Command>,
    generation: AtomicU64,
}
fn vault_error() -> Diagnostic {
    error(
        "QDS-111",
        "无法安全保存网盘凭据；请检查系统凭据库后重新授权",
    )
}
fn save(entry: &keyring::Entry, c: &Credentials) -> Result<(), Diagnostic> {
    entry
        .set_password(&serde_json::to_string(c).map_err(|_| vault_error())?)
        .map_err(|_| vault_error())
}
fn rotate(
    c: &mut Credentials,
    mut persist: impl FnMut(&Credentials) -> Result<(), Diagnostic>,
    fetch: impl FnOnce(&Credentials) -> Result<baidu_sync::Token, Diagnostic>,
) -> Result<(), Diagnostic> {
    c.refresh_in_flight = true;
    persist(c)?;
    c.token = Some(fetch(c)?);
    c.refresh_in_flight = false;
    persist(c)
}
impl SyncRuntime {
    pub fn start(service: Arc<UsageService>, config: &Path) -> Arc<Self> {
        let (sender, receiver) = mpsc::channel();
        let last = service
            .with_ledger(|d| d.meta_get("sync.last_success"))
            .ok()
            .flatten()
            .and_then(|s| s.parse().ok());
        let devices = service
            .with_ledger(|d| d.meta_get("sync.devices"))
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let runtime = Arc::new(Self {
            service,
            view: RwLock::new(SyncView {
                last_success_at_ms: last,
                devices,
                ..Default::default()
            }),
            sender,
            generation: AtomicU64::new(0),
            last_totals: RwLock::new(usage_sync::Totals::default()),
        });
        let handle = runtime.clone();
        let account = usage_sync::digest(&config.to_string_lossy().to_string());
        std::thread::Builder::new()
            .name("quodex-sync".into())
            .spawn(move || handle.worker(receiver, &account))
            .expect("sync worker");
        runtime
    }
    pub fn view(&self) -> SyncView {
        self.ledger_view().0
    }
    fn ledger_view(&self) -> (SyncView, usage_sync::Totals) {
        let mut v = self.view.read().expect("sync view").clone();
        let totals = match self.service.with_ledger(|d| {
            let space = d.meta_get("sync.space")?.unwrap_or_default();
            Ok((d.sync_pending(&space)?, d.sync_totals()?))
        }) {
            Ok((pending, t)) => {
                v.pending = pending;
                v.conflicts = t.conflicts;
                v.incomplete = t.incomplete;
                v.unidentified = t.unidentified;
                *self.last_totals.write().expect("sync totals") = t.clone();
                t
            }
            Err(e) => {
                v.diagnostic = Some(e);
                v.state = "failed".into();
                self.last_totals.read().expect("sync totals").clone()
            }
        };
        (v, totals)
    }
    pub fn snapshot(&self) -> Snapshot {
        let (mut view, totals) = self.ledger_view();
        view.user_code = None;
        view.authorization_url = None;
        view.authorization_expires_at_ms = None;
        view.app_key.clear();
        view.folder.clear();
        let local = self.service.snapshot();
        let source = |daily: std::collections::BTreeMap<String, i64>,
                      request_count,
                      part: &UsageSourceSnapshot| UsageSourceSnapshot {
            state: if view.diagnostic.is_some() {
                "failed"
            } else {
                part.state
            },
            last_success_at_ms: part.last_success_at_ms.max(view.last_success_at_ms),
            earliest_day: daily.keys().next().cloned(),
            collection_start_day: None,
            request_count,
            daily,
            progress: part.progress.clone(),
            diagnostic: part.diagnostic.clone(),
        };
        let all_devices = AllDevices {
            codex: source(totals.codex, totals.codex_count, &local.codex),
            zcode: source(totals.zcode, totals.zcode_count, &local.zcode),
        };
        Snapshot {
            local,
            all_devices,
            sync: view,
        }
    }
    pub fn connect(
        &self,
        app_key: String,
        secret_key: String,
        folder: String,
    ) -> Result<(), Diagnostic> {
        let c = Credentials {
            app_key: app_key.trim().into(),
            secret_key: secret_key.trim().into(),
            folder: folder.trim().into(),
            token: None,
            refresh_in_flight: false,
        };
        baidu_sync::validate(&c)?;
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.sender
            .send(Command::Connect(c))
            .map_err(|_| error("QDS-109", "同步工作线程未运行；请重启 QuoDex"))
    }
    pub fn synchronize(&self) -> Result<(), Diagnostic> {
        let view = self.view.read().expect("sync view");
        if matches!(
            view.state.as_str(),
            "disconnected" | "reauthorize" | "authorizing"
        ) || view
            .diagnostic
            .as_ref()
            .is_some_and(|e| matches!(e.code, "QDS-107" | "QDS-110" | "QDS-112"))
        {
            return Err(view
                .diagnostic
                .clone()
                .unwrap_or_else(|| error("QDS-101", "请先在同步设置中完成百度网盘授权")));
        }
        self.sender
            .send(Command::Sync)
            .map_err(|_| error("QDS-109", "同步工作线程未运行；请重启 QuoDex"))
    }
    pub fn disconnect(&self) -> Result<(), Diagnostic> {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.sender
            .send(Command::Disconnect)
            .map_err(|_| error("QDS-109", "同步工作线程未运行；请重启 QuoDex"))
    }
    fn state(&self, state: &str, diagnostic: Option<Diagnostic>) {
        let mut v = self.view.write().expect("sync view");
        v.state = state.into();
        v.diagnostic = diagnostic;
    }
    fn clear_code(&self) {
        let mut v = self.view.write().expect("sync view");
        v.user_code = None;
        v.authorization_url = None;
        v.authorization_expires_at_ms = None;
    }
    fn worker(&self, receiver: mpsc::Receiver<Command>, account: &str) {
        let entry = match keyring::Entry::new("QuoDex.BaiduLedger", account) {
            Ok(e) => e,
            Err(_) => {
                self.state("failed", Some(vault_error()));
                return;
            }
        };
        let mut active = None;
        if self
            .service
            .with_ledger(|d| d.meta_get("sync.enabled"))
            .ok()
            .flatten()
            .as_deref()
            == Some("1")
        {
            match entry
                .get_password()
                .ok()
                .and_then(|s| serde_json::from_str::<Credentials>(&s).ok())
            {
                Some(c) if c.token.is_some() && !c.refresh_in_flight => {
                    let mut v = self.view.write().expect("sync view");
                    v.app_key = c.app_key.clone();
                    v.folder = c.folder.clone();
                    v.state = "syncing".into();
                    active = Some(c);
                }
                _ => self.state(
                    "reauthorize",
                    Some(error(
                        "QDS-101",
                        "授权凭据不可用或上次刷新中断；请重新授权百度网盘",
                    )),
                ),
            }
        }
        let mut authorization: Option<(Credentials, DeviceCode)> = None;
        let mut next = Instant::now();
        let mut backoff = 60u64;
        loop {
            let timeout = if active.is_some() || authorization.is_some() {
                next.saturating_duration_since(Instant::now())
            } else {
                Duration::from_secs(3600)
            };
            match receiver.recv_timeout(timeout) {
                Ok(Command::Disconnect) => {
                    active = None;
                    authorization = None;
                    self.clear_code();
                    let saved = self
                        .service
                        .with_ledger(|d| d.meta_set("sync.enabled", "0"));
                    let deleted = match entry.delete_credential() {
                        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                        Err(_) => Err(vault_error()),
                    };
                    match saved.and(deleted) {
                        Ok(()) => self.state("disconnected", None),
                        Err(e) => self.state("failed", Some(e)),
                    };
                    continue;
                }
                Ok(Command::Connect(c)) => {
                    active = None;
                    authorization = None;
                    self.clear_code();
                    self.state("authorizing", None);
                    if let Err(e) = self
                        .service
                        .with_ledger(|d| d.meta_set("sync.enabled", "0"))
                    {
                        self.state("failed", Some(e));
                        continue;
                    }
                    match baidu_sync::device_code(&c) {
                        Ok(code) => {
                            let mut v = self.view.write().expect("sync view");
                            v.user_code = Some(code.user_code.clone());
                            v.authorization_url = Some(code.url.clone());
                            v.authorization_expires_at_ms = Some(code.expires_at);
                            v.app_key = c.app_key.clone();
                            v.folder = c.folder.clone();
                            next = Instant::now() + Duration::from_secs(code.interval);
                            authorization = Some((c, code));
                        }
                        Err(e) => self.state("failed", Some(e)),
                    }
                    continue;
                }
                Ok(Command::Sync) => {
                    if authorization.is_some() {
                        continue;
                    }
                    next = Instant::now();
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if let Some((mut c, mut code)) = authorization.take() {
                if crate::usage_ledger::now_ms() >= code.expires_at {
                    self.clear_code();
                    self.state(
                        "reauthorize",
                        Some(error("QDS-101", "设备码已过期；请重新连接")),
                    );
                    continue;
                }
                match baidu_sync::poll(&c, &code.code) {
                    Ok(Authorization::Pending) => {
                        next = Instant::now() + Duration::from_secs(code.interval);
                        authorization = Some((c, code));
                    }
                    Ok(Authorization::Slow) => {
                        code.interval = (code.interval + 6).min(300);
                        next = Instant::now() + Duration::from_secs(code.interval);
                        authorization = Some((c, code));
                    }
                    Ok(Authorization::Ready(token)) => {
                        c.token = Some(token);
                        self.clear_code();
                        match save(&entry, &c).and_then(|_| {
                            self.service
                                .with_ledger(|d| d.meta_set("sync.enabled", "1"))
                        }) {
                            Ok(()) => {
                                active = Some(c);
                                next = Instant::now();
                            }
                            Err(e) => self.state("failed", Some(e)),
                        }
                    }
                    Err(e) => {
                        self.clear_code();
                        self.state("reauthorize", Some(e));
                    }
                }
                continue;
            }
            let Some(c) = active.as_mut() else {
                continue;
            };
            if Instant::now() < next {
                continue;
            }
            self.state("syncing", None);
            let generation = self.generation.load(Ordering::SeqCst);
            if c.token
                .as_ref()
                .is_some_and(|t| t.expires_at <= crate::usage_ledger::now_ms() + 5 * 60 * 1000)
            {
                // Persist intent BEFORE spending a single-use refresh token. An ambiguous result requires reauthorization.
                let rotated = rotate(c, |c| save(&entry, c), baidu_sync::refresh);
                if rotated.is_err() {
                    active = None;
                    self.state(
                        "reauthorize",
                        Some(error(
                            "QDS-101",
                            "授权刷新未安全完成；为避免重复使用凭据，请重新授权",
                        )),
                    );
                    continue;
                }
            }
            let result = baidu_sync::BaiduStore::new(c).and_then(|mut store| {
                sync_engine::synchronize_until(&self.service, &mut store, || {
                    self.generation.load(Ordering::SeqCst) != generation
                })
            });
            if self.generation.load(Ordering::SeqCst) != generation {
                continue;
            }
            match result {
                Ok(outcome) => {
                    let now = crate::usage_ledger::now_ms();
                    if let Err(e) = self.service.with_ledger(|d| {
                        d.meta_set(
                            "sync.devices",
                            &serde_json::to_string(&outcome.devices).expect("devices"),
                        )?;
                        d.meta_set("sync.last_success", &now.to_string())
                    }) {
                        self.state("failed", Some(e));
                    } else {
                        let mut v = self.view.write().expect("sync view");
                        v.state = if outcome.pending > 0 || outcome.pending_downloads > 0 {
                            "catching-up"
                        } else {
                            "ready"
                        }
                        .into();
                        v.last_success_at_ms = Some(now);
                        v.pending = outcome.pending;
                        v.pending_downloads = outcome.pending_downloads;
                        v.devices = outcome.devices;
                        v.diagnostic = None;
                    }
                    backoff = 60;
                }
                Err(e) => {
                    let pause = matches!(e.code, "QDS-101" | "QDS-107" | "QDS-110" | "QDS-112");
                    let state = if e.code == "QDS-101" {
                        "reauthorize"
                    } else {
                        "failed"
                    };
                    self.state(state, Some(e));
                    if pause {
                        active = None;
                    }
                    backoff = (backoff * 2).min(900);
                }
            }
            next = Instant::now() + Duration::from_secs(backoff);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ledger_read_failure_preserves_last_displayed_total() {
        let home = std::env::temp_dir().join(format!("quodex-sync-view-{}", uuid::Uuid::new_v4()));
        let service = Arc::new(UsageService::new(home.clone(), home.join("ledger.sqlite")));
        service
            .with_ledger(|d| {
                d.upsert_codex(&crate::usage_ledger::UsageEvent {
                    source: "codex",
                    request_key: "codex:t:r".into(),
                    source_ts_ms: 1791307800000,
                    total_tokens: 100,
                    input_tokens: 100,
                    output_tokens: 0,
                    cached_input_tokens: 0,
                    reasoning_tokens: 0,
                })
            })
            .unwrap();
        let (sender, _receiver) = mpsc::channel();
        let runtime = SyncRuntime {
            service: service.clone(),
            view: RwLock::new(SyncView::default()),
            last_totals: RwLock::new(Default::default()),
            sender,
            generation: AtomicU64::new(0),
        };
        assert_eq!(
            runtime
                .snapshot()
                .all_devices
                .codex
                .daily
                .values()
                .sum::<i64>(),
            100
        );
        service
            .with_ledger(|d| {
                d.conn.execute("DROP TABLE sync_observations", []).unwrap();
                Ok(())
            })
            .unwrap();
        let failed = runtime.snapshot();
        assert_eq!(failed.all_devices.codex.daily.values().sum::<i64>(), 100);
        assert_eq!(failed.sync.state, "failed");
        assert_eq!(failed.sync.diagnostic.unwrap().code, "QDS-109");
        drop(runtime);
        drop(service);
        std::fs::remove_dir_all(home).unwrap();
    }
    fn credentials() -> Credentials {
        Credentials {
            app_key: "fixture-app".into(),
            secret_key: "fixture-secret".into(),
            folder: "Fixture".into(),
            token: Some(baidu_sync::Token {
                access: "old-access".into(),
                refresh: "single-use".into(),
                expires_at: 1,
            }),
            refresh_in_flight: false,
        }
    }
    #[test]
    fn lost_rotation_response_leaves_durable_intent_and_is_not_retried() {
        let mut c = credentials();
        let durable = std::cell::RefCell::new(None);
        let requests = std::cell::Cell::new(0);
        let result = rotate(
            &mut c,
            |value| {
                *durable.borrow_mut() = Some(value.clone());
                Ok(())
            },
            |_| {
                assert!(durable.borrow().as_ref().unwrap().refresh_in_flight);
                requests.set(requests.get() + 1);
                Err(error("QDS-103", "response lost"))
            },
        );
        assert!(result.is_err());
        assert_eq!(requests.get(), 1);
        assert!(durable.borrow().as_ref().unwrap().refresh_in_flight);
    }
    #[test]
    fn failed_intent_persistence_never_spends_refresh_token() {
        let mut c = credentials();
        let result = rotate(
            &mut c,
            |_| Err(vault_error()),
            |_| panic!("must not request token"),
        );
        assert!(result.is_err());
    }
    #[test]
    fn successful_rotation_replaces_both_tokens_in_one_saved_value() {
        let mut c = credentials();
        let saved = std::cell::RefCell::new(Vec::new());
        rotate(
            &mut c,
            |v| {
                saved.borrow_mut().push(v.clone());
                Ok(())
            },
            |_| {
                Ok(baidu_sync::Token {
                    access: "new-access".into(),
                    refresh: "new-refresh".into(),
                    expires_at: 2,
                })
            },
        )
        .unwrap();
        let values = saved.borrow();
        assert_eq!(values.len(), 2);
        assert!(values[0].refresh_in_flight);
        assert!(!values[1].refresh_in_flight);
        assert_eq!(values[1].token.as_ref().unwrap().refresh, "new-refresh");
    }
    #[cfg(target_os = "windows")]
    #[test]
    fn windows_credential_store_round_trip_uses_an_isolated_synthetic_entry() {
        struct Cleanup(keyring::Entry);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = self.0.delete_credential();
            }
        }
        let entry = Cleanup(
            keyring::Entry::new("QuoDex.BaiduLedger.QA", &uuid::Uuid::new_v4().to_string())
                .unwrap(),
        );
        let mut c = credentials();
        save(&entry.0, &c).unwrap();
        c.refresh_in_flight = true;
        save(&entry.0, &c).unwrap();
        let loaded: Credentials = serde_json::from_str(&entry.0.get_password().unwrap()).unwrap();
        assert!(loaded.refresh_in_flight);
        assert_eq!(loaded.secret_key, "fixture-secret");
    }
}

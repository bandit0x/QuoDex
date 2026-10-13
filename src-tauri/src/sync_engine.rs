//! Immutable remote objects, with the local SQLite outbox as the retry boundary.
use crate::{
    capacity::Diagnostic,
    usage_service::UsageService,
    usage_sync::{error, Batch},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub struct Object {
    pub name: String,
    pub modified_ms: i64,
}
pub trait Store {
    fn list(&mut self) -> Result<Vec<Object>, Diagnostic>;
    fn read(&mut self, name: &str) -> Result<Vec<u8>, Diagnostic>;
    /// Must fail on an existing name. The caller verifies ambiguous outcomes by reading.
    fn create(&mut self, name: &str, bytes: &[u8]) -> Result<(), Diagnostic>;
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema: u32,
    min_reader: u32,
    min_writer: u32,
    space: String,
}
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub uploaded_at_ms: i64,
}
#[derive(Default)]
pub struct Outcome {
    pub devices: Vec<Device>,
    pub pending: u64,
    pub pending_downloads: u64,
}

#[cfg(test)]
pub fn synchronize(service: &UsageService, store: &mut impl Store) -> Result<Outcome, Diagnostic> {
    synchronize_until(service, store, || false)
}
pub fn synchronize_until(
    service: &UsageService,
    store: &mut impl Store,
    cancelled: impl Fn() -> bool,
) -> Result<Outcome, Diagnostic> {
    let check = || {
        if cancelled() {
            Err(error("QDS-114", "同步已取消；本机账目仍然保留"))
        } else {
            Ok(())
        }
    };
    check()?;
    const MANIFEST: &str = "space-v1.json";
    let mut objects = store.list()?;
    if !objects.iter().any(|o| o.name == MANIFEST) {
        let candidate = Manifest {
            schema: 1,
            min_reader: 1,
            min_writer: 1,
            space: uuid::Uuid::new_v4().to_string(),
        };
        let body = serde_json::to_vec(&candidate).expect("manifest");
        // A concurrent creator or lost response is resolved by reading the canonical name.
        if let Err(upload_error) = store.create(MANIFEST, &body) {
            if store.read(MANIFEST).is_err() {
                return Err(upload_error);
            }
        }
        objects = store.list()?;
    }
    let raw = store.read(MANIFEST)?;
    let value: serde_json::Value = serde_json::from_slice(&raw)
        .map_err(|_| error("QDS-105", "账本入口文件损坏；请检查同步目录"))?;
    if value["schema"] != 1 || value["minReader"] != 1 || value["minWriter"] != 1 {
        return Err(error(
            "QDS-110",
            "账本协议不兼容；本机继续记账，请升级 QuoDex",
        ));
    }
    let manifest: Manifest =
        serde_json::from_value(value).map_err(|_| error("QDS-105", "账本入口字段不正确"))?;
    if uuid::Uuid::parse_str(&manifest.space).is_err() {
        return Err(error("QDS-105", "账本空间标识不正确"));
    }
    service.with_ledger(|db| {
        if db
            .meta_get("sync.space")?
            .is_some_and(|s| s != manifest.space)
        {
            return Err(error(
                "QDS-107",
                "这个网盘目录属于另一份账本；请连接原来的应用目录",
            ));
        }
        db.meta_set("sync.space", &manifest.space)
    })?;
    let mut devices = std::collections::BTreeMap::<String, i64>::new();
    // Limit each cycle; the inbox makes later cycles continue without duplicate counts.
    let mut imported = 0;
    let mut pending_downloads = 0;
    for object in objects {
        check()?;
        if object.name == MANIFEST {
            continue;
        }
        let Some((observer, id)) = object
            .name
            .strip_suffix(".json")
            .and_then(|s| s.split_once('_'))
        else {
            continue;
        };
        if uuid::Uuid::parse_str(observer).is_err() || uuid::Uuid::parse_str(id).is_err() {
            continue;
        }
        if !service.with_ledger(|db| db.sync_has_batch(&manifest.space, id))? {
            if imported == 100 {
                pending_downloads += 1;
                continue;
            }
            let batch = Batch::decode(&store.read(&object.name)?)?;
            if batch.id != id || batch.observations.iter().any(|o| o.observer != observer) {
                return Err(error(
                    "QDS-105",
                    "同步文件身份与文件名不一致；已停止本轮同步",
                ));
            }
            service.with_ledger(|db| db.sync_import(&manifest.space, &batch))?;
            imported += 1;
        }
        devices
            .entry(observer.into())
            .and_modify(|t| *t = (*t).max(object.modified_ms))
            .or_insert(object.modified_ms);
    }
    let observer = service
        .with_ledger(|db| db.meta_get("sync.observer"))?
        .expect("initialized observer");
    for _ in 0..16 {
        check()?;
        let Some(batch) = service.with_ledger(|db| db.sync_batch(&manifest.space))? else {
            break;
        };
        let name = format!("{observer}_{}.json", batch.id);
        let body = batch.encode()?;
        if let Err(upload_error) = store.create(&name, &body) {
            match store.read(&name) {
                Ok(existing) if existing == body => {}
                Ok(_) => {
                    return Err(error(
                        "QDS-105",
                        "远端已有同名但内容不同的批次；请保留文件并检查账本",
                    ))
                }
                Err(_) => return Err(upload_error),
            }
        }
        service.with_ledger(|db| {
            db.sync_import(&manifest.space, &batch)?;
            db.sync_ack(&manifest.space, &batch.id)
        })?;
        devices.insert(observer.clone(), crate::usage_ledger::now_ms());
    }
    let pending = service.with_ledger(|db| db.sync_pending(&manifest.space))?;
    Ok(Outcome {
        devices: devices
            .into_iter()
            .map(|(id, uploaded_at_ms)| Device { id, uploaded_at_ms })
            .collect(),
        pending,
        pending_downloads,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usage_ledger::UsageEvent;
    #[derive(Default)]
    struct Memory {
        files: std::collections::BTreeMap<String, Vec<u8>>,
        lose_response: bool,
    }
    impl Store for Memory {
        fn list(&mut self) -> Result<Vec<Object>, Diagnostic> {
            Ok(self
                .files
                .keys()
                .map(|n| Object {
                    name: n.clone(),
                    modified_ms: 10,
                })
                .collect())
        }
        fn read(&mut self, n: &str) -> Result<Vec<u8>, Diagnostic> {
            self.files
                .get(n)
                .cloned()
                .ok_or_else(|| error("QDS-103", "missing"))
        }
        fn create(&mut self, n: &str, b: &[u8]) -> Result<(), Diagnostic> {
            if self.files.contains_key(n) {
                return Err(error("QDS-103", "exists"));
            }
            self.files.insert(n.into(), b.into());
            if self.lose_response {
                return Err(error("QDS-103", "response lost"));
            }
            Ok(())
        }
    }
    fn device() -> (UsageService, std::path::PathBuf) {
        let home = std::env::temp_dir().join(format!("quodex-engine-{}", uuid::Uuid::new_v4()));
        (
            UsageService::new(home.clone(), home.join("ledger.sqlite")),
            home,
        )
    }
    fn add(s: &UsageService, id: &str, t: i64) {
        s.with_ledger(|db| {
            db.upsert_codex(&UsageEvent {
                source: "codex",
                request_key: format!("codex:t:{id}"),
                source_ts_ms: 1791307800000,
                total_tokens: t,
                input_tokens: t,
                output_tokens: 0,
                cached_input_tokens: 0,
                reasoning_tokens: 0,
            })
        })
        .unwrap();
    }
    #[test]
    fn two_offline_devices_converge_after_lost_upload_response_and_restart() {
        let (a, pa) = device();
        let (b, pb) = device();
        let mut store = Memory::default();
        add(&a, "shared", 30);
        add(&b, "shared", 30);
        add(&a, "a", 100);
        add(&b, "b", 200);
        store.lose_response = true;
        synchronize(&a, &mut store).unwrap();
        store.lose_response = false;
        synchronize(&b, &mut store).unwrap();
        drop(a);
        let a = UsageService::new(pa.clone(), pa.join("ledger.sqlite"));
        synchronize(&a, &mut store).unwrap();
        synchronize(&b, &mut store).unwrap();
        for s in [&a, &b] {
            assert_eq!(
                s.with_ledger(|d| d.sync_totals())
                    .unwrap()
                    .codex
                    .values()
                    .sum::<i64>(),
                330
            );
        }
        assert_eq!(store.files.len(), 3);
        drop(a);
        drop(b);
        std::fs::remove_dir_all(pa).unwrap();
        std::fs::remove_dir_all(pb).unwrap();
    }
    #[test]
    fn future_manifest_and_other_space_cannot_pollute_local_ledger() {
        let (a, p) = device();
        add(&a, "a", 10);
        let mut store = Memory::default();
        synchronize(&a, &mut store).unwrap();
        let mut m: serde_json::Value =
            serde_json::from_slice(&store.files["space-v1.json"]).unwrap();
        m["schema"] = 2.into();
        store
            .files
            .insert("space-v1.json".into(), serde_json::to_vec(&m).unwrap());
        assert_eq!(synchronize(&a, &mut store).err().unwrap().code, "QDS-110");
        m["schema"] = 1.into();
        m["space"] = uuid::Uuid::new_v4().to_string().into();
        store
            .files
            .insert("space-v1.json".into(), serde_json::to_vec(&m).unwrap());
        assert_eq!(synchronize(&a, &mut store).err().unwrap().code, "QDS-107");
        drop(a);
        std::fs::remove_dir_all(p).unwrap();
    }
}

//! Explicit live-account QA. Opt-in only; reports never contain credentials or cloud URLs.
use crate::{
    baidu_sync::{BaiduStore, Credentials},
    capacity::Diagnostic,
    sync_engine::{self, Store},
    usage_service::UsageService,
    usage_sync::{self, error, Batch},
};
use serde_json::json;
use std::path::{Path, PathBuf};

fn probe(config: &Path, checks: &mut Vec<&'static str>) -> Result<(), Diagnostic> {
    let service = UsageService::new(PathBuf::new(), config.join("usage-ledger.sqlite"));
    let enabled = service.with_ledger(|db| db.meta_get("sync.enabled"))?;
    if enabled.as_deref() != Some("1") {
        return Err(error("QDS-101", "本机同步尚未启用"));
    }
    let account = usage_sync::digest(&config.to_string_lossy().to_string());
    let entry = keyring::Entry::new("QuoDex.BaiduLedger", &account)
        .map_err(|_| error("QDS-111", "无法打开本机凭据条目"))?;
    let secret = entry
        .get_password()
        .map_err(|_| error("QDS-111", "无法读取已授权凭据"))?;
    let credentials: Credentials =
        serde_json::from_str(&secret).map_err(|_| error("QDS-111", "凭据格式不兼容"))?;
    drop(secret);
    if credentials.refresh_in_flight
        || credentials
            .token
            .as_ref()
            .is_none_or(|t| t.expires_at <= crate::usage_ledger::now_ms() + 5 * 60 * 1000)
    {
        return Err(error(
            "QDS-101",
            "凭据临近过期或刷新未完成；请通过 QuoDex 重新授权",
        ));
    }
    checks.push("existing_authorization_loaded_without_logging_secrets");

    let local_before =
        service.with_ledger(|db| Ok((db.request_count("codex")?, db.request_count("zcode")?)))?;
    let mut store = BaiduStore::new(&credentials)?;
    let objects = store.list()?;
    checks.push("official_application_directory_listed");
    if !objects.iter().any(|o| o.name == "space-v1.json") {
        return Err(error("QDS-105", "远端未找到已连接账本入口"));
    }
    let manifest: serde_json::Value = serde_json::from_slice(&store.read("space-v1.json")?)
        .map_err(|_| error("QDS-105", "远端账本入口无法解析"))?;
    if manifest["schema"] != 1 {
        return Err(error("QDS-110", "远端协议不兼容"));
    }
    checks.push("remote_manifest_downloaded_and_validated");

    let marker = uuid::Uuid::new_v4().to_string();
    let name = format!("qa-{marker}.json");
    let body =
        serde_json::to_vec(&json!({"quodexProbe":1,"nonce":marker})).expect("synthetic probe");
    // The qa- name cannot match observer_batch naming and never enters token totals.
    store.create(&name, &body)?;
    checks.push("anonymous_probe_uploaded_with_non_overwrite_create");
    if store.read(&name)? != body {
        return Err(error("QDS-105", "实网测试文件内容与原始数据不同"));
    }
    checks.push("probe_download_is_byte_identical");

    let first = sync_engine::synchronize(&service, &mut store)?;
    let totals_before = service.with_ledger(|db| db.sync_totals())?;
    let second = sync_engine::synchronize(&service, &mut store)?;
    let totals_after = service.with_ledger(|db| db.sync_totals())?;
    if first.pending != 0
        || first.pending_downloads != 0
        || second.pending != 0
        || second.pending_downloads != 0
    {
        return Err(error(
            "QDS-108",
            "本轮有限同步后仍有待处理历史；需要继续同步",
        ));
    }
    if usage_sync::digest(&totals_before) != usage_sync::digest(&totals_after) {
        return Err(error("QDS-105", "重复同步改变了汇总结果"));
    }
    checks.push("two_live_sync_cycles_finish_without_duplicate_totals");
    let local_after =
        service.with_ledger(|db| Ok((db.request_count("codex")?, db.request_count("zcode")?)))?;
    if local_before != local_after {
        return Err(error("QDS-109", "同步期间本机原始账目数量改变"));
    }
    checks.push("local_original_rows_retained");

    if let Some(object) = store.list()?.into_iter().find(|o| {
        o.name
            .strip_suffix(".json")
            .and_then(|n| n.split_once('_'))
            .is_some_and(|(writer, id)| {
                uuid::Uuid::parse_str(writer).is_ok() && uuid::Uuid::parse_str(id).is_ok()
            })
    }) {
        let batch = Batch::decode(&store.read(&object.name)?)?;
        let before = service.with_ledger(|db| db.sync_totals())?;
        service.with_ledger(|db| db.sync_import(&batch.space, &batch))?;
        service.with_ledger(|db| db.sync_import(&batch.space, &batch))?;
        let after = service.with_ledger(|db| db.sync_totals())?;
        if usage_sync::digest(&before) != usage_sync::digest(&after) {
            return Err(error("QDS-105", "实网批次重复导入改变了合计"));
        }
        checks.push("real_remote_batch_replayed_twice_without_recount");
    } else {
        return Err(error("QDS-105", "实网目录没有可验证的账本批次"));
    }
    Ok(())
}

#[test]
#[ignore = "requires explicit live-account config and report paths; writes one anonymous QA object"]
fn live_baidu_sync_round_trip() {
    let config =
        PathBuf::from(std::env::var_os("QUODEX_LIVE_CONFIG").expect("explicit config required"));
    let report =
        PathBuf::from(std::env::var_os("QUODEX_LIVE_REPORT").expect("explicit report required"));
    assert!(config.join("usage-ledger.sqlite").is_file());
    let mut checks = Vec::new();
    let result = probe(&config, &mut checks);
    let output = json!({
        "status":if result.is_ok(){"Verified"}else{"Blocked"},
        "date":chrono::Utc::now().to_rfc3339(),
        "sourceBase":std::env::var("QUODEX_LIVE_SOURCE").unwrap_or_default(),
        "scope":"existing QuoDex app subdirectory only; no photos or unrelated directories",
        "checks":checks,
        "diagnostic":result.as_ref().err(),
        "sideEffect":"one small qa-UUID.json synthetic marker retained inside QuoDex directory; no deletion",
        "limitations":"single Windows PC; no token rotation, six-hour wait or second physical PC verified"
    });
    std::fs::create_dir_all(report.parent().expect("report parent")).expect("report directory");
    std::fs::write(
        report,
        serde_json::to_vec_pretty(&output).expect("report json"),
    )
    .expect("write report");
    if let Err(e) = result {
        panic!("{}: {}", e.code, e.message);
    }
}

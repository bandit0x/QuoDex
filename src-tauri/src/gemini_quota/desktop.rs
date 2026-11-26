//! Safe, low-frequency Antigravity quota orchestrator.
//!
//! Priority order (inspired by `yuhuan-dev/antigravity-usage-monitor` and `steipete/CodexBar`):
//! 1. Zero-network local snapshot from official `agy` `/statusline` hook.
//! 2. Official unmodified `agy -p /usage --output-format json` CLI (when installed).
//! 3. Fallback to local Desktop runtime (reusing an active hub discovery session when available,
//!    or a de-noised fixed-directory local service without forced cache bypass).
//!
//! Hard cooldown gates prevent high-frequency hammering against Google backends.
use super::{agy_cli, desktop_runtime, Pool, Window};
use crate::capacity::Diagnostic;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

/// Minimum interval between automatic remote reads (5 minutes).
const AUTO_COOLDOWN: Duration = Duration::from_secs(5 * 60);
/// Minimum debounce between manual refresh clicks (30 seconds).
const MANUAL_COOLDOWN: Duration = Duration::from_secs(30);

struct CachedRead {
    at: Instant,
    pools: [Pool; 2],
    from_network: bool,
}

static LAST_READ: Mutex<Option<CachedRead>> = Mutex::new(None);

pub(super) fn read(manual: bool) -> [Pool; 2] {
    let salt = match account_salt() {
        Ok(salt) => salt,
        Err(diag) => return failure(diag),
    };
    let now_ms = chrono::Utc::now().timestamp_millis();

    // Layer 1 (Zero network): Official `agy` /statusline local snapshot.
    // Even on manual refresh, reuse a statusline snapshot written in the last 30 seconds.
    if let Some(statusline) = agy_cli::read_statusline(&salt, now_ms) {
        let fresh_for_manual = statusline[0]
            .observed_at_ms
            .is_some_and(|at| now_ms.saturating_sub(at) < 30_000);
        if !manual || fresh_for_manual {
            if let Ok(mut last) = LAST_READ.lock() {
                *last = Some(CachedRead {
                    at: Instant::now(),
                    pools: statusline.clone(),
                    from_network: false,
                });
            }
            return statusline;
        }
    }

    let Ok(mut last) = LAST_READ.lock() else {
        return failure(Diagnostic::new("QGM-251", "AG 采样状态异常，请重启 QuoDex"));
    };
    if let Some(cached) = &*last {
        if cached.from_network {
            let cooldown = if manual { MANUAL_COOLDOWN } else { AUTO_COOLDOWN };
            if cached.at.elapsed() < cooldown {
                return cached.pools.clone();
            }
        }
    }

    // Layer 2 (Official personal CLI): `agy -p /usage --output-format json`.
    let pools = match agy_cli::read_cli(&salt) {
        Ok(Some(cli_pools)) => cli_pools,
        Err(diag) => failure_with_source("cli", diag),
        Ok(None) => {
            // Layer 3 (Fallback when `agy` CLI is not installed): reuse active hub or de-noised runtime.
            desktop_runtime::sample()
                .and_then(|sample| decode(sample, &salt))
                .unwrap_or_else(failure)
        }
    };

    *last = Some(CachedRead {
        at: Instant::now(),
        pools: pools.clone(),
        from_network: true,
    });
    pools
}

fn failure(diagnostic: Diagnostic) -> [Pool; 2] {
    failure_with_source("desktop", diagnostic)
}

fn failure_with_source(source: &'static str, diagnostic: Diagnostic) -> [Pool; 2] {
    let state = match diagnostic.code {
        "QGM-230" => "absent",
        "QGM-244" => "authRequired",
        "QGM-246" => "ambiguous",
        "QGM-247" => "unreadable",
        _ => "failed",
    };
    std::array::from_fn(|_| Pool {
        source,
        diagnostic: Some(diagnostic.clone()),
        ..Pool::unavailable(state)
    })
}

fn account_salt() -> Result<String, Diagnostic> {
    let error = || {
        Diagnostic::new(
            "QGM-257",
            "无法保存 AG 账号隔离标识，请检查本地应用数据目录权限",
        )
    };
    let root = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(error)?
        .join("QuoDex/GeminiQuota");
    fs::create_dir_all(&root).map_err(|_| error())?;
    let path = root.join("account-salt");
    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => {
            file.write_all(uuid::Uuid::new_v4().to_string().as_bytes())
                .map_err(|_| error())?;
            file.sync_all().map_err(|_| error())?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(error()),
    }
    let salt = fs::read_to_string(path).map_err(|_| error())?;
    uuid::Uuid::parse_str(&salt).map_err(|_| error())?;
    Ok(salt)
}

fn identity(status: &Value) -> Option<String> {
    status
        .pointer("/userStatus/email")?
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 320)
        .map(str::to_lowercase)
}

fn fraction(bucket: &Value) -> Option<f64> {
    let direct = bucket.get("remainingFraction");
    let nested = bucket.get("remaining").and_then(|r| {
        r.get("remainingFraction").or_else(|| {
            (r.get("case").and_then(Value::as_str) == Some("remainingFraction"))
                .then(|| r.get("value"))
                .flatten()
        })
    });
    let value = direct.or(nested)?.as_f64()?;
    if let (Some(a), Some(b)) = (direct, nested) {
        if a.as_f64()? != b.as_f64()? {
            return None;
        }
    }
    (value.is_finite() && (0.0..=1.0).contains(&value)).then_some(value)
}

pub(super) fn decode(sample: desktop_runtime::Sample, salt: &str) -> Result<[Pool; 2], Diagnostic> {
    if sample.quota.get("code").is_some_and(|code| {
        code.as_i64() != Some(0) && !matches!(code.as_str(), Some("0" | "OK" | "SUCCESS"))
    }) {
        return Err(Diagnostic::new(
            "QGM-255",
            "AG 额度接口报告错误，请稍后刷新",
        ));
    }
    let before = identity(&sample.before)
        .ok_or_else(|| Diagnostic::new("QGM-244", "AG 未登录，请登录后刷新额度"))?;
    if identity(&sample.after).as_ref() != Some(&before) {
        return Err(Diagnostic::new(
            "QGM-246",
            "AG 账号在采样期间发生变化，请刷新后查看新账号额度",
        ));
    }
    let account = format!(
        "ag:{:x}",
        Sha256::digest(format!("{salt}\0{before}").as_bytes())
    );
    let root = sample
        .quota
        .get("response")
        .or_else(|| sample.quota.get("summary"))
        .unwrap_or(&sample.quota);
    let groups = root
        .get("groups")
        .and_then(Value::as_array)
        .ok_or_else(|| Diagnostic::new("QGM-247", "AG 未返回额度分组，请更新 QuoDex 后重试"))?;
    let observed_at_ms = chrono::Utc::now().timestamp_millis();
    let mut pools = std::array::from_fn(|_| Pool {
        source: "desktop",
        account_key: Some(account.clone()),
        ..Pool::unavailable("unreadable")
    });
    for (group_index, prefix) in ["gemini", "3p"].into_iter().enumerate() {
        let pool = &mut pools[group_index];
        let mut incomplete = false;
        for (suffix, period) in [("5h", "fiveHour"), ("weekly", "weekly")] {
            let id = format!("{prefix}-{suffix}");
            let mut matches = groups
                .iter()
                .filter_map(|g| g.get("buckets").and_then(Value::as_array))
                .flatten()
                .filter(|b| {
                    b.get("bucketId")
                        .or_else(|| b.get("id"))
                        .and_then(Value::as_str)
                        == Some(&id)
                });
            let Some(bucket) = matches.next() else {
                incomplete = true;
                continue;
            };
            if matches.next().is_some()
                || bucket.get("disabled").and_then(Value::as_bool) == Some(true)
                || bucket
                    .get("window")
                    .is_some_and(|w| w.as_str() != Some(suffix))
            {
                incomplete = true;
                continue;
            }
            let Some(remaining) = fraction(bucket) else {
                incomplete = true;
                continue;
            };
            let reset = bucket
                .get("resetTime")
                .and_then(Value::as_str)
                .filter(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok())
                .map(str::to_owned);
            pool.windows.push(Window {
                period,
                remaining_percent: remaining * 100.0,
                reset,
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
    Ok(pools)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample(quota: Value) -> desktop_runtime::Sample {
        desktop_runtime::Sample {
            before: json!({"userStatus":{"email":"example@example.test"}}),
            after: json!({"userStatus":{"email":"example@example.test"}}),
            quota,
        }
    }
    fn quota() -> Value {
        json!({"response":{"groups":[{"buckets":[
            {"bucketId":"gemini-5h","window":"5h","remainingFraction":0},
            {"bucketId":"gemini-weekly","window":"weekly","remainingFraction":0.72,"resetTime":"2020-01-01T00:00:00Z"},
            {"bucketId":"3p-5h","window":"5h","remaining":{"case":"remainingFraction","value":1}},
            {"bucketId":"3p-weekly","window":"weekly","remaining":{"remainingFraction":0.5}}
        ]}]}})
    }

    #[test]
    fn decodes_four_independent_windows_without_inventing_resets() {
        let pools = decode(sample(quota()), "salt").unwrap();
        assert_eq!(
            pools[0]
                .windows
                .iter()
                .map(|w| w.remaining_percent)
                .collect::<Vec<_>>(),
            [0., 72.]
        );
        assert_eq!(
            pools[1]
                .windows
                .iter()
                .map(|w| w.remaining_percent)
                .collect::<Vec<_>>(),
            [100., 50.]
        );
        assert_eq!(
            pools[0].windows[1].reset.as_deref(),
            Some("2020-01-01T00:00:00Z")
        );
        assert_eq!(pools[1].windows[0].reset, None);
        assert_eq!(pools[0].account_key, pools[1].account_key);
        assert!(!pools[0].account_key.as_ref().unwrap().contains("example"));
    }

    #[test]
    fn rejects_account_switch_and_does_not_reuse_identity_between_accounts() {
        let original = decode(sample(quota()), "salt").unwrap()[0]
            .account_key
            .clone();
        assert_eq!(
            decode(sample(quota()), "salt").unwrap()[0].account_key,
            original
        );
        let mut changed = sample(quota());
        changed.after = json!({"userStatus":{"email":"other@example.test"}});
        assert_eq!(decode(changed, "salt").unwrap_err().code, "QGM-246");
        let mut next = sample(quota());
        next.before = json!({"userStatus":{"email":"other@example.test"}});
        next.after = next.before.clone();
        assert_ne!(decode(next, "salt").unwrap()[0].account_key, original);
    }

    #[test]
    fn missing_disabled_invalid_or_duplicate_bucket_never_means_full_or_empty() {
        for replacement in [
            json!({"bucketId":"gemini-5h","window":"5h"}),
            json!({"bucketId":"gemini-5h","window":"5h","remainingFraction":1.1}),
            json!({"bucketId":"gemini-5h","window":"5h","remainingFraction":-0.1}),
            json!({"bucketId":"gemini-5h","window":"5h","remainingFraction":true}),
            json!({"bucketId":"gemini-5h","window":"5h","remainingFraction":1,"disabled":true}),
            json!({"bucketId":"gemini-5h","window":"weekly","remainingFraction":1}),
            json!({"bucketId":"gemini-5h","window":"5h","remainingFraction":1,"remaining":{"remainingFraction":0}}),
        ] {
            let mut q = quota();
            q["response"]["groups"][0]["buckets"][0] = replacement;
            let pools = decode(sample(q), "salt").unwrap();
            assert_eq!(pools[0].windows.len(), 1);
            assert_eq!(pools[0].windows[0].period, "weekly");
            assert_eq!(pools[1].windows.len(), 2);
        }
        let mut q = quota();
        let duplicate = q["response"]["groups"][0]["buckets"][0].clone();
        q["response"]["groups"][0]["buckets"]
            .as_array_mut()
            .unwrap()
            .push(duplicate);
        assert_eq!(decode(sample(q), "salt").unwrap()[0].windows.len(), 1);
    }

    #[test]
    fn ignores_extra_model_groups_instead_of_merging_their_limits() {
        let mut q = quota();
        q["response"]["groups"]
            .as_array_mut()
            .unwrap()
            .push(json!({"buckets":[
                {"bucketId":"argon-5h","window":"5h","remainingFraction":0.13}
            ]}));
        assert_eq!(decode(sample(q), "salt").unwrap()[0].windows.len(), 2);
    }

    #[test]
    fn an_error_envelope_cannot_publish_embedded_quota_as_success() {
        let mut q = quota();
        q["code"] = json!(7);
        assert!(decode(sample(q), "salt").is_err());
    }
}

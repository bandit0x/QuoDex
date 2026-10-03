//! ZCode personal reset cards. This reader never claims or consumes cards.
use crate::{
    capacity::{Diagnostic, FullResetCredits},
    zcode_quota::{fetch_read_only_body, zcode_config_candidates},
};
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs};

const STATUS_URL: &str = "https://zcode.z.ai/api/v1/coding-plan/reset/status";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZCodeResetCredits {
    pub five_hour: FullResetCredits,
    pub weekly: FullResetCredits,
}

#[derive(Deserialize)]
struct ResetResponse {
    code: i64,
    data: Option<ResetData>,
}

#[derive(Deserialize)]
struct ResetData {
    available_five_hour_resets: Vec<ResetCard>,
    available_week_resets: Vec<ResetCard>,
}

#[derive(Deserialize)]
struct ResetCard {
    expire_at: Option<f64>,
}

#[derive(Deserialize)]
struct OAuthUserInfo {
    id: String,
}

fn credentials_failure() -> Diagnostic {
    Diagnostic::new("CRV-521", "重置卡登录信息不可用，请在 ZCode 重新登录后刷新")
}

/// Matches the official client's enc:v1 AES-256-GCM credential format. Secrets
/// remain in memory; error details deliberately omit credential values/keys.
fn decrypt_credential(value: &str, secret: &str) -> Result<String, Diagnostic> {
    let Some(encoded) = value.strip_prefix("enc:v1:") else {
        return Ok(value.to_owned());
    };
    let parts: Vec<_> = encoded.split('.').collect();
    if parts.len() != 3 {
        return Err(credentials_failure());
    }
    let decode = |part| {
        URL_SAFE_NO_PAD
            .decode(part)
            .map_err(|_| credentials_failure())
    };
    let iv = decode(parts[0])?;
    let tag = decode(parts[1])?;
    let mut ciphertext = decode(parts[2])?;
    if iv.len() != 12 || tag.len() != 16 {
        return Err(credentials_failure());
    }
    ciphertext.extend(tag);
    let key = Sha256::digest(secret.as_bytes());
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| credentials_failure())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&iv), ciphertext.as_slice())
        .map_err(|_| credentials_failure())?;
    String::from_utf8(plaintext).map_err(|_| credentials_failure())
}

fn credential_secret(lookup: &dyn Fn(&str) -> Option<String>) -> Result<String, Diagnostic> {
    if let Some(secret) = lookup("ZCODE_CREDENTIAL_SECRET") {
        return Ok(secret);
    }
    let platform = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "win32"
    } else {
        "linux"
    };
    let home = if cfg!(target_os = "windows") {
        "USERPROFILE"
    } else {
        "HOME"
    };
    let user = if cfg!(target_os = "windows") {
        "USERNAME"
    } else {
        "USER"
    };
    Ok(format!(
        "zcode-credential-fallback:{platform}:{}:{}",
        lookup(home).ok_or_else(credentials_failure)?,
        lookup(user).ok_or_else(credentials_failure)?,
    ))
}

struct ResetAuth {
    authorization: String,
    provider_token: String,
}

fn resolve_auth(
    credentials: &BTreeMap<String, String>,
    secret: &str,
    quota_api_key: &str,
) -> Result<ResetAuth, Diagnostic> {
    let read = |key: &str| {
        decrypt_credential(
            credentials.get(key).ok_or_else(credentials_failure)?,
            secret,
        )
    };
    let family = read("oauth:active_provider")?;
    if !matches!(family.as_str(), "bigmodel" | "zai") {
        return Err(credentials_failure());
    }
    // A quota API key must belong to this personal OAuth account. Team and
    // unrelated explicit API keys cannot borrow the signed-in user's cards.
    let info: OAuthUserInfo = serde_json::from_str(&read(&format!("oauth:{family}:user_info"))?)
        .map_err(|_| credentials_failure())?;
    if info.id.trim().is_empty() {
        return Err(credentials_failure());
    }
    let credential_key = format!(
        "account-provider:coding-plan:account:{family}-individual-coding-plan:account:{}:api-key",
        info.id
    );
    let matched = credentials
        .get(&credential_key)
        .map(|value| decrypt_credential(value, secret))
        .transpose()?;
    if matched.as_deref() != Some(quota_api_key) {
        return Err(Diagnostic::new(
            "CRV-522",
            "重置卡与当前配额账户不匹配，请在 ZCode 切换到对应个人账户后刷新",
        ));
    }
    let jwt = read("zcodejwttoken")?;
    let provider_token = read(&format!("oauth:{family}:access_token"))?;
    if jwt.trim().is_empty() || provider_token.trim().is_empty() {
        return Err(credentials_failure());
    }
    let authorization = if jwt.starts_with("Bearer ") {
        jwt
    } else {
        format!("Bearer {jwt}")
    };
    Ok(ResetAuth {
        authorization,
        provider_token,
    })
}

pub(crate) async fn read_reset_credits(
    lookup: &(dyn Fn(&str) -> Option<String> + Sync),
    quota_api_key: &str,
    now_ms: u64,
) -> Result<ZCodeResetCredits, Diagnostic> {
    let secret = credential_secret(lookup)?;
    let credentials = read_credentials(lookup)?;
    let auth = resolve_auth(&credentials, &secret, quota_api_key)?;
    let body = fetch_read_only_body(
        STATUS_URL,
        &[
            ("Authorization", &auth.authorization),
            ("X-Bigmodel-Authorization", &auth.provider_token),
            ("Bigmodel-Target-Type", "PERSONAL"),
        ],
    )
    .await
    .map_err(|error| {
        Diagnostic::new(
            "CRV-523",
            "重置卡请求失败，请检查网络或在 ZCode 重新登录后刷新",
        )
        .with_detail(error.code)
    })?;
    parse_reset_payload(&body, now_ms)
}

fn read_credentials(
    lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<BTreeMap<String, String>, Diagnostic> {
    for dir in zcode_config_candidates(lookup) {
        match fs::read_to_string(dir.join("credentials.json")) {
            Ok(raw) => {
                return serde_json::from_str(&raw).map_err(|_| {
                    Diagnostic::new(
                        "CRV-526",
                        "重置卡登录文件格式损坏，请在 ZCode 重新登录以重建文件",
                    )
                })
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                return Err(Diagnostic::new(
                    "CRV-525",
                    "无法读取重置卡登录文件，请检查其访问权限和文件状态",
                ))
            }
        }
    }
    Err(credentials_failure())
}

pub(crate) fn parse_reset_payload(raw: &str, now_ms: u64) -> Result<ZCodeResetCredits, Diagnostic> {
    let invalid = || Diagnostic::new("CRV-524", "重置卡响应不可用，请在 ZCode 确认登录状态后刷新");
    let payload: ResetResponse = serde_json::from_str(raw).map_err(|_| invalid())?;
    if payload.code != 0 {
        return Err(invalid());
    }
    let data = payload.data.ok_or_else(invalid)?;
    let summarize = |cards: Vec<ResetCard>| {
        let available: Vec<_> = cards
            .into_iter()
            .filter_map(|card| card.expire_at)
            .filter(|expiry| expiry.is_finite() && *expiry > now_ms as f64)
            .collect();
        FullResetCredits {
            available_count: available.len() as u64,
            // UI timestamps use seconds; the ZCode wire format uses milliseconds.
            nearest_expiry_at: available
                .into_iter()
                .min_by(f64::total_cmp)
                .map(|value| (value / 1000.0) as u64),
        }
    };
    Ok(ZCodeResetCredits {
        five_hour: summarize(data.available_five_hour_resets),
        weekly: summarize(data.available_week_resets),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::aead::Aead;
    use serde_json::json;

    fn encrypted(value: &str, secret: &str) -> String {
        let key = Sha256::digest(secret.as_bytes());
        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let iv = [7u8; 12];
        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&iv), value.as_bytes())
            .unwrap();
        let (body, tag) = ciphertext.split_at(ciphertext.len() - 16);
        format!(
            "enc:v1:{}.{}.{}",
            URL_SAFE_NO_PAD.encode(iv),
            URL_SAFE_NO_PAD.encode(tag),
            URL_SAFE_NO_PAD.encode(body)
        )
    }

    #[test]
    fn filters_expired_cards_and_converts_nearest_expiry_to_seconds() {
        let raw = json!({"code":0,"data":{
            "available_five_hour_resets":[{"expire_at":200_000},{"expire_at":100_000},{"expire_at":180_000},{"expire_at":null},{}],
            "available_week_resets":[{"expire_at":500_000}],
            "latest_week_reset_history":{"used_at":60_000}
        }}).to_string();
        let cards = parse_reset_payload(&raw, 100_000).unwrap();
        assert_eq!(cards.five_hour.available_count, 2);
        assert_eq!(cards.five_hour.nearest_expiry_at, Some(180));
        assert_eq!(cards.weekly.available_count, 1);
        assert_eq!(cards.weekly.nearest_expiry_at, Some(500));
    }

    #[test]
    fn distinguishes_empty_inventory_from_failed_or_partial_response() {
        let empty =
            r#"{"code":0,"data":{"available_five_hour_resets":[],"available_week_resets":[]}}"#;
        let cards = parse_reset_payload(empty, 100_000).unwrap();
        assert_eq!(cards.five_hour.available_count, 0);
        assert!(cards.weekly.nearest_expiry_at.is_none());
        for raw in [
            r#"{"code":401}"#,
            r#"{"code":0,"data":{}}"#,
            "null",
            "invalid",
        ] {
            assert_eq!(
                parse_reset_payload(raw, 100_000).unwrap_err().code,
                "CRV-524"
            );
        }
    }

    #[test]
    fn decrypts_official_format_and_rejects_tampering_without_secret_details() {
        let encoded = encrypted("test-jwt", "test-secret");
        assert_eq!(
            decrypt_credential(&encoded, "test-secret").unwrap(),
            "test-jwt"
        );
        let error = decrypt_credential(&encoded, "wrong-secret").unwrap_err();
        assert_eq!(error.code, "CRV-521");
        assert!(error.detail.is_none());
        for malformed in ["enc:v1:a.b.c", "enc:v1:", "enc:v1:a.b"] {
            assert!(decrypt_credential(malformed, "test-secret").is_err());
        }
        assert_eq!(
            decrypt_credential("plaintext-token", "test-secret").unwrap(),
            "plaintext-token"
        );
    }

    #[test]
    fn authenticates_only_matching_personal_accounts_in_both_regions() {
        for family in ["bigmodel", "zai"] {
            let credentials = BTreeMap::from([
                ("oauth:active_provider".to_owned(), encrypted(family, "test-secret")),
                ("zcodejwttoken".to_owned(), encrypted("jwt", "test-secret")),
                (format!("oauth:{family}:access_token"), encrypted("oauth", "test-secret")),
                (format!("oauth:{family}:user_info"), encrypted(r#"{"id":"test-account"}"#, "test-secret")),
                (format!("account-provider:coding-plan:account:{family}-individual-coding-plan:account:test-account:api-key"), encrypted("quota-key", "test-secret")),
                (format!("account-provider:coding-plan:account:{family}-individual-coding-plan:account:previous-account:api-key"), encrypted("another-account", "test-secret")),
            ]);
            let auth = resolve_auth(&credentials, "test-secret", "quota-key").unwrap();
            assert_eq!(auth.authorization, "Bearer jwt");
            assert_eq!(auth.provider_token, "oauth");
            assert_eq!(
                resolve_auth(&credentials, "test-secret", "another-account")
                    .err()
                    .unwrap()
                    .code,
                "CRV-522"
            );
            let team: BTreeMap<_, _> = credentials
                .into_iter()
                .map(|(key, value)| {
                    (
                        key.replace("individual-coding-plan", "team-coding-plan"),
                        value,
                    )
                })
                .collect();
            assert_eq!(
                resolve_auth(&team, "test-secret", "quota-key")
                    .err()
                    .unwrap()
                    .code,
                "CRV-522"
            );
        }
    }

    #[test]
    fn credential_file_diagnostics_distinguish_missing_unreadable_and_malformed() {
        let dir = std::env::temp_dir().join(format!("quodex-reset-auth-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let lookup = |name: &str| {
            (name == "CODEX_CREDITS_ZCODE_CONFIG_DIR").then(|| dir.to_string_lossy().into_owned())
        };
        assert_eq!(read_credentials(&lookup).unwrap_err().code, "CRV-521");
        let path = dir.join("credentials.json");
        fs::create_dir(&path).unwrap();
        assert_eq!(read_credentials(&lookup).unwrap_err().code, "CRV-525");
        fs::remove_dir(&path).unwrap();
        fs::write(&path, "invalid-json").unwrap();
        assert_eq!(read_credentials(&lookup).unwrap_err().code, "CRV-526");
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}

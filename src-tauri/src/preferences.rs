use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

use crate::capacity::Diagnostic;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum MeterSourceSelection {
    #[default]
    Carousel,
    Codex,
    Zcode,
}

/// ZCode 来源下展示的套餐：Start = 体验套餐优先（网关判定不可用回落个人），
/// Coding = 仅个人套餐（用户不想盯体验套餐的消耗）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ZCodePlanSelection {
    #[default]
    Start,
    Coding,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DisplayPreferences {
    pub opacity: f64,
    pub reduced_motion: bool,
    #[serde(default = "default_always_on_top")]
    pub always_on_top: bool,
    #[serde(default)]
    pub source: MeterSourceSelection,
    #[serde(default)]
    pub zcode_plan: ZCodePlanSelection,
    pub x: Option<i32>,
    pub y: Option<i32>,
}

impl Default for DisplayPreferences {
    fn default() -> Self {
        Self {
            opacity: 0.92,
            reduced_motion: false,
            always_on_top: true,
            source: MeterSourceSelection::default(),
            zcode_plan: ZCodePlanSelection::default(),
            x: None,
            y: None,
        }
    }
}

fn default_always_on_top() -> bool {
    true
}

pub struct PreferencesStore {
    path: PathBuf,
    value: Mutex<DisplayPreferences>,
}

impl PreferencesStore {
    pub fn new(app: &AppHandle) -> Self {
        let path = std::env::var_os("CODEX_CREDITS_CONFIG_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                app.path()
                    .app_config_dir()
                    .unwrap_or_else(|_| PathBuf::from("."))
            })
            .join("display-preferences.json");
        Self::from_path(path)
    }

    fn from_path(path: PathBuf) -> Self {
        let value = read_from_disk(&path).unwrap_or_default();
        Self {
            path,
            value: Mutex::new(value),
        }
    }

    pub fn load(&self) -> DisplayPreferences {
        self.value
            .lock()
            .expect("preferences lock poisoned")
            .clone()
    }

    #[cfg(test)]
    fn save(&self, preferences: DisplayPreferences) -> Result<(), Diagnostic> {
        validate(&preferences)?;
        let mut value = self.value.lock().expect("preferences lock poisoned");
        write_to_disk(&self.path, &preferences)?;
        *value = preferences;
        Ok(())
    }

    /// Display saves can await the main thread; merge the latest drag position at commit time.
    pub fn save_display(&self, mut preferences: DisplayPreferences) -> Result<(), Diagnostic> {
        validate(&preferences)?;
        let mut value = self.value.lock().expect("preferences lock poisoned");
        preferences.x = value.x;
        preferences.y = value.y;
        write_to_disk(&self.path, &preferences)?;
        *value = preferences;
        Ok(())
    }

    pub fn update_position(&self, position: PhysicalPosition<i32>) -> Result<(), Diagnostic> {
        let mut value = self.value.lock().expect("preferences lock poisoned");
        let mut preferences = value.clone();
        preferences.x = Some(position.x);
        preferences.y = Some(position.y);
        write_to_disk(&self.path, &preferences)?;
        *value = preferences;
        Ok(())
    }
}

pub(crate) fn validate(preferences: &DisplayPreferences) -> Result<(), Diagnostic> {
    if !(0.86..=1.0).contains(&preferences.opacity) {
        return Err(Diagnostic::new(
            "CRV-301",
            "显示透明度必须在 86% 到 100% 之间",
        ));
    }
    Ok(())
}

fn read_from_disk(path: &Path) -> Option<DisplayPreferences> {
    let bytes = fs::read(path).ok()?;
    let mut preferences: DisplayPreferences = serde_json::from_slice(&bytes).ok()?;
    preferences.opacity = preferences.opacity.clamp(0.86, 1.0);
    Some(preferences)
}

fn write_to_disk(path: &Path, preferences: &DisplayPreferences) -> Result<(), Diagnostic> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            Diagnostic::new("CRV-302", "无法创建本地显示偏好目录").with_detail(error.to_string())
        })?;
    }
    let bytes = serde_json::to_vec_pretty(preferences).map_err(|error| {
        Diagnostic::new("CRV-303", "无法编码本地显示偏好").with_detail(error.to_string())
    })?;
    atomic_write(path, &bytes, |file, bytes| {
        file.write_all(bytes)?;
        file.sync_all()
    })
    .map_err(|error| {
        Diagnostic::new("CRV-304", "无法保存本地显示偏好；检查配置目录权限后重试")
            .with_detail(error.to_string())
    })
}

fn atomic_write(
    path: &Path,
    bytes: &[u8],
    write: impl FnOnce(&mut fs::File, &[u8]) -> std::io::Result<()>,
) -> std::io::Result<()> {
    // A failed write must leave the previously accepted preferences intact.
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        write(&mut file, bytes)?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub fn restore_window_position(window: &WebviewWindow, store: &PreferencesStore) {
    let preferences = store.load();
    if let (Some(x), Some(y)) = (preferences.x, preferences.y) {
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn preferences_round_trip_without_credentials_or_startup_state() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("crv-preferences-{unique}.json"));
        let store = PreferencesStore::from_path(path.clone());
        let expected = DisplayPreferences {
            opacity: 0.9,
            reduced_motion: true,
            always_on_top: false,
            source: MeterSourceSelection::Carousel,
            zcode_plan: ZCodePlanSelection::Coding,
            x: Some(120),
            y: Some(240),
        };

        store.save(expected.clone()).expect("save preferences");
        assert_eq!(PreferencesStore::from_path(path.clone()).load(), expected);
        let raw = fs::read_to_string(&path).expect("read preferences");
        assert!(!raw.contains("token"));
        assert!(!raw.contains("startup"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn default_preferences_match_the_volumetric_lens_contract() {
        assert_eq!(DisplayPreferences::default().opacity, 0.92);
        assert!(!DisplayPreferences::default().reduced_motion);
        assert!(DisplayPreferences::default().always_on_top);
        assert_eq!(
            DisplayPreferences::default().source,
            MeterSourceSelection::Carousel
        );
        assert_eq!(
            DisplayPreferences::default().zcode_plan,
            ZCodePlanSelection::Start
        );
    }

    #[test]
    fn legacy_preferences_without_source_default_to_carousel() {
        let raw = r#"{"opacity":0.94,"reducedMotion":true,"x":10,"y":20}"#;
        let preferences: DisplayPreferences =
            serde_json::from_str(raw).expect("legacy preferences");
        assert_eq!(preferences.source, MeterSourceSelection::Carousel);
        assert_eq!(preferences.zcode_plan, ZCodePlanSelection::Start);
        assert!(preferences.always_on_top);
    }

    #[test]
    fn partial_write_failure_preserves_accepted_file_and_removes_temporary() {
        let root = std::env::temp_dir().join(format!("quodex-pin-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("display-preferences.json");
        fs::write(&path, b"accepted").unwrap();
        let error = atomic_write(&path, b"replacement", |file, bytes| {
            file.write_all(&bytes[..3])?;
            Err(std::io::Error::other(
                "fixture: disk full after partial write",
            ))
        })
        .unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::Other);
        assert_eq!(fs::read(&path).unwrap(), b"accepted");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn display_commit_keeps_position_changed_while_native_effect_was_pending() {
        let root = std::env::temp_dir().join(format!("quodex-pin-{}", uuid::Uuid::new_v4()));
        let store = PreferencesStore::from_path(root.join("display-preferences.json"));
        let mut pending = store.load();
        pending.always_on_top = false;
        store
            .update_position(PhysicalPosition::new(333, 444))
            .unwrap();
        store.save_display(pending).unwrap();
        let accepted = store.load();
        assert!(!accepted.always_on_top);
        assert_eq!((accepted.x, accepted.y), (Some(333), Some(444)));
        assert_eq!(
            PreferencesStore::from_path(store.path.clone()).load(),
            accepted
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_commit_does_not_change_in_memory_preference() {
        let root = std::env::temp_dir().join(format!("quodex-pin-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let store = PreferencesStore::from_path(root.join("display-preferences.json"));
        fs::create_dir(&store.path).unwrap(); // deterministic rename failure, including when run as root
        let accepted = store.load();
        let mut pending = accepted.clone();
        pending.always_on_top = false;
        assert_eq!(store.save_display(pending).unwrap_err().code, "CRV-304");
        assert_eq!(store.load(), accepted);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}

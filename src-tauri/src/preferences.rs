use serde::{Deserialize, Serialize};
use std::{
    fs,
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
            source: MeterSourceSelection::default(),
            zcode_plan: ZCodePlanSelection::default(),
            x: None,
            y: None,
        }
    }
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

    pub fn save(&self, preferences: DisplayPreferences) -> Result<(), Diagnostic> {
        validate(&preferences)?;
        write_to_disk(&self.path, &preferences)?;
        *self.value.lock().expect("preferences lock poisoned") = preferences;
        Ok(())
    }

    pub fn update_position(&self, position: PhysicalPosition<i32>) -> Result<(), Diagnostic> {
        let mut preferences = self.load();
        preferences.x = Some(position.x);
        preferences.y = Some(position.y);
        self.save(preferences)
    }
}

fn validate(preferences: &DisplayPreferences) -> Result<(), Diagnostic> {
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
    fs::write(path, bytes).map_err(|error| {
        Diagnostic::new("CRV-304", "无法保存本地显示偏好").with_detail(error.to_string())
    })
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
    }
}

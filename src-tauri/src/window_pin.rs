//! Native window policy: a floating level and participation in fullscreen Spaces are separate.
use crate::{capacity::Diagnostic, preferences::PreferencesStore};
use serde::Serialize;
use std::{future::Future, sync::Mutex};
use tauri::{Manager, State, WebviewWindow};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeSnapshot {
    level: isize,
    collection_behavior: usize,
    enabled: bool,
}

#[derive(Default)]
pub struct WindowPinState {
    baseline: Mutex<Option<NativeSnapshot>>,
    pub operation: tokio::sync::Mutex<()>,
    startup_diagnostic: Mutex<Option<Diagnostic>>,
}

impl WindowPinState {
    pub fn startup_diagnostic(&self) -> Option<Diagnostic> {
        self.startup_diagnostic
            .lock()
            .expect("window pin lock poisoned")
            .clone()
    }
}

/// Startup readiness is separate from the accepted display preferences.
#[tauri::command]
pub fn read_window_pin_startup_diagnostic(state: State<'_, WindowPinState>) -> Option<Diagnostic> {
    state.startup_diagnostic()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPinDiagnostics {
    platform: &'static str,
    requested_always_on_top: bool,
    policy_matches_requested: bool,
    snapshot: NativeSnapshot,
    initial_snapshot: Option<NativeSnapshot>,
    startup_diagnostic: Option<Diagnostic>,
    #[cfg(target_os = "macos")]
    mac_os: native::Visibility,
}

fn native_failure() -> Diagnostic {
    Diagnostic::new("CRV-307", "无法更新窗口置顶；请重试或重新打开 QuoDex")
}

async fn on_main<T: Send + 'static>(
    window: &WebviewWindow,
    action: impl FnOnce(&WebviewWindow) -> Result<T, Diagnostic> + Send + 'static,
) -> Result<T, Diagnostic> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let native = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(action(&native));
        })
        .map_err(|_| native_failure())?;
    rx.await.map_err(|_| native_failure())?
}

fn restore_now(window: &WebviewWindow, snapshot: NativeSnapshot) -> Result<(), Diagnostic> {
    if let Err(error) = native::write(window, snapshot) {
        return Err(effect_failure(error, native::capture(window).ok()));
    }
    let observed = native::capture(window).map_err(|error| effect_failure(error, None))?;
    if observed != snapshot {
        return Err(effect_failure(
            native_failure().with_detail("原生窗口未接受目标层级或 Space 行为"),
            Some(observed),
        ));
    }
    Ok(())
}

fn effect_failure(error: Diagnostic, actual: Option<NativeSnapshot>) -> Diagnostic {
    let reason = error.detail.clone();
    error.with_detail(
        serde_json::json!({
            "reason": reason,
            "actualStatus": if actual.is_some() { "readBack" } else { "unknown" },
            "actual": actual,
        })
        .to_string(),
    )
}

fn rollback_failure(original: &Diagnostic, rollback: &Diagnostic) -> Diagnostic {
    let actual = rollback
        .detail
        .as_deref()
        .and_then(|detail| serde_json::from_str::<serde_json::Value>(detail).ok())
        .and_then(|detail| detail.get("actual").cloned())
        .unwrap_or(serde_json::Value::Null);
    Diagnostic::new(
        "CRV-308",
        "设置未保存，窗口置顶也未能恢复；请重新打开 QuoDex 后检查开关",
    )
    .with_detail(
        serde_json::json!({
            "originalCode": original.code,
            "rollbackCode": rollback.code,
            "actualStatus": if actual.is_null() { "unknown" } else { "readBack" },
            "actual": actual,
        })
        .to_string(),
    )
}

fn apply_now(window: &WebviewWindow, enabled: bool) -> Result<NativeSnapshot, Diagnostic> {
    let previous = native::capture(window)?;
    let state = window.state::<WindowPinState>();
    let baseline = *state
        .baseline
        .lock()
        .expect("window pin lock poisoned")
        .get_or_insert(previous);
    let target = native::target(enabled, baseline);
    if let Err(error) = restore_now(window, target) {
        if let Err(rollback) = restore_now(window, previous) {
            return Err(rollback_failure(&error, &rollback));
        }
        return Err(error);
    }
    Ok(previous)
}

/// Called in Tauri setup, on its main thread, before the frontend reads preferences.
pub fn initialize(window: &WebviewWindow, enabled: bool) {
    if let Err(error) = apply_now(window, enabled) {
        eprintln!("window pin startup diagnostic: {}", error.code);
        *window
            .state::<WindowPinState>()
            .startup_diagnostic
            .lock()
            .expect("window pin lock poisoned") = Some(error);
    }
    export_diagnostics(window, "startup");
}

/// The effect is acknowledged before saving. The rollback restores exact native state.
async fn transaction<S, A, AF, P, R, RF>(
    apply: A,
    persist: P,
    rollback: R,
) -> Result<(), Diagnostic>
where
    A: FnOnce() -> AF,
    AF: Future<Output = Result<S, Diagnostic>>,
    P: FnOnce() -> Result<(), Diagnostic>,
    R: FnOnce(S) -> RF,
    RF: Future<Output = Result<(), Diagnostic>>,
{
    let previous = apply().await?;
    if let Err(error) = persist() {
        return match rollback(previous).await {
            Ok(()) => Err(error),
            Err(rollback) => Err(rollback_failure(&error, &rollback)),
        };
    }
    Ok(())
}

pub async fn save(
    window: &WebviewWindow,
    store: &PreferencesStore,
    preferences: crate::preferences::DisplayPreferences,
) -> Result<(), Diagnostic> {
    crate::preferences::validate(&preferences)?;
    let state = window.state::<WindowPinState>();
    let _operation = state.operation.lock().await;
    let enabled = preferences.always_on_top;
    transaction(
        || on_main(window, move |window| apply_now(window, enabled)),
        || store.save_display(preferences),
        |snapshot| on_main(window, move |window| restore_now(window, snapshot)),
    )
    .await?;
    *state
        .startup_diagnostic
        .lock()
        .expect("window pin lock poisoned") = None;
    export_diagnostics(window, "preferences-saved");
    Ok(())
}

/// Anonymous, own-window data only; usable during user-operated game testing.
#[tauri::command]
pub async fn read_window_pin_diagnostics(
    window: WebviewWindow,
) -> Result<WindowPinDiagnostics, Diagnostic> {
    on_main(&window, diagnostics_now).await
}

fn diagnostics_now(window: &WebviewWindow) -> Result<WindowPinDiagnostics, Diagnostic> {
    // The first focus event can precede setup; wait for a later lifecycle sample.
    let store = window
        .try_state::<PreferencesStore>()
        .ok_or_else(native_failure)?;
    let requested = store.load().always_on_top;
    let snapshot = native::capture(window)?;
    let state = window
        .try_state::<WindowPinState>()
        .ok_or_else(native_failure)?;
    let initial = *state.baseline.lock().expect("window pin lock poisoned");
    let startup_diagnostic = state
        .startup_diagnostic
        .lock()
        .expect("window pin lock poisoned")
        .clone();
    Ok(WindowPinDiagnostics {
        platform: std::env::consts::OS,
        requested_always_on_top: requested,
        policy_matches_requested: snapshot
            == native::target(requested, initial.unwrap_or(snapshot)),
        snapshot,
        initial_snapshot: initial,
        startup_diagnostic,
        #[cfg(target_os = "macos")]
        mac_os: native::visibility(window)?,
    })
}

/// Opt-in own-window export at lifecycle events. No other process or timer is involved.
pub fn export_diagnostics(window: &WebviewWindow, reason: &'static str) {
    let Some(path) = std::env::var_os("CODEX_CREDITS_PIN_DIAGNOSTICS_FILE") else {
        return;
    };
    let native = window.clone();
    if window
        .run_on_main_thread(move || {
            let write = || -> Result<(), Box<dyn std::error::Error>> {
                #[derive(Serialize)]
                #[serde(rename_all = "camelCase")]
                struct Sample {
                    sample_reason: &'static str,
                    sampled_at_ms: u128,
                    #[serde(flatten)]
                    diagnostics: WindowPinDiagnostics,
                }
                let diagnostics =
                    diagnostics_now(&native).map_err(|error| std::io::Error::other(error.code))?;
                let sampled_at_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)?
                    .as_millis();
                let bytes = serde_json::to_vec_pretty(&Sample {
                    sample_reason: reason,
                    sampled_at_ms,
                    diagnostics,
                })?;
                let path = std::path::PathBuf::from(path);
                let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let result = std::fs::write(&temporary, bytes)
                    .and_then(|_| std::fs::rename(&temporary, path));
                if result.is_err() {
                    let _ = std::fs::remove_file(temporary);
                }
                result?;
                Ok(())
            };
            if write().is_err() {
                eprintln!("window pin diagnostic export failed: CRV-309");
            }
        })
        .is_err()
    {
        eprintln!("window pin diagnostic export dispatch failed: CRV-309");
    }
}

#[cfg(any(target_os = "macos", test))]
fn pinned_behavior(baseline: usize, modern_spaces: bool) -> usize {
    // Apple NSWindow.h: each fullscreen group is mutually exclusive.
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const MOVE_TO_ACTIVE_SPACE: usize = 1 << 1;
    const FULL_SCREEN_PRIMARY: usize = 1 << 7;
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
    const FULL_SCREEN_NONE: usize = 1 << 9;
    const PRIMARY: usize = 1 << 16;
    const AUXILIARY: usize = 1 << 17;
    const CAN_JOIN_ALL_APPLICATIONS: usize = 1 << 18;
    let mut behavior = (baseline
        & !(MOVE_TO_ACTIVE_SPACE | FULL_SCREEN_PRIMARY | FULL_SCREEN_NONE))
        | CAN_JOIN_ALL_SPACES
        | FULL_SCREEN_AUXILIARY;
    if modern_spaces {
        behavior = (behavior & !(PRIMARY | AUXILIARY)) | CAN_JOIN_ALL_APPLICATIONS;
    }
    behavior
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use objc2::{msg_send, runtime::AnyObject};
    use objc2_foundation::NSProcessInfo;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowLevelForKey(key: i32) -> i32;
    }

    fn levels() -> (isize, isize) {
        // CGWindowLevelKey values are keys, not actual levels. Apple guarantees this query.
        unsafe {
            (
                CGWindowLevelForKey(4) as isize,
                CGWindowLevelForKey(5) as isize,
            )
        }
    }

    fn major_version() -> isize {
        NSProcessInfo::processInfo()
            .operatingSystemVersion()
            .majorVersion
    }

    fn handle(window: &WebviewWindow) -> Result<*mut AnyObject, Diagnostic> {
        let pointer = window.ns_window().map_err(|_| native_failure())? as *mut AnyObject;
        if pointer.is_null() {
            return Err(native_failure());
        }
        Ok(pointer)
    }

    pub(super) fn capture(window: &WebviewWindow) -> Result<NativeSnapshot, Diagnostic> {
        let pointer = handle(window)?;
        // This module is invoked only inside the main-thread closure or Tauri setup.
        let (level, collection_behavior) = unsafe {
            (
                msg_send![pointer, level],
                msg_send![pointer, collectionBehavior],
            )
        };
        Ok(NativeSnapshot {
            level,
            collection_behavior,
            enabled: level > levels().0,
        })
    }

    pub(super) fn target(enabled: bool, baseline: NativeSnapshot) -> NativeSnapshot {
        let (normal, floating) = levels();
        NativeSnapshot {
            level: if enabled { floating } else { normal },
            collection_behavior: if enabled {
                pinned_behavior(baseline.collection_behavior, major_version() >= 13)
            } else {
                baseline.collection_behavior
            },
            enabled,
        }
    }

    pub(super) fn write(
        window: &WebviewWindow,
        snapshot: NativeSnapshot,
    ) -> Result<(), Diagnostic> {
        let pointer = handle(window)?;
        unsafe {
            let _: () = msg_send![pointer, setCollectionBehavior: snapshot.collection_behavior];
            let _: () = msg_send![pointer, setLevel: snapshot.level];
        }
        Ok(())
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub(super) struct Visibility {
        major_version: isize,
        window_number: isize,
        visible: bool,
        on_active_space: bool,
        unoccluded: bool,
        key_window: bool,
    }

    pub(super) fn visibility(window: &WebviewWindow) -> Result<Visibility, Diagnostic> {
        let pointer = handle(window)?;
        unsafe {
            let occlusion: usize = msg_send![pointer, occlusionState];
            Ok(Visibility {
                major_version: major_version(),
                window_number: msg_send![pointer, windowNumber],
                visible: msg_send![pointer, isVisible],
                on_active_space: msg_send![pointer, isOnActiveSpace],
                unoccluded: occlusion & (1 << 1) != 0,
                key_window: msg_send![pointer, isKeyWindow],
            })
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod native {
    use super::*;
    pub(super) fn capture(window: &WebviewWindow) -> Result<NativeSnapshot, Diagnostic> {
        let enabled = window.is_always_on_top().map_err(|_| native_failure())?;
        Ok(NativeSnapshot {
            level: isize::from(enabled),
            collection_behavior: 0,
            enabled,
        })
    }
    pub(super) fn target(enabled: bool, _: NativeSnapshot) -> NativeSnapshot {
        NativeSnapshot {
            level: isize::from(enabled),
            collection_behavior: 0,
            enabled,
        }
    }
    pub(super) fn write(
        window: &WebviewWindow,
        snapshot: NativeSnapshot,
    ) -> Result<(), Diagnostic> {
        window
            .set_always_on_top(snapshot.enabled)
            .map_err(|_| native_failure())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[cfg(target_os = "macos")]
    #[test]
    fn disabled_native_target_restores_unrelated_baseline_behavior() {
        let baseline = NativeSnapshot {
            level: 5,
            collection_behavior: 64,
            enabled: true,
        };
        let enabled = native::target(true, baseline);
        assert_ne!(enabled.collection_behavior & (1 << 0), 0);
        assert_ne!(enabled.collection_behavior & (1 << 8), 0);
        let disabled = native::target(false, baseline);
        assert_eq!(disabled.collection_behavior, baseline.collection_behavior);
        assert!(!disabled.enabled);
        assert!(disabled.level < enabled.level);
    }

    #[test]
    fn policy_removes_conflicts_and_preserves_unrelated_behavior() {
        let baseline = (1 << 1) | (1 << 7) | (1 << 9) | (1 << 16) | (1 << 17) | (1 << 6);
        let modern = pinned_behavior(baseline, true);
        assert_eq!(
            modern & ((1 << 1) | (1 << 7) | (1 << 9) | (1 << 16) | (1 << 17)),
            0
        );
        assert_ne!(modern & (1 << 6), 0);
        let legacy = pinned_behavior(baseline, false);
        assert_eq!(legacy & (1 << 18), 0);
    }

    #[tokio::test]
    async fn native_failure_never_persists() {
        let persisted = Cell::new(false);
        let error = transaction::<(), _, _, _, _, _>(
            || async { Err(native_failure()) },
            || {
                persisted.set(true);
                Ok(())
            },
            |_| async { panic!("nothing was applied") },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "CRV-307");
        assert!(!persisted.get());
    }

    #[tokio::test]
    async fn failed_save_restores_exact_snapshot() {
        let previous = NativeSnapshot {
            level: 5,
            collection_behavior: 64,
            enabled: true,
        };
        let restored = Cell::new(None);
        let error = transaction(
            || async { Ok(previous) },
            || Err(Diagnostic::new("CRV-304", "fixture: cannot save")),
            |snapshot| {
                let restored = &restored;
                async move {
                    restored.set(Some(snapshot));
                    Ok(())
                }
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "CRV-304");
        assert_eq!(restored.get(), Some(previous));
    }

    #[tokio::test]
    async fn rollback_failure_has_its_own_diagnostic() {
        let error = transaction(
            || async { Ok(()) },
            || Err(Diagnostic::new("CRV-304", "fixture: cannot save")),
            |_| async { Err(native_failure()) },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "CRV-308");
        let detail: serde_json::Value = serde_json::from_str(&error.detail.unwrap()).unwrap();
        assert_eq!(detail["originalCode"], "CRV-304");
        assert_eq!(detail["actualStatus"], "unknown");
        assert!(detail["actual"].is_null());
    }

    #[tokio::test]
    async fn accepted_save_does_not_rollback() {
        transaction(
            || async { Ok(()) },
            || Ok(()),
            |_| async { panic!("successful save must retain the native effect") },
        )
        .await
        .unwrap();
    }

    #[test]
    fn startup_native_failure_is_available_without_discarding_accepted_preferences() {
        let state = WindowPinState::default();
        assert!(state.startup_diagnostic().is_none());
        *state.startup_diagnostic.lock().unwrap() = Some(native_failure());
        assert_eq!(state.startup_diagnostic().unwrap().code, "CRV-307");
    }

    #[tokio::test]
    async fn rollback_failure_reports_actual_readback_instead_of_previous_snapshot() {
        let previous = NativeSnapshot {
            level: 0,
            collection_behavior: 0,
            enabled: false,
        };
        let actual = NativeSnapshot {
            level: 3,
            collection_behavior: 262401,
            enabled: true,
        };
        let error = transaction(
            || async { Ok(previous) },
            || Err(Diagnostic::new("CRV-304", "fixture: cannot save")),
            |_| async { Err(effect_failure(native_failure(), Some(actual))) },
        )
        .await
        .unwrap_err();
        let detail: serde_json::Value = serde_json::from_str(&error.detail.unwrap()).unwrap();
        assert_eq!(detail["actualStatus"], "readBack");
        assert_eq!(detail["actual"]["enabled"], true);
        assert_eq!(detail["actual"]["level"], 3);
    }
}

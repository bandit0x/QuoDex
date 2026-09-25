mod capacity;
#[cfg(all(target_os = "windows", any(not(debug_assertions), test)))]
mod desktop_shortcut;
mod platform;
mod preferences;
mod tomato_cloud;
mod zcode_quota;

use capacity::{CapacityService, CapacitySnapshot, Diagnostic};
use preferences::{restore_window_position, DisplayPreferences, PreferencesStore};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WebviewWindow, WindowEvent,
};
use tomato_cloud::{TomatoCloudService, TomatoConnectionSnapshot};
use zcode_quota::{ZCodeQuotaService, ZCodeQuotaSnapshot};

const TRAY_SHOW_ID: &str = "show";
const TRAY_HIDE_ID: &str = "hide";
const TRAY_QUIT_ID: &str = "quit";

#[cfg(target_os = "windows")]
const FIXED_WEBVIEW2_DIRECTORY: &str = "webview2-runtime";

#[cfg(target_os = "windows")]
fn bundled_webview2_runtime(executable: &std::path::Path) -> Option<std::path::PathBuf> {
    let runtime = executable.parent()?.join(FIXED_WEBVIEW2_DIRECTORY);
    let executable_exists = runtime.join("msedgewebview2.exe").is_file();
    let engine_exists = runtime.join("msedge.dll").is_file();
    (executable_exists && engine_exists).then_some(runtime)
}

#[cfg(target_os = "windows")]
fn configure_bundled_webview2_runtime() {
    if std::env::var_os("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER").is_some() {
        return;
    }
    let Ok(executable) = std::env::current_exe() else {
        return;
    };
    if let Some(runtime) = bundled_webview2_runtime(&executable) {
        std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", runtime);
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, TRAY_SHOW_ID, "显示窗口", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, TRAY_HIDE_ID, "隐藏窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
    let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

    TrayIconBuilder::with_id("capacity")
        .icon(icon)
        .tooltip("QuoDex")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id() == TRAY_SHOW_ID {
                show_main_window(app);
            } else if event.id() == TRAY_HIDE_ID {
                hide_main_window(app);
            } else if event.id() == TRAY_QUIT_ID {
                app.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[tauri::command]
async fn read_capacity_snapshot(
    service: State<'_, CapacityService>,
) -> Result<CapacitySnapshot, Diagnostic> {
    service.read_snapshot().await
}

#[tauri::command]
async fn read_tomato_connection(
    service: State<'_, TomatoCloudService>,
) -> Result<TomatoConnectionSnapshot, Diagnostic> {
    Ok(service.read_connection().await)
}

#[tauri::command]
async fn read_zcode_quota_snapshot(
    service: State<'_, ZCodeQuotaService>,
    preferred_plan: Option<String>,
) -> Result<ZCodeQuotaSnapshot, Diagnostic> {
    // "coding" = 用户在设置中选择了仅个人套餐，跳过体验套餐探测
    let prefer_start = preferred_plan.as_deref() != Some("coding");
    service.read_snapshot(prefer_start).await
}

#[tauri::command]
fn load_display_preferences(store: State<'_, PreferencesStore>) -> DisplayPreferences {
    store.load()
}

#[tauri::command]
fn save_display_preferences(
    store: State<'_, PreferencesStore>,
    mut preferences: DisplayPreferences,
) -> Result<(), Diagnostic> {
    let current = store.load();
    preferences.x = current.x;
    preferences.y = current.y;
    store.save(preferences)
}

#[tauri::command]
async fn enable_temporary_click_through(
    window: WebviewWindow,
    duration_ms: u64,
) -> Result<(), Diagnostic> {
    if !(1_000..=30_000).contains(&duration_ms) {
        return Err(Diagnostic::new(
            "CRV-305",
            "鼠标穿透时长必须在 1 到 30 秒之间",
        ));
    }

    window.set_ignore_cursor_events(true).map_err(|error| {
        Diagnostic::new("CRV-306", "无法启用鼠标穿透").with_detail(error.to_string())
    })?;
    let recovery_window = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(duration_ms)).await;
        let _ = recovery_window.set_ignore_cursor_events(false);
    });
    Ok(())
}

/// 退出应用（设置面板退出按钮）。macOS 无 Dock 图标且窗口无边框，
/// 除托盘菜单外这是唯一的可见退出入口；窗口关闭仅隐藏到托盘。
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    configure_bundled_webview2_runtime();

    // macOS 的 set_activation_policy 需要 mut；其余平台不使用，抑制 unused_mut
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut app = tauri::Builder::default()
        .manage(CapacityService::from_environment())
        .manage(TomatoCloudService::new())
        .manage(ZCodeQuotaService::from_environment())
        .setup(|app| {
            #[cfg(all(target_os = "windows", not(debug_assertions)))]
            if let Err(error) = desktop_shortcut::replace_desktop_shortcut() {
                eprintln!("failed to create the QuoDex desktop shortcut: {error}");
            }
            let store = PreferencesStore::new(app.handle());
            if let Some(window) = app.get_webview_window("main") {
                restore_window_position(&window, &store);
            }
            setup_tray(app)?;
            app.manage(store);
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Moved(position) => {
                let _ = window
                    .state::<PreferencesStore>()
                    .update_position(*position);
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            read_capacity_snapshot,
            read_tomato_connection,
            read_zcode_quota_snapshot,
            load_display_preferences,
            save_display_preferences,
            enable_temporary_click_through,
            quit_app
        ])
        .build(tauri::generate_context!())
        .expect("failed to build QuoDex");

    // skipTaskbar 在 macOS 的等价物：不进 Dock，只保留菜单栏托盘图标
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    app.run(|_, event| {
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = event
        {
            api.prevent_exit();
        }
    });
}

#[cfg(all(test, target_os = "windows"))]
mod webview2_tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn finds_only_a_complete_runtime_next_to_the_portable_executable() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("crv-webview2-{unique}"));
        let executable = root.join("QuoDex.exe");
        let runtime = root.join(FIXED_WEBVIEW2_DIRECTORY);
        fs::create_dir_all(&runtime).expect("runtime directory");
        fs::write(&executable, []).expect("portable executable fixture");

        assert_eq!(bundled_webview2_runtime(&executable), None);
        fs::write(runtime.join("msedgewebview2.exe"), []).expect("runtime executable fixture");
        assert_eq!(bundled_webview2_runtime(&executable), None);
        fs::write(runtime.join("msedge.dll"), []).expect("runtime engine fixture");
        assert_eq!(bundled_webview2_runtime(&executable), Some(runtime));

        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn distribution_identity_and_taskbar_contract_are_stable() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("valid tauri configuration");
        assert_eq!(config["identifier"], "io.github.bandit.codexmeter");
        assert_eq!(config["app"]["windows"][0]["skipTaskbar"], true);
    }
}

mod capacity;
#[cfg(all(target_os = "windows", any(not(debug_assertions), test)))]
mod desktop_shortcut;
mod platform;
mod preferences;
mod task_material;
mod task_status;
mod tomato_cloud;
mod usage_ledger;
mod usage_server;
mod usage_service;
mod usage_sources;
mod usage_sync;
mod sync_engine;
mod baidu_sync;
mod sync_runtime;
mod window_pin;
mod window_input;
mod zcode_quota;
mod zcode_resets;
mod zcode_tasks;

use capacity::{CapacityService, CapacitySnapshot, Diagnostic};
use preferences::{restore_window_position, DisplayPreferences, PreferencesStore};
use task_status::{TaskStatusService, TaskStatusSnapshot};
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
fn read_task_status(service: State<'_, TaskStatusService>) -> TaskStatusSnapshot {
    service.read_snapshot()
}

#[tauri::command]
fn dismiss_task_failure(
    service: State<'_, TaskStatusService>,
    id: String,
    turn_id: String,
) -> Result<(), Diagnostic> {
    service.dismiss_failure(&id, &turn_id)
}

#[tauri::command]
fn open_codex_chat(id: String) -> Result<(), Diagnostic> {
    let id = uuid::Uuid::parse_str(&id)
        .map_err(|_| Diagnostic::new("QDT-611", "聊天标识无效；请等待状态刷新后重试"))?;
    open::that(format!("codex://threads/{id}")).map_err(|_| {
        Diagnostic::new(
            "QDT-611",
            "无法打开 Codex 聊天；请确认 Codex 桌面应用已安装并注册链接",
        )
    })
}

#[tauri::command]
fn open_task_chat(service: State<'_, TaskStatusService>, id: String) -> Result<(), Diagnostic> {
    if id.starts_with("zcode:") {
        let url = service.zcode_project_url(&id)?;
        open::that(url.as_str()).map_err(|_| {
            Diagnostic::new(
                "QDT-624",
                "无法打开 ZCode 项目；确认 ZCode 已安装并注册链接",
            )
        })
    } else {
        open_codex_chat(id)
    }
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
    preferred_plan: Option<preferences::ZCodePlanSelection>,
) -> Result<ZCodeQuotaSnapshot, Diagnostic> {
    // Coding = 用户在设置中选择了仅个人套餐，跳过体验套餐探测
    let prefer_start = preferred_plan != Some(preferences::ZCodePlanSelection::Coding);
    service.read_snapshot(prefer_start).await
}

#[tauri::command]
fn load_display_preferences(store: State<'_, PreferencesStore>) -> DisplayPreferences {
    store.load()
}

#[tauri::command]
async fn save_display_preferences(
    window: WebviewWindow,
    store: State<'_, PreferencesStore>,
    preferences: DisplayPreferences,
) -> Result<(), Diagnostic> {
    window_pin::save(&window, &store, preferences).await
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

    let (tx, rx) = tokio::sync::oneshot::channel();
    let native = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(window_input::temporary(&native, duration_ms));
        })
        .map_err(|_| Diagnostic::new("CRV-306", "无法启用鼠标穿透"))?;
    rx.await
        .map_err(|_| Diagnostic::new("CRV-306", "鼠标穿透更新中断"))??;
    Ok(())
}

/// 退出应用（设置面板退出按钮）。macOS 无 Dock 图标且窗口无边框，
/// 除托盘菜单外这是唯一的可见退出入口；窗口关闭仅隐藏到托盘。
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// 用量统计入口：确保本机只读服务已启动，并把页面交给系统默认浏览器。
/// 准备失败报 QUT-701，派发失败报 QUT-702；网页自身的诊断走 QDU-7xx。
#[tauri::command]
async fn usage_page_open(app: AppHandle, runtime: State<'_, UsageRuntime>, sync: State<'_, std::sync::Arc<sync_runtime::SyncRuntime>>) -> Result<String, Diagnostic> {
    let needs_start = runtime
        .server
        .lock()
        .expect("usage server lock")
        .is_none();
    if needs_start {
        let actions = sync_actions(app, sync.inner().clone());
        let server = usage_server::UsageServer::start_with_sync(std::sync::Arc::clone(&runtime.service), Some(actions)).await?;
        *runtime.server.lock().expect("usage server lock") = Some(server);
    }
    let url = runtime
        .server
        .lock()
        .expect("usage server lock")
        .as_ref()
        .expect("usage server present")
        .url
        .clone();
    open::that(&url).map_err(|error| {
        Diagnostic::new("QUT-702", "无法打开默认浏览器；请检查系统默认浏览器后重试")
            .with_detail(error.to_string())
    })?;
    Ok(url)
}

/// 用量统计运行时：共享采集服务与懒启动的本机服务。
struct UsageRuntime {
    service: std::sync::Arc<usage_service::UsageService>,
    server: std::sync::Mutex<Option<usage_server::UsageServer>>,
}

fn open_sync_settings(app: &AppHandle) -> Result<(), Diagnostic> {
    if let Some(window) = app.get_webview_window("sync-settings") {
        window.show().and_then(|_| window.set_focus()).map_err(|_| Diagnostic::new("QDS-113", "无法显示同步设置；请重启 QuoDex"))?;
        return Ok(());
    }
    let builder = tauri::WebviewWindowBuilder::new(app, "sync-settings", tauri::WebviewUrl::App("index.html?view=sync".into()))
        .title("QuoDex · 个人账本同步").inner_size(720.0, 720.0).min_inner_size(390.0, 560.0)
        .resizable(true);
    // WebView2 >=150 ignores environment browser flags in elevated test runners.
    // Use its explicit API only in debug builds with an isolated QA config directory.
    #[cfg(all(debug_assertions,target_os="windows"))]
    let builder = match (std::env::var("QUODEX_QA_CDP_PORT").ok().and_then(|p|p.parse::<u16>().ok()).filter(|p|*p>0),std::env::var_os("CODEX_CREDITS_CONFIG_DIR")) {
        (Some(port),Some(dir)) => builder.additional_browser_args(&format!("--remote-debugging-address=127.0.0.1 --remote-debugging-port={port}"))
            .data_directory(std::path::PathBuf::from(dir).join("qa-sync-webview")),
        _=>builder,
    };
    builder.build().map_err(|_| Diagnostic::new("QDS-113", "无法打开同步设置；请重启 QuoDex"))?;
    Ok(())
}
fn sync_actions(app: AppHandle, sync: std::sync::Arc<sync_runtime::SyncRuntime>) -> usage_server::SyncActions {
    // The HTTP bridge runs this on a blocking worker. Creating WebView2 from a
    // main-thread event handler deadlocks on Windows (Tauri builder contract).
    usage_server::SyncActions::new(sync, move || open_sync_settings(&app))
}

fn sync_window(window: &WebviewWindow) -> Result<(), Diagnostic> {
    if window.label() == "sync-settings" { Ok(()) } else { Err(Diagnostic::new("QDS-113", "请从同步设置窗口操作")) }
}
#[tauri::command]
fn sync_read(window: WebviewWindow, runtime: State<'_, std::sync::Arc<sync_runtime::SyncRuntime>>) -> Result<sync_runtime::SyncView, Diagnostic> {
    sync_window(&window)?; Ok(runtime.view())
}
#[tauri::command]
fn sync_connect(window: WebviewWindow, runtime: State<'_, std::sync::Arc<sync_runtime::SyncRuntime>>, app_key: String, secret_key: String, folder: String) -> Result<(), Diagnostic> {
    sync_window(&window)?; runtime.connect(app_key, secret_key, folder)
}
#[tauri::command]
fn sync_disconnect(window: WebviewWindow, runtime: State<'_, std::sync::Arc<sync_runtime::SyncRuntime>>) -> Result<(), Diagnostic> {
    sync_window(&window)?; runtime.disconnect()
}
#[tauri::command]
fn sync_now(window: WebviewWindow, runtime: State<'_, std::sync::Arc<sync_runtime::SyncRuntime>>) -> Result<(), Diagnostic> {
    sync_window(&window)?; runtime.synchronize()
}
#[tauri::command]
fn sync_authorize_open(window: WebviewWindow, runtime: State<'_, std::sync::Arc<sync_runtime::SyncRuntime>>) -> Result<(), Diagnostic> {
    sync_window(&window)?;
    let url=runtime.view().authorization_url.ok_or_else(||Diagnostic::new("QDS-101","请先生成设备码"))?;
    open::that(url).map_err(|_|Diagnostic::new("QDS-113","无法打开百度授权页；请检查默认浏览器"))
}

fn usage_home_dir() -> std::path::PathBuf {
    std::env::var_os("ZCODE_DATA_BASE_DIR")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .or_else(|| std::env::var_os("HOME"))
        .map(std::path::PathBuf::from)
        .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    configure_bundled_webview2_runtime();

    let app = tauri::Builder::default()
        .manage(CapacityService::from_environment())
        .manage(TomatoCloudService::new())
        .manage(ZCodeQuotaService::from_environment())
        .manage(window_pin::WindowPinState::default())
        .setup(|app| {
            // Agent application policy allows a floating window to join another app's Space.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            #[cfg(all(target_os = "windows", not(debug_assertions)))]
            if let Err(error) = desktop_shortcut::replace_desktop_shortcut() {
                eprintln!("failed to create the QuoDex desktop shortcut: {error}");
            }
            let store = PreferencesStore::new(app.handle());
            app.manage(store);
            app.manage(TaskStatusService::from_environment(app.handle()));
            if let Some(window) = app.get_webview_window("main") {
                let store = window.state::<PreferencesStore>();
                window_pin::initialize(&window, store.load().always_on_top);
                restore_window_position(&window, &store);
                platform::enable_hover_mouse_moves(&window);
            }
            // 用量统计：账本落在配置目录，来源按本机 home 解析；启动即开始采集，
            // 本机只读服务随之常驻（127.0.0.1 随机端口），入口点击仅在未就绪时兜底。
            let config_dir = std::env::var_os("CODEX_CREDITS_CONFIG_DIR")
                .map(std::path::PathBuf::from)
                .or_else(|| app.path().app_config_dir().ok())
                .unwrap_or_else(|| std::path::PathBuf::from("."));
            let usage_service = std::sync::Arc::new(usage_service::UsageService::new(
                usage_home_dir(),
                config_dir.join("usage-ledger.sqlite"),
            ));
            let _ = usage_service.spawn_refresh_loop();
            let sync = sync_runtime::SyncRuntime::start(usage_service.clone(), &config_dir);
            app.manage(sync.clone());
            app.manage(UsageRuntime {
                service: usage_service.clone(),
                server: std::sync::Mutex::new(None),
            });
            let usage_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let actions = sync_actions(usage_handle.clone(), sync);
                match usage_server::UsageServer::start_with_sync(usage_service, Some(actions)).await {
                    Ok(server) => {
                        if let Some(path)=std::env::var_os("QUODEX_USAGE_URL_FILE") { let _=std::fs::write(path,&server.url); }
                        *usage_handle
                            .state::<UsageRuntime>()
                            .server
                            .lock()
                            .expect("usage server lock") = Some(server);
                    }
                    Err(diagnostic) => {
                        eprintln!("usage page server failed to start: {diagnostic}");
                    }
                }
            });
            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| { if window.label() != "main" { return; } match event {
            WindowEvent::Moved(position) => {
                let _ = window
                    .state::<PreferencesStore>()
                    .update_position(*position);
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Focused(focused) => {
                if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                    window_pin::export_diagnostics(
                        &webview,
                        if *focused {
                            "focus-gained"
                        } else {
                            "focus-lost"
                        },
                    );
                }
            }
            _ => {}
        }})
        .invoke_handler(tauri::generate_handler![
            read_task_status,
            task_material::set_task_material_regions,
            platform::is_cursor_inside_window,
            platform::cursor_viewport_position,
            dismiss_task_failure,
            open_codex_chat,
            open_task_chat,
            read_capacity_snapshot,
            read_tomato_connection,
            read_zcode_quota_snapshot,
            load_display_preferences,
            save_display_preferences,
            window_pin::read_window_pin_diagnostics,
            window_pin::read_window_pin_startup_diagnostic,
            enable_temporary_click_through,
            usage_page_open,
            sync_read,
            sync_connect,
            sync_disconnect,
            sync_now,
            sync_authorize_open,
            quit_app
        ])
        .build(tauri::generate_context!())
        .expect("failed to build QuoDex");

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

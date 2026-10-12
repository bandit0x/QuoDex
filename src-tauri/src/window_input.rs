//! One owner for automatic transparent-area input and temporary whole-window pass-through.
use crate::{capacity::Diagnostic, task_material::MaterialRegion};
#[cfg(any(target_os = "macos", windows, test))]
use std::time::Instant;
use tauri::WebviewWindow;

#[cfg(any(target_os = "macos", windows, test))]
#[derive(Default)]
struct InputPolicy {
    version: u64,
    regions: Option<Vec<MaterialRegion>>,
    manual_until: Option<Instant>,
    captured: bool,
}

#[cfg(any(target_os = "macos", windows, test))]
impl InputPolicy {
    fn update_regions(&mut self, version: u64, regions: &[MaterialRegion]) -> bool {
        if self.regions.is_none() || version > self.version {
            self.version = version;
            self.regions = Some(regions.to_vec());
            true
        } else {
            false
        }
    }

    fn ignores_mouse(&self, point: (f64, f64), now: Instant) -> bool {
        if self.manual_until.is_some_and(|deadline| now < deadline) {
            return true;
        }
        if self.captured {
            return false;
        }
        self.regions
            .as_ref()
            .is_some_and(|regions| !regions.iter().any(|r| contains(r, point)))
    }
}

#[cfg(any(target_os = "macos", windows, test))]
fn contains(r: &MaterialRegion, (x, y): (f64, f64)) -> bool {
    if x < r.x || y < r.y || x >= r.x + r.width || y >= r.y + r.height {
        return false;
    }
    let cx = x.clamp(r.x + r.radius, r.x + r.width - r.radius);
    let cy = y.clamp(r.y + r.radius, r.y + r.height - r.radius);
    (x - cx).powi(2) + (y - cy).powi(2) <= r.radius.powi(2)
}

pub(crate) fn update_regions(
    window: &WebviewWindow,
    version: u64,
    regions: &[MaterialRegion],
) -> Result<bool, Diagnostic> {
    #[cfg(any(target_os = "macos", windows))]
    {
        native::update_regions(window, version, regions)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (window, version, regions);
        Ok(true)
    }
}

pub(crate) fn temporary(window: &WebviewWindow, duration_ms: u64) -> Result<(), Diagnostic> {
    #[cfg(any(target_os = "macos", windows))]
    {
        native::temporary(window, duration_ms)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        window.set_ignore_cursor_events(true).map_err(|error| {
            Diagnostic::new("CRV-306", "无法启用鼠标穿透").with_detail(error.to_string())
        })?;
        let recovery = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(duration_ms)).await;
            let _ = recovery.set_ignore_cursor_events(false);
        });
        Ok(())
    }
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::{cell::RefCell, time::Duration};
    use tauri::Emitter;
    use windows::Win32::{
        Foundation::{
            GetLastError, SetLastError, ERROR_SUCCESS, HWND, LPARAM, LRESULT, POINT, WPARAM,
        },
        Graphics::Gdi::ScreenToClient,
        UI::{
            HiDpi::GetDpiForWindow,
            Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON},
            WindowsAndMessaging::{
                CallNextHookEx, GetAncestor, GetCursorPos, GetWindowLongPtrW, SetWindowLongPtrW,
                SetWindowsHookExW, UnhookWindowsHookEx, WindowFromPoint, GA_ROOT, GWL_EXSTYLE,
                HHOOK, MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN,
                WM_MBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP, WS_EX_LAYERED, WS_EX_TRANSPARENT,
            },
        },
    };

    #[derive(Default)]
    struct InputState {
        policy: InputPolicy,
        window: Option<WebviewWindow>,
        hwnd: Option<HWND>,
        hook: Option<HHOOK>,
        original_layered: bool,
        reported_failure: bool,
    }

    impl Drop for InputState {
        fn drop(&mut self) {
            if let Some(hook) = self.hook.take() {
                // SAFETY: This handle belongs to this thread-local owner and is
                // unhooked once, before the retained window is released.
                unsafe {
                    let _ = UnhookWindowsHookEx(hook);
                }
            }
        }
    }

    thread_local! { static INPUT: RefCell<InputState> = RefCell::new(InputState::default()); }

    fn failure(reason: &str) -> Diagnostic {
        Diagnostic::new("QDT-634", format!("{reason}；请重新打开 QuoDex"))
    }

    // Geometry updates and hook callbacks all run on Tauri's UI thread. The hook
    // reconciles before Windows routes the input, so a fast first click cannot
    // land on stale rectangular padding. It never consumes or records events.
    fn refresh(event: Option<(u32, POINT)>) -> Result<bool, Diagnostic> {
        let (hwnd, original_layered) = INPUT.with(|state| {
            let state = state.borrow();
            (state.hwnd, state.original_layered)
        });
        let hwnd = hwnd.ok_or_else(|| failure("Windows 输入窗口尚未就绪"))?;
        // SAFETY: The retained window supplies the HWND; all calls are made on
        // its UI thread. Win32 coordinate outputs are valid stack storage and
        // fallible operations are checked before their results are used.
        unsafe {
            let (kind, desktop) = match event {
                Some(event) => event,
                None => {
                    let mut point = POINT::default();
                    GetCursorPos(&mut point)
                        .map_err(|e| failure("无法读取系统指针").with_detail(e.to_string()))?;
                    (0, point)
                }
            };
            let mut point = desktop;
            if !ScreenToClient(hwnd, &mut point).as_bool() {
                return Err(failure("无法转换 Windows 输入坐标"));
            }
            let dpi = GetDpiForWindow(hwnd);
            if dpi == 0 {
                return Err(failure("无法读取窗口缩放比例"));
            }
            let scale = f64::from(dpi) / 96.0;
            let pressed = matches!(kind, WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN);
            // Low-level hooks run before asynchronous key state is updated.
            let released_key = match kind {
                WM_LBUTTONUP => Some(VK_LBUTTON),
                WM_RBUTTONUP => Some(VK_RBUTTON),
                WM_MBUTTONUP => Some(VK_MBUTTON),
                _ => None,
            };
            let held = [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON]
                .iter()
                .any(|key| Some(*key) != released_key && GetAsyncKeyState(i32::from(key.0)) < 0);
            let ignored = INPUT.with(|state| {
                let mut state = state.borrow_mut();
                if !pressed && !held {
                    state.policy.captured = false;
                }
                state.policy.ignores_mouse(
                    (f64::from(point.x) / scale, f64::from(point.y) / scale),
                    Instant::now(),
                )
            });
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let bits = (WS_EX_TRANSPARENT | WS_EX_LAYERED).0 as isize;
            let desired = if ignored {
                style | bits
            } else {
                (style & !bits)
                    | if original_layered {
                        WS_EX_LAYERED.0 as isize
                    } else {
                        0
                    }
            };
            if desired != style {
                SetLastError(ERROR_SUCCESS);
                let previous = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, desired);
                let error = GetLastError();
                if previous == 0 && error != ERROR_SUCCESS {
                    return Err(failure("系统未接受鼠标穿透状态").with_detail(error.0.to_string()));
                }
                if GetWindowLongPtrW(hwnd, GWL_EXSTYLE) != desired {
                    return Err(failure("Windows 鼠标穿透状态未生效"));
                }
            }
            // Capture only a press delivered to our own visible controls. Native
            // and DOM dragging keep receiving input until the button is released.
            if pressed && !ignored && GetAncestor(WindowFromPoint(desktop), GA_ROOT) == hwnd {
                INPUT.with(|state| state.borrow_mut().policy.captured = true);
            }
            Ok(ignored)
        }
    }

    fn report(error: Diagnostic) {
        let window = INPUT.with(|state| {
            let mut state = state.borrow_mut();
            if state.reported_failure {
                return None;
            }
            state.reported_failure = true;
            state.window.clone()
        });
        // Emitting can enter the WebView's event machinery. Release the state
        // borrow first so a reentrant system callback cannot borrow it twice.
        if let Some(window) = window {
            let _ = window.emit("window-input-error", error);
        }
    }

    unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            // SAFETY: Windows supplies an MSLLHOOKSTRUCT for a non-negative
            // low-level mouse callback; the pointer is used only in this call.
            let event = &*(lparam.0 as *const MSLLHOOKSTRUCT);
            if let Err(error) = refresh(Some((wparam.0 as u32, event.pt))) {
                report(error);
            }
        }
        // SAFETY: Forward the original callback arguments without consuming input.
        CallNextHookEx(None, code, wparam, lparam)
    }

    fn ensure_started(window: &WebviewWindow) -> Result<(), Diagnostic> {
        if INPUT.with(|state| state.borrow().hook.is_some()) {
            return Ok(());
        }
        let hwnd = HWND(
            window
                .hwnd()
                .map_err(|e| failure("无法连接 Windows 输入窗口").with_detail(e.to_string()))?
                .0,
        );
        INPUT.with(|state| {
            let mut state = state.borrow_mut();
            state.hwnd = Some(hwnd);
            state.window = Some(window.clone());
            // SAFETY: HWND was just obtained from the live window on its UI thread.
            state.original_layered =
                unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_LAYERED.0 as isize != 0 };
        });
        // SAFETY: The callback lives for the process lifetime and this UI thread
        // has Tauri's message loop. The owned hook is released on thread teardown.
        let hook = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), None, 0) }
            .map_err(|e| failure("系统未能创建鼠标输入监听").with_detail(e.to_string()))?;
        INPUT.with(|state| state.borrow_mut().hook = Some(hook));
        // Stationary-pointer layout changes, DPI/position changes, and manual
        // timeout expiry also need reconciliation without another mouse event.
        let window = window.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(32));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                if window
                    .run_on_main_thread(|| {
                        if let Err(error) = refresh(None) {
                            report(error);
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
        Ok(())
    }

    pub(super) fn update_regions(
        window: &WebviewWindow,
        version: u64,
        regions: &[MaterialRegion],
    ) -> Result<bool, Diagnostic> {
        ensure_started(window)?;
        let accepted =
            INPUT.with(|state| state.borrow_mut().policy.update_regions(version, regions));
        refresh(None)?;
        Ok(accepted)
    }

    pub(super) fn temporary(window: &WebviewWindow, duration_ms: u64) -> Result<(), Diagnostic> {
        ensure_started(window)?;
        INPUT.with(|state| {
            state.borrow_mut().policy.manual_until =
                Some(Instant::now() + Duration::from_millis(duration_ms))
        });
        refresh(None).map(|_| ())
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use block2::RcBlock;
    use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
    use objc2_foundation::{NSPoint, NSRect};
    use std::{cell::RefCell, time::Duration};
    use tauri::Emitter;

    #[derive(Default)]
    struct InputState {
        policy: InputPolicy,
        monitors: Vec<Retained<AnyObject>>,
        reported_failure: bool,
    }
    thread_local! { static INPUT: RefCell<InputState> = RefCell::new(InputState::default()); }

    fn failure(reason: &str) -> Diagnostic {
        Diagnostic::new("QDT-632", format!("{reason}；请重新打开 QuoDex"))
    }

    const LEFT_MOUSE_DOWN: usize = 1;
    const LEFT_MOUSE_UP: usize = 2;
    const RIGHT_MOUSE_DOWN: usize = 3;
    const RIGHT_MOUSE_UP: usize = 4;
    const MOUSE_MOVED: usize = 5;
    const LEFT_MOUSE_DRAGGED: usize = 6;
    const RIGHT_MOUSE_DRAGGED: usize = 7;
    const OTHER_MOUSE_DOWN: usize = 25;
    const OTHER_MOUSE_UP: usize = 26;
    const OTHER_MOUSE_DRAGGED: usize = 27;

    // All callers and AppKit event-monitor callbacks run on the main thread.
    fn refresh(window: &WebviewWindow) -> Result<bool, Diagnostic> {
        let ns = window
            .ns_window()
            .map_err(|error| failure("无法连接 macOS 输入窗口").with_detail(error.to_string()))?
            as *mut AnyObject;
        let root = window
            .ns_view()
            .map_err(|error| failure("无法读取 WebView 坐标").with_detail(error.to_string()))?
            as *mut AnyObject;
        if ns.is_null() || root.is_null() {
            return Err(failure("macOS 输入窗口尚未就绪"));
        }
        unsafe {
            let mouse: NSPoint = msg_send![class!(NSEvent), mouseLocation];
            let local: NSPoint = msg_send![ns, convertPointFromScreen: mouse];
            let local: NSPoint =
                msg_send![root, convertPoint: local, fromView: std::ptr::null::<AnyObject>()];
            let bounds: NSRect = msg_send![root, bounds];
            let flipped: bool = msg_send![root, isFlipped];
            let point = (
                local.x - bounds.origin.x,
                if flipped {
                    local.y - bounds.origin.y
                } else {
                    bounds.origin.y + bounds.size.height - local.y
                },
            );
            let buttons: usize = msg_send![class!(NSEvent), pressedMouseButtons];
            let ignored = INPUT.with(|state| {
                let mut state = state.borrow_mut();
                if buttons == 0 {
                    state.policy.captured = false;
                }
                state.policy.ignores_mouse(point, Instant::now())
            });
            let current: bool = msg_send![ns, ignoresMouseEvents];
            if current != ignored {
                let _: () = msg_send![ns, setIgnoresMouseEvents: ignored];
                let actual: bool = msg_send![ns, ignoresMouseEvents];
                if actual != ignored {
                    return Err(failure("系统未接受鼠标穿透状态"));
                }
            }
            Ok(ignored)
        }
    }

    fn refresh_or_report(window: &WebviewWindow) {
        if let Err(error) = refresh(window) {
            INPUT.with(|state| {
                let mut state = state.borrow_mut();
                if !state.reported_failure {
                    state.reported_failure = true;
                    let _ = window.emit("window-input-error", error);
                }
            });
        }
    }

    fn ensure_started(window: &WebviewWindow) -> Result<(), Diagnostic> {
        if INPUT.with(|state| !state.borrow().monitors.is_empty()) {
            return Ok(());
        }
        // Global movement wakes the window even while it ignores events. Local movement
        // switches it back to pass-through before a click in its transparent padding.
        let global_window = window.clone();
        let global = RcBlock::new(move |_event: *mut AnyObject| {
            refresh_or_report(&global_window);
        });
        let local_window = window.clone();
        let local = RcBlock::new(move |event: *mut AnyObject| -> *mut AnyObject {
            // Only capture a press that starts in an accepted control. A stale
            // local mouseDown in transparent padding must not lock that padding.
            let accepts = matches!(refresh(&local_window), Ok(false));
            unsafe {
                let event_window: *mut AnyObject = msg_send![event, window];
                let ours = local_window.ns_window().ok().map(|p| p as *mut AnyObject);
                let kind: usize = msg_send![event, type];
                if accepts
                    && ours == Some(event_window)
                    && matches!(kind, LEFT_MOUSE_DOWN | RIGHT_MOUSE_DOWN | OTHER_MOUSE_DOWN)
                {
                    INPUT.with(|state| state.borrow_mut().policy.captured = true);
                }
            }
            refresh_or_report(&local_window);
            event
        });
        let mask = [
            LEFT_MOUSE_DOWN,
            LEFT_MOUSE_UP,
            RIGHT_MOUSE_DOWN,
            RIGHT_MOUSE_UP,
            MOUSE_MOVED,
            LEFT_MOUSE_DRAGGED,
            RIGHT_MOUSE_DRAGGED,
            OTHER_MOUSE_DOWN,
            OTHER_MOUSE_UP,
            OTHER_MOUSE_DRAGGED,
        ]
        .into_iter()
        .fold(0u64, |mask, kind| mask | (1u64 << kind));
        unsafe {
            let global: Option<Retained<AnyObject>> = msg_send![class!(NSEvent), addGlobalMonitorForEventsMatchingMask: mask, handler: &*global];
            let local: Option<Retained<AnyObject>> = msg_send![class!(NSEvent), addLocalMonitorForEventsMatchingMask: mask, handler: &*local];
            match (global, local) {
                (Some(global), Some(local)) => {
                    INPUT.with(|state| state.borrow_mut().monitors = vec![global, local])
                }
                (global, local) => {
                    for monitor in global.into_iter().chain(local) {
                        let _: () = msg_send![class!(NSEvent), removeMonitor: &*monitor];
                    }
                    return Err(failure("系统未能创建鼠标移动监听"));
                }
            }
        }
        // Movement/resize under a stationary pointer and manual timeout expiry also
        // need reconciliation. No accessibility/event-tap permission is required.
        let window = window.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(32));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                let next = window.clone();
                if window
                    .run_on_main_thread(move || refresh_or_report(&next))
                    .is_err()
                {
                    break;
                }
            }
        });
        Ok(())
    }

    pub(super) fn update_regions(
        window: &WebviewWindow,
        version: u64,
        regions: &[MaterialRegion],
    ) -> Result<bool, Diagnostic> {
        ensure_started(window)?;
        let accepted =
            INPUT.with(|state| state.borrow_mut().policy.update_regions(version, regions));
        refresh(window)?;
        Ok(accepted)
    }

    pub(super) fn temporary(window: &WebviewWindow, duration_ms: u64) -> Result<(), Diagnostic> {
        ensure_started(window)?;
        INPUT.with(|state| {
            state.borrow_mut().policy.manual_until =
                Some(Instant::now() + Duration::from_millis(duration_ms))
        });
        refresh(window).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn strip() -> MaterialRegion {
        MaterialRegion {
            x: 10.,
            y: 180.,
            width: 200.,
            height: 30.,
            radius: 15.,
        }
    }
    fn detail() -> MaterialRegion {
        MaterialRegion {
            x: 10.,
            y: 10.,
            width: 200.,
            height: 160.,
            radius: 18.,
        }
    }

    #[test]
    fn closed_detail_passes_clicks_through_and_stale_geometry_cannot_reopen_it() {
        let now = Instant::now();
        let mut input = InputPolicy::default();
        input.update_regions(1, &[strip(), detail()]);
        assert!(!input.ignores_mouse((100., 80.), now));
        input.update_regions(2, &[strip()]);
        assert!(input.ignores_mouse((100., 80.), now));
        assert!(!input.update_regions(1, &[strip(), detail()]));
        assert!(input.ignores_mouse((100., 80.), now));
        assert!(!input.ignores_mouse((100., 195.), now));
        assert!(input.ignores_mouse((10., 180.), now));
    }

    #[test]
    fn manual_pass_through_wins_and_expiry_restores_automatic_regions() {
        let now = Instant::now();
        let mut input = InputPolicy::default();
        input.update_regions(1, &[strip()]);
        input.captured = true;
        assert!(!input.ignores_mouse((100., 80.), now));
        input.manual_until = Some(now + std::time::Duration::from_secs(10));
        assert!(input.ignores_mouse((100., 195.), now));
        input.captured = false;
        let expired = now + std::time::Duration::from_secs(11);
        assert!(!input.ignores_mouse((100., 195.), expired));
        assert!(input.ignores_mouse((100., 80.), expired));
    }
}

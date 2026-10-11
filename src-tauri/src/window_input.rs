//! One owner for automatic transparent-area input and temporary whole-window pass-through.
use crate::{capacity::Diagnostic, task_material::MaterialRegion};
#[cfg(any(target_os = "macos", test))]
use std::time::Instant;
use tauri::WebviewWindow;

#[cfg(any(target_os = "macos", test))]
#[derive(Default)]
struct InputPolicy {
    version: u64,
    regions: Option<Vec<MaterialRegion>>,
    manual_until: Option<Instant>,
    captured: bool,
}

#[cfg(any(target_os = "macos", test))]
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

#[cfg(any(target_os = "macos", test))]
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
    #[cfg(target_os = "macos")]
    {
        native::update_regions(window, version, regions)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, version, regions);
        Ok(true)
    }
}

pub(crate) fn temporary(window: &WebviewWindow, duration_ms: u64) -> Result<(), Diagnostic> {
    #[cfg(target_os = "macos")]
    {
        native::temporary(window, duration_ms)
    }
    #[cfg(not(target_os = "macos"))]
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

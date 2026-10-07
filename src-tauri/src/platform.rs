/// Executable names that differ per platform.
///
/// Windows bundles `curl.exe`; macOS and Linux ship `curl`. The same split
/// applies to the Codex CLI shipped by the `@openai/codex` npm package and by
/// common installers.
pub(crate) fn curl_executable() -> &'static str {
    if cfg!(windows) {
        "curl.exe"
    } else {
        "curl"
    }
}

pub(crate) fn codex_binary_name() -> &'static str {
    if cfg!(windows) {
        "codex.exe"
    } else {
        "codex"
    }
}

/// macOS only delivers `mouseMoved` to non-key windows when the NSWindow opts
/// in; WKWebView needs that stream to update hover state, so without it the
/// task strip never reacts when the pointer arrives from another app.
#[allow(unused_variables)]
pub(crate) fn enable_hover_mouse_moves(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        let ns_window = ns_window as *mut AnyObject;
        if ns_window.is_null() {
            return;
        }
        // SAFETY: setter on the live NSWindow handed out by Tauri; called from
        // the setup hook, which runs on the main thread.
        unsafe {
            let _: () = msg_send![ns_window, setAcceptsMouseMovedEvents: true];
        }
    }
}

/// Whether the system pointer currently sits inside this window's frame.
/// The webview stops receiving pointer events the moment the cursor leaves
/// for another app, so a native query is the only reliable "did it leave" test.
#[tauri::command]
pub fn is_cursor_inside_window(window: tauri::WebviewWindow) -> bool {
    cursor_viewport_position_impl(&window).is_some()
}

/// Cursor position in viewport points (top-left origin) while it hovers this
/// window; `None` when it is elsewhere. Both `NSEvent.mouseLocation` and the
/// window frame live in AppKit's global point space, so no scale conversion is
/// involved. Feeds the frontend hover compensation for the non-key overlay.
#[tauri::command]
pub fn cursor_viewport_position(window: tauri::WebviewWindow) -> Option<(f64, f64)> {
    cursor_viewport_position_impl(&window)
}

#[cfg(target_os = "macos")]
fn cursor_viewport_position_impl(window: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    use objc2::{class, msg_send, runtime::AnyObject};
    let Ok(ns_window) = window.ns_window() else {
        return None;
    };
    let ns_window = ns_window as *mut AnyObject;
    if ns_window.is_null() {
        return None;
    }
    // SAFETY: read-only queries on the live NSWindow; command runs on the main
    // thread per Tauri's command scheduling.
    unsafe {
        let frame: objc2_foundation::NSRect = msg_send![ns_window, frame];
        let mouse: objc2_foundation::NSPoint = msg_send![class!(NSEvent), mouseLocation];
        let x = mouse.x - frame.origin.x;
        let y = frame.origin.y + frame.size.height - mouse.y;
        if x < 0.0 || y < 0.0 || x > frame.size.width || y > frame.size.height {
            None
        } else {
            Some((x, y))
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn cursor_viewport_position_impl(_: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    None
}

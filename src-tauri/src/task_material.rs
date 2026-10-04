//! Native desktop backdrop, clipped to the task capsules and their detail popover.
use crate::capacity::Diagnostic;
use serde::Deserialize;
use tauri::WebviewWindow;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialRegion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub radius: f64,
}

fn validate(regions: &[MaterialRegion]) -> Result<(), Diagnostic> {
    if regions.len() > 16
        || regions.iter().any(|r| {
            [r.x, r.y, r.width, r.height, r.radius]
                .iter()
                .any(|n| !n.is_finite())
                || r.x < 0.0
                || r.y < 0.0
                || r.width <= 0.0
                || r.height <= 0.0
                || r.x + r.width > 1000.0
                || r.y + r.height > 1500.0
                || r.radius < 0.0
                || r.radius > r.width.min(r.height) / 2.0
        })
    {
        return Err(Diagnostic::new(
            "QDT-630",
            "任务材质区域无效；请重新打开 QuoDex",
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn set_task_material_regions(
    window: WebviewWindow,
    regions: Vec<MaterialRegion>,
    visible_regions: Vec<MaterialRegion>,
) -> Result<(), Diagnostic> {
    validate(&regions)?;
    validate(&visible_regions)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let native = window.clone();
    window
        .run_on_main_thread(move || {
            let result = apply(&native, &regions, &visible_regions);
            let _ = tx.send(result);
        })
        .map_err(|_| Diagnostic::new("QDT-631", "系统毛玻璃未能更新；请重新打开 QuoDex"))?;
    rx.await
        .map_err(|_| Diagnostic::new("QDT-631", "系统毛玻璃更新中断；请重新打开 QuoDex"))?
}

#[cfg(target_os = "macos")]
fn apply(
    window: &WebviewWindow,
    regions: &[MaterialRegion],
    _: &[MaterialRegion],
) -> Result<(), Diagnostic> {
    use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use std::cell::RefCell;
    thread_local! { static VIEWS: RefCell<Vec<Retained<AnyObject>>> = const { RefCell::new(Vec::new()) }; }
    let root = window
        .ns_view()
        .map_err(|_| Diagnostic::new("QDT-631", "无法连接 macOS 背景材质；请重新打开 QuoDex"))?
        as *mut AnyObject;
    if root.is_null() {
        return Err(Diagnostic::new(
            "QDT-631",
            "macOS 窗口尚未就绪；请重新打开 QuoDex",
        ));
    }
    // AppKit is only touched in the main-thread closure above. The parent retains each view;
    // our retained handles allow removing exactly our own views without disturbing WKWebView.
    unsafe {
        let bounds: NSRect = msg_send![root, bounds];
        let flipped: bool = msg_send![root, isFlipped];
        let mut next = Vec::with_capacity(regions.len());
        for r in regions {
            let origin_y = if flipped {
                r.y
            } else {
                bounds.size.height - r.y - r.height
            };
            let frame = NSRect::new(NSPoint::new(r.x, origin_y), NSSize::new(r.width, r.height));
            let allocated: *mut AnyObject = msg_send![class!(NSVisualEffectView), alloc];
            let view: *mut AnyObject = msg_send![allocated, initWithFrame: frame];
            let Some(view) = Retained::from_raw(view) else {
                return Err(Diagnostic::new(
                    "QDT-631",
                    "macOS 背景材质创建失败；请重新打开 QuoDex",
                ));
            };
            let _: () = msg_send![&*view, setMaterial: 13isize]; // HUDWindow, macOS 10.14+
            let _: () = msg_send![&*view, setBlendingMode: 0isize]; // behindWindow
            let _: () = msg_send![&*view, setState: 1isize]; // active even when floating window is unfocused
            let _: () = msg_send![&*view, setAlphaValue: 0.42f64];
            let mask_alloc: *mut AnyObject = msg_send![class!(NSImage), alloc];
            let mask: *mut AnyObject = msg_send![mask_alloc, initWithSize: frame.size];
            let Some(mask) = Retained::from_raw(mask) else {
                return Err(Diagnostic::new(
                    "QDT-631",
                    "macOS 材质遮罩创建失败；请重新打开 QuoDex",
                ));
            };
            let _: () = msg_send![&*mask, lockFocus];
            let color: *mut AnyObject = msg_send![class!(NSColor), blackColor];
            let _: () = msg_send![color, set];
            let mask_rect = NSRect::new(NSPoint::new(0.0, 0.0), frame.size);
            let path: *mut AnyObject = msg_send![class!(NSBezierPath), bezierPathWithRoundedRect: mask_rect, xRadius: r.radius, yRadius: r.radius];
            let _: () = msg_send![path, fill];
            let _: () = msg_send![&*mask, unlockFocus];
            let _: () = msg_send![&*view, setMaskImage: &*mask];
            next.push(view);
        }
        VIEWS.with(|views| {
            let mut views = views.borrow_mut();
            for view in views.drain(..) { let _: () = msg_send![&*view, removeFromSuperview]; }
            for view in &next { let _: () = msg_send![root, addSubview: &**view, positioned: -1isize, relativeTo: std::ptr::null::<AnyObject>()]; }
            *views = next;
        });
    }
    Ok(())
}

#[cfg(windows)]
fn apply(
    window: &WebviewWindow,
    regions: &[MaterialRegion],
    visible: &[MaterialRegion],
) -> Result<(), Diagnostic> {
    use tauri::window::{Color, Effect, EffectsBuilder};
    use windows::Win32::{
        Graphics::Gdi::{CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, SetWindowRgn, RGN_OR},
    };
    let error = || Diagnostic::new("QDT-631", "Windows 毛玻璃不可用；请检查系统透明效果设置");
    let hwnd = window.hwnd().map_err(|_| error())?;
    if regions.is_empty() {
        window.set_effects(None).map_err(|_| error())?;
        unsafe {
            if SetWindowRgn(hwnd, None, true) == 0 {
                return Err(error());
            }
        }
        return Ok(());
    }
    let scale = window.scale_factor().map_err(|_| error())?;
    // The system blur is window-wide. Its drawing region must exclude transparent gaps
    // while retaining the cockpit, settings, controls and popover hit targets.
    unsafe {
        let region = CreateRectRgn(0, 0, 0, 0);
        if region.0.is_null() {
            return Err(error());
        }
        for r in visible {
            let part = CreateRoundRectRgn(
                (r.x * scale).floor() as i32,
                (r.y * scale).floor() as i32,
                ((r.x + r.width) * scale).ceil() as i32,
                ((r.y + r.height) * scale).ceil() as i32,
                (r.radius * 2.0 * scale).round() as i32,
                (r.radius * 2.0 * scale).round() as i32,
            );
            if part.0.is_null() {
                let _ = DeleteObject(region.into());
                return Err(error());
            }
            let result = CombineRgn(Some(region), Some(region), Some(part), RGN_OR);
            let _ = DeleteObject(part.into());
            if result.0 == 0 {
                let _ = DeleteObject(region.into());
                return Err(error());
            }
        }
        if SetWindowRgn(hwnd, Some(region), true) == 0 {
            let _ = DeleteObject(region.into());
            return Err(error());
        }
        // Successful SetWindowRgn transfers ownership to Windows.
    }
    if window
        .set_effects(
            EffectsBuilder::new()
                .effect(Effect::Blur)
                .color(Color(16, 36, 50, 18))
                .build(),
        )
        .is_err()
    {
        unsafe {
            let _ = SetWindowRgn(hwnd, None, true);
        }
        return Err(error());
    }
    Ok(())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn apply(_: &WebviewWindow, _: &[MaterialRegion], _: &[MaterialRegion]) -> Result<(), Diagnostic> {
    Err(Diagnostic::new("QDT-631", "当前系统不支持任务毛玻璃材质"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_or_unbounded_material_geometry() {
        let mut r = MaterialRegion {
            x: 10.0,
            y: 13.4,
            width: 130.0,
            height: 30.0,
            radius: 15.0,
        };
        assert!(validate(&[r.clone()]).is_ok());
        r.width = f64::NAN;
        assert_eq!(validate(&[r.clone()]).unwrap_err().code, "QDT-630");
        r.width = 130.0;
        r.radius = 16.0;
        assert!(validate(&[r]).is_err());
    }
}

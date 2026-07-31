//! Show / hide logic for the main popup window.
//!
//! The window is created hidden at boot and reused for every invocation:
//! * `show()` moves it under the cursor, sizes it to the configured default,
//!   gives it focus, and clears the previous foreground capture.
//! * `hide()` removes the capture and tucks the window off-screen.
//! * `toggle()` chains the two and is what the global shortcut calls.

use std::sync::Arc;

use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::win::source;
use crate::AppState;

/// Captures the foreground window so we can hand focus back to it on paste.
pub fn capture_previous(window: &WebviewWindow) {
    if let Some(state) = window.app_handle().try_state::<AppState>() {
        let mut slot = state.foreground.lock();
        *slot = source::current_foreground();
    }
}

/// Shows the window centred under the cursor. If a monitor's cursor is on a
/// different display the window follows it.
pub fn show(window: &WebviewWindow) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    let (mon_x, mon_y, mon_w, mon_h) = monitor
        .map(|m| {
            let pos = m.position();
            let size = m.size();
            (
                pos.x as f64,
                pos.y as f64,
                size.width as f64,
                size.height as f64,
            )
        })
        .unwrap_or((0.0, 0.0, 1920.0, 1080.0));

    // The popup is 760×480 logical; convert to physical for Tauri 2.
    let width = (760.0 * scale) as u32;
    let height = (480.0 * scale) as u32;

    let cursor = cursor_position().unwrap_or((mon_x + mon_w / 2.0, mon_y + mon_h / 2.0));
    let x = (cursor.0 - (width as f64) / 2.0).clamp(mon_x, mon_x + mon_w - (width as f64));
    let y = (cursor.1 - 80.0).clamp(mon_y, mon_y + mon_h - 100.0);

    let _ = window.set_size(PhysicalSize::new(width, height));
    let _ = window.set_position(PhysicalPosition::new(x as i32, y as i32));
    capture_previous(window);
    let _ = window.show();
    let _ = window.set_focus();
}

/// Hides the window and clears the previous-foreground capture so a stale
/// window handle cannot accidentally become the target of a future paste.
pub fn hide(window: &WebviewWindow) {
    if let Some(state) = window.app_handle().try_state::<AppState>() {
        let mut slot = state.foreground.lock();
        *slot = 0;
    }
    let _ = window.hide();
}

pub fn toggle(window: &WebviewWindow) {
    match window.is_visible() {
        Ok(true) => hide(window),
        _ => show(window),
    }
}

fn cursor_position() -> Option<(f64, f64)> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
        unsafe {
            let mut point = POINT::default();
            if GetCursorPos(&mut point).is_ok() {
                return Some((point.x as f64, point.y as f64));
            }
        }
    }
    let _ = Arc::new(()); // keep Arc import live for non-windows builds
    None
}

//! Deterministic Win32 style enforcement for the transient quick flyout.

use tauri::WebviewWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, GWL_STYLE,
    SET_WINDOW_POS_FLAGS, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_CAPTION,
    WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
};

/// Removes application-window chrome after backdrop setup and forces Windows to
/// recalculate the non-client frame. Tauri's high-level setters are still used,
/// but WebView2/Acrylic can restore the original configured styles while the
/// hidden window warms up, so the final HWND is authoritative.
pub fn enforce_quick_flyout(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let forbidden =
            (WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX).0;
        SetWindowLongPtrW(hwnd, GWL_STYLE, style & !(forbidden as isize));

        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(
            hwnd,
            GWL_EXSTYLE,
            (ex_style & !(WS_EX_APPWINDOW.0 as isize)) | WS_EX_TOOLWINDOW.0 as isize,
        );

        SetWindowPos(
            hwnd,
            // SWP_NOZORDER keeps the current z-order, so no insert-after window
            // is needed; always-on-top is owned by the caller.
            None,
            0,
            0,
            0,
            0,
            SET_WINDOW_POS_FLAGS(SWP_FRAMECHANGED.0 | SWP_NOMOVE.0 | SWP_NOSIZE.0 | SWP_NOZORDER.0),
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

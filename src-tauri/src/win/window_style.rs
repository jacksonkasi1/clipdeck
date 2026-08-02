//! Deterministic Win32 style enforcement and reporting for the quick flyout.

use std::ffi::c_void;

use tauri::WebviewWindow;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWINDOWATTRIBUTE};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, GWL_STYLE,
    SET_WINDOW_POS_FLAGS, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_CAPTION,
    WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
};

// Windows 11 DWM attributes. Raw values keep this compatible with the pinned
// windows-rs version even when newer named constants are added later.
const DWMWA_WINDOW_CORNER_PREFERENCE: DWMWINDOWATTRIBUTE = DWMWINDOWATTRIBUTE(33);
const DWMWA_BORDER_COLOR: DWMWINDOWATTRIBUTE = DWMWINDOWATTRIBUTE(34);
const DWMWCP_ROUNDSMALL: u32 = 3;
const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

/// A single observation of the native window styles, used for both enforcement
/// and packaged smoke diagnostics.
#[derive(Clone, Copy, Debug)]
pub struct StyleSnapshot {
    pub hwnd: isize,
    pub style: isize,
    pub ex_style: isize,
}

impl std::fmt::Display for StyleSnapshot {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "hwnd=0x{:X} style=0x{:08X} exStyle=0x{:08X}",
            self.hwnd, self.style as u32, self.ex_style as u32
        )
    }
}

fn snapshot(hwnd: HWND) -> StyleSnapshot {
    unsafe {
        StyleSnapshot {
            hwnd: hwnd.0 as isize,
            style: GetWindowLongPtrW(hwnd, GWL_STYLE),
            ex_style: GetWindowLongPtrW(hwnd, GWL_EXSTYLE),
        }
    }
}

/// Reads the current native styles without changing them.
pub fn read_styles(window: &WebviewWindow) -> Result<StyleSnapshot, String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    Ok(snapshot(hwnd))
}

/// Removes application-window chrome after backdrop setup and forces Windows to
/// recalculate the non-client frame. Tauri's high-level setters are still used,
/// but WebView2/Acrylic can restore the original configured styles while the
/// hidden window warms up, so the final HWND is authoritative. Returns the
/// styles observed immediately after enforcement.
pub fn enforce_quick_flyout(window: &WebviewWindow) -> Result<StyleSnapshot, String> {
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

    apply_quick_dwm_frame(hwnd);
    Ok(snapshot(hwnd))
}

/// Requests a compact Mac-like corner radius and disables the visible DWM edge.
/// These attributes are best-effort so Windows 10 or restricted sessions still
/// receive the frameless Win32 style contract above.
fn apply_quick_dwm_frame(hwnd: HWND) {
    unsafe {
        let corner = DWMWCP_ROUNDSMALL;
        if let Err(error) = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            (&corner as *const u32).cast::<c_void>(),
            std::mem::size_of_val(&corner) as u32,
        ) {
            log::debug!("small quick-window corners are unavailable: {error}");
        }

        let border = DWMWA_COLOR_NONE;
        if let Err(error) = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            (&border as *const u32).cast::<c_void>(),
            std::mem::size_of_val(&border) as u32,
        ) {
            log::debug!("borderless quick-window frame is unavailable: {error}");
        }
    }
}

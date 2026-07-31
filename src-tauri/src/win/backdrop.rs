//! Window material and frame styling.
//!
//! Two layers cooperate to produce the Windows 11 flyout look:
//!
//! 1. `window-vibrancy` installs the system backdrop (Desktop Acrylic or Mica).
//!    Acrylic is what the shell itself uses for transient surfaces such as the
//!    Win+V flyout, so it is our default.
//! 2. DWM attributes round the frame and switch the non-client area to dark mode.
//!
//! Every call degrades gracefully: on a build that predates an attribute, DWM
//! returns `E_INVALIDARG` and we simply keep the previous appearance rather than
//! failing to show the window.

use tauri::WebviewWindow;

use crate::models::Backdrop;

#[cfg(windows)]
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE,
    DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
};

/// `DWMWA_COLOR_NONE` — suppresses the 1px DWM border so our CSS border is the
/// only visible edge.
#[cfg(windows)]
const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

/// Applies the configured backdrop to a window.
///
/// Falls back through Acrylic → Mica → opaque so the window is always usable.
/// Returns the material that actually took effect, which the frontend uses to
/// decide how opaque its own surfaces need to be.
pub fn apply(window: &WebviewWindow, backdrop: Backdrop, dark: bool) -> Backdrop {
    let _ = window_vibrancy::clear_acrylic(window);
    let _ = window_vibrancy::clear_mica(window);

    let effective = match backdrop {
        Backdrop::Solid => Backdrop::Solid,
        Backdrop::Mica => {
            if window_vibrancy::apply_mica(window, Some(dark)).is_ok() {
                Backdrop::Mica
            } else {
                Backdrop::Solid
            }
        }
        Backdrop::Acrylic => {
            let tint = if dark {
                (18, 18, 18, 180)
            } else {
                (243, 243, 243, 180)
            };
            if window_vibrancy::apply_acrylic(window, Some(tint)).is_ok() {
                Backdrop::Acrylic
            } else if window_vibrancy::apply_mica(window, Some(dark)).is_ok() {
                Backdrop::Mica
            } else {
                Backdrop::Solid
            }
        }
    };

    apply_frame(window, dark);
    effective
}

/// Rounds the window corners and matches the frame to the current theme.
#[cfg(windows)]
pub fn apply_frame(window: &WebviewWindow, dark: bool) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    unsafe {
        set_attribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &(dark as u32));
        set_attribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &(DWMWCP_ROUND.0 as u32),
        );
        set_attribute(hwnd, DWMWA_BORDER_COLOR, &DWMWA_COLOR_NONE);
    }
}

#[cfg(not(windows))]
pub fn apply_frame(_window: &WebviewWindow, _dark: bool) {}

/// Sets a single DWM attribute, ignoring `E_INVALIDARG` from older builds.
#[cfg(windows)]
unsafe fn set_attribute(
    hwnd: windows::Win32::Foundation::HWND,
    attribute: windows::Win32::Graphics::Dwm::DWMWINDOWATTRIBUTE,
    value: &u32,
) {
    let _ = DwmSetWindowAttribute(
        hwnd,
        attribute,
        value as *const u32 as *const _,
        std::mem::size_of::<u32>() as u32,
    );
}

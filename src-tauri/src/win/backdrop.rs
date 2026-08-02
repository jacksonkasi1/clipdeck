//! Window material and frame styling.
//!
//! Two layers cooperate to produce the Windows 11 flyout look:
//!
//! 1. `window-vibrancy` installs the system backdrop (Desktop Acrylic or Mica).
//! 2. DWM attributes own corner clipping, native border color, and dark mode.
//!
//! Every call degrades gracefully: on a build that predates an attribute, DWM
//! returns `E_INVALIDARG` and we keep the previous appearance.

use tauri::WebviewWindow;

use crate::models::Backdrop;
use crate::window_layout::{mode_for_label, WindowMode};

#[cfg(windows)]
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE,
    DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, DWMWCP_ROUNDSMALL,
};

#[cfg(windows)]
const DWMWA_COLOR_DEFAULT: u32 = 0xFFFF_FFFF;
/// Suppresses the visible DWM border while keeping compositor clipping/shadow.
#[cfg(windows)]
const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

/// Applies the configured backdrop to a window.
///
/// Falls back through Acrylic → Mica → opaque so the window is always usable.
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

/// Applies label-specific Windows 11 corner and border policy.
#[cfg(windows)]
pub fn apply_frame(window: &WebviewWindow, dark: bool) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let quick = mode_for_label(window.label()) == WindowMode::Quick;
    let corner = if quick {
        DWMWCP_ROUNDSMALL.0 as u32
    } else {
        DWMWCP_ROUND.0 as u32
    };
    let border = if quick {
        DWMWA_COLOR_NONE
    } else {
        DWMWA_COLOR_DEFAULT
    };

    unsafe {
        set_attribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &(dark as u32));
        set_attribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &corner);
        set_attribute(hwnd, DWMWA_BORDER_COLOR, &border);
    }
}

#[cfg(not(windows))]
pub fn apply_frame(_window: &WebviewWindow, _dark: bool) {}

/// Sets a single DWM attribute, ignoring unsupported-attribute failures.
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

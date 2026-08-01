//! Monitor work-area resolution for the transient quick palette.
//!
//! The quick palette must always appear on the monitor the user is actually
//! working on, centred inside the *usable* area so it never sits underneath the
//! taskbar. Tauri's `Monitor` only exposes the full monitor rectangle, so the
//! work area is read straight from `GetMonitorInfoW`.
//!
//! Resolution order (see `resolve`):
//! 1. the foreground window captured before Clipdeck stole focus,
//! 2. the current cursor position,
//! 3. the primary monitor.

/// A monitor rectangle in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl WorkArea {
    pub fn is_usable(self) -> bool {
        self.width > 0 && self.height > 0
    }
}

#[cfg(windows)]
mod imp {
    use super::WorkArea;
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, HMONITOR, MONITORINFO,
        MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTOPRIMARY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, IsWindow};

    /// Resolves the work area of the monitor the user is currently working on.
    pub fn resolve(foreground: isize) -> Option<WorkArea> {
        from_foreground(foreground)
            .or_else(from_cursor)
            .or_else(primary)
    }

    fn from_foreground(foreground: isize) -> Option<WorkArea> {
        if foreground == 0 {
            return None;
        }
        let hwnd = HWND(foreground as *mut _);
        if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
            return None;
        }
        let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
        work_area(monitor)
    }

    fn from_cursor() -> Option<WorkArea> {
        let mut point = POINT::default();
        if unsafe { GetCursorPos(&mut point) }.is_err() {
            return None;
        }
        let monitor = unsafe { MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST) };
        work_area(monitor)
    }

    fn primary() -> Option<WorkArea> {
        let monitor = unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) };
        work_area(monitor)
    }

    fn work_area(monitor: HMONITOR) -> Option<WorkArea> {
        if monitor.is_invalid() {
            return None;
        }
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
            return None;
        }
        Some(from_rect(info.rcWork))
    }

    fn from_rect(rect: RECT) -> WorkArea {
        WorkArea {
            x: rect.left,
            y: rect.top,
            width: rect.right.saturating_sub(rect.left),
            height: rect.bottom.saturating_sub(rect.top),
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::WorkArea;

    pub fn resolve(_foreground: isize) -> Option<WorkArea> {
        None
    }
}

/// Resolves the active monitor's work area, or `None` when Windows cannot
/// answer (in which case callers fall back to Tauri's own monitor list).
pub fn resolve(foreground: isize) -> Option<WorkArea> {
    imp::resolve(foreground).filter(|area| area.is_usable())
}

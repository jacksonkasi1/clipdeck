//! Native show/hide behavior for the reusable main window.
//!
//! The configured size and centered initial position are applied once by
//! Tauri. Subsequent opens preserve the user's last size and position so the
//! window behaves like a normal Windows desktop application.

use tauri::{Manager, PhysicalPosition, WebviewWindow};

use crate::win::source;
use crate::AppState;

/// Captures the foreground window so paste can return focus to it.
pub fn capture_previous(window: &WebviewWindow) {
    if let Some(state) = window.app_handle().try_state::<AppState>() {
        *state.foreground.lock() = source::current_foreground();
    }
}

pub fn show(window: &WebviewWindow) {
    capture_previous(window);
    let _ = window.unminimize();
    ensure_titlebar_reachable(window);
    let _ = window.show();
    let _ = window.set_focus();
}

pub fn hide(window: &WebviewWindow) {
    if let Some(state) = window.app_handle().try_state::<AppState>() {
        *state.foreground.lock() = 0;
    }
    let _ = window.hide();
}

pub fn toggle(window: &WebviewWindow) {
    match window.is_visible() {
        Ok(true) => hide(window),
        _ => show(window),
    }
}

const MIN_REACHABLE_TITLEBAR_WIDTH: i64 = 96;
const TITLEBAR_HEIGHT: i64 = 40;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PhysicalRect {
    x: i64,
    y: i64,
    width: i64,
    height: i64,
}

impl PhysicalRect {
    fn right(self) -> i64 {
        self.x.saturating_add(self.width)
    }

    fn bottom(self) -> i64 {
        self.y.saturating_add(self.height)
    }
}

/// Keeps a reused window movable after a monitor is disconnected or its
/// resolution changes. Normal in-bounds positions are deliberately preserved.
fn ensure_titlebar_reachable(window: &WebviewWindow) {
    let Ok(position) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let Ok(monitors) = window.available_monitors() else {
        return;
    };

    let window_rect = PhysicalRect {
        x: i64::from(position.x),
        y: i64::from(position.y),
        width: i64::from(size.width),
        height: i64::from(size.height),
    };
    let monitor_rects = monitors
        .iter()
        .map(|monitor| PhysicalRect {
            x: i64::from(monitor.position().x),
            y: i64::from(monitor.position().y),
            width: i64::from(monitor.size().width),
            height: i64::from(monitor.size().height),
        })
        .collect::<Vec<_>>();

    if titlebar_is_reachable(window_rect, &monitor_rects) {
        return;
    }

    let target = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.first().cloned());
    let Some(target) = target else {
        return;
    };
    let target_rect = PhysicalRect {
        x: i64::from(target.position().x),
        y: i64::from(target.position().y),
        width: i64::from(target.size().width),
        height: i64::from(target.size().height),
    };
    let (x, y) = centered_origin(window_rect, target_rect);
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn titlebar_is_reachable(window: PhysicalRect, monitors: &[PhysicalRect]) -> bool {
    let titlebar = PhysicalRect {
        height: window.height.clamp(0, TITLEBAR_HEIGHT),
        ..window
    };
    let required_width = titlebar.width.clamp(0, MIN_REACHABLE_TITLEBAR_WIDTH);

    monitors.iter().any(|monitor| {
        overlap(titlebar.x, titlebar.right(), monitor.x, monitor.right()) >= required_width
            && overlap(titlebar.y, titlebar.bottom(), monitor.y, monitor.bottom())
                >= titlebar.height
    })
}

fn centered_origin(window: PhysicalRect, monitor: PhysicalRect) -> (i32, i32) {
    let x = monitor
        .x
        .saturating_add((monitor.width.saturating_sub(window.width)).max(0) / 2);
    let y = monitor
        .y
        .saturating_add((monitor.height.saturating_sub(window.height)).max(0) / 2);
    (
        x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        y.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
    )
}

fn overlap(a_start: i64, a_end: i64, b_start: i64, b_end: i64) -> i64 {
    a_end.min(b_end).saturating_sub(a_start.max(b_start)).max(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRIMARY: PhysicalRect = PhysicalRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };

    #[test]
    fn keeps_a_reachable_user_position() {
        let window = PhysicalRect {
            x: 1300,
            y: 160,
            width: 520,
            height: 720,
        };

        assert!(titlebar_is_reachable(window, &[PRIMARY]));
    }

    #[test]
    fn rejects_a_window_left_on_a_disconnected_monitor() {
        let window = PhysicalRect {
            x: -1800,
            y: 120,
            width: 1120,
            height: 720,
        };

        assert!(!titlebar_is_reachable(window, &[PRIMARY]));
    }

    #[test]
    fn rejects_a_window_whose_titlebar_is_above_the_display() {
        let window = PhysicalRect {
            x: 600,
            y: -36,
            width: 520,
            height: 720,
        };

        assert!(!titlebar_is_reachable(window, &[PRIMARY]));
    }

    #[test]
    fn accepts_a_reachable_titlebar_on_a_secondary_display() {
        let secondary = PhysicalRect {
            x: -1280,
            y: 0,
            width: 1280,
            height: 1024,
        };
        let window = PhysicalRect {
            x: -900,
            y: 90,
            width: 520,
            height: 720,
        };

        assert!(titlebar_is_reachable(window, &[PRIMARY, secondary]));
    }

    #[test]
    fn centers_compact_and_full_windows_without_negative_offsets() {
        let compact = PhysicalRect {
            x: 0,
            y: 0,
            width: 520,
            height: 720,
        };
        let oversized = PhysicalRect {
            x: 0,
            y: 0,
            width: 2400,
            height: 1200,
        };

        assert_eq!(centered_origin(compact, PRIMARY), (700, 180));
        assert_eq!(centered_origin(oversized, PRIMARY), (0, 0));
    }
}

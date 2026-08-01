//! Pure window geometry shared by the quick palette and the full application.
//!
//! This module is deliberately free of Tauri and Win32 types so the sizing and
//! placement rules can be unit tested on any host, including the CI runner used
//! for `cargo test`. `window.rs` (Windows-only, `cfg(not(test))`) is a thin
//! adapter over these functions.

/// Frameless transient clipboard flyout.
pub const QUICK_LABEL: &str = "quick";
/// Normal decorated desktop application window.
pub const MAIN_LABEL: &str = "main";
/// Long-lived settings window.
pub const SETTINGS_LABEL: &str = "settings";

/// Which behavioural contract a native window implements.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowMode {
    /// Transient flyout: light-dismiss, no chrome, re-centred every time.
    Quick,
    /// Normal desktop application window.
    Full,
    /// Settings window; independent of both.
    Settings,
}

/// Maps a window label to its behavioural contract.
///
/// Mode is never inferred from window size — a narrow full application window
/// is still a full application window, and the flyout stays a flyout when it is
/// expanded to show its preview column.
pub fn mode_for_label(label: &str) -> WindowMode {
    match label {
        QUICK_LABEL => WindowMode::Quick,
        SETTINGS_LABEL => WindowMode::Settings,
        _ => WindowMode::Full,
    }
}

/// Compact quick-palette width (list only), in logical pixels.
pub const QUICK_COMPACT_WIDTH: f64 = 560.0;
/// Expanded quick-palette width (list + preview), in logical pixels.
pub const QUICK_EXPANDED_WIDTH: f64 = 960.0;
/// The quick palette keeps a constant height so expanding grows sideways only.
pub const QUICK_HEIGHT: f64 = 620.0;
/// Logical breathing room kept between the flyout and the work-area edges.
pub const QUICK_WORK_AREA_MARGIN: f64 = 24.0;

/// Minimum horizontal titlebar overlap that still lets the user drag a window.
const MIN_REACHABLE_TITLEBAR_WIDTH: i64 = 96;
/// Approximate Windows caption height used for the reachability probe.
const TITLEBAR_HEIGHT: i64 = 40;

/// A rectangle in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PhysicalRect {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

impl PhysicalRect {
    fn right(self) -> i64 {
        self.x.saturating_add(self.width)
    }

    fn bottom(self) -> i64 {
        self.y.saturating_add(self.height)
    }
}

/// Clamps a desired physical size so the flyout always fits the work area.
///
/// The margin is honoured whenever possible; on very small displays the size
/// collapses to the work area rather than overflowing offscreen.
pub fn fit_within(
    desired_width: f64,
    desired_height: f64,
    area_width: f64,
    area_height: f64,
    margin: f64,
) -> (f64, f64) {
    let max_width = (area_width - margin * 2.0).max(1.0).min(area_width);
    let max_height = (area_height - margin * 2.0).max(1.0).min(area_height);
    (
        desired_width.min(max_width).max(1.0),
        desired_height.min(max_height).max(1.0),
    )
}

/// Centres `size` inside a work area, returning a physical origin.
pub fn centered_in_work_area(area: PhysicalRect, width: f64, height: f64) -> (i32, i32) {
    let x = f64::from(area.x as i32) + (f64::from(area.width as i32) - width) / 2.0;
    let y = f64::from(area.y as i32) + (f64::from(area.height as i32) - height) / 2.0;
    (x.round() as i32, y.round() as i32)
}

/// True when enough of a decorated window's caption sits on some monitor for
/// the user to grab and move it.
pub fn titlebar_is_reachable(window: PhysicalRect, monitors: &[PhysicalRect]) -> bool {
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

/// Centres a window rectangle inside a monitor rectangle.
pub fn centered_origin(window: PhysicalRect, monitor: PhysicalRect) -> (i32, i32) {
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

    /// 1080p work area (taskbar removed) across the four Windows scaling
    /// factors we support. The flyout must fit with its margin intact and the
    /// expanded layout must never be narrower than the compact one.
    #[test]
    fn window_mode_comes_from_the_label_not_the_size() {
        assert_eq!(mode_for_label(QUICK_LABEL), WindowMode::Quick);
        assert_eq!(mode_for_label(MAIN_LABEL), WindowMode::Full);
        assert_eq!(mode_for_label(SETTINGS_LABEL), WindowMode::Settings);
        assert_eq!(mode_for_label("unknown"), WindowMode::Full);
    }

    #[test]
    fn quick_palette_fits_every_common_scaling_factor() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let area_width = 1920.0;
            let area_height = 1080.0 - 48.0 * scale;
            let margin = QUICK_WORK_AREA_MARGIN * scale;

            let (compact_w, compact_h) = fit_within(
                QUICK_COMPACT_WIDTH * scale,
                QUICK_HEIGHT * scale,
                area_width,
                area_height,
                margin,
            );
            let (expanded_w, expanded_h) = fit_within(
                QUICK_EXPANDED_WIDTH * scale,
                QUICK_HEIGHT * scale,
                area_width,
                area_height,
                margin,
            );

            assert!(compact_w <= area_width - margin * 2.0 + f64::EPSILON);
            assert!(compact_h <= area_height - margin * 2.0 + f64::EPSILON);
            assert!(expanded_w <= area_width - margin * 2.0 + f64::EPSILON);
            assert!(expanded_h <= area_height - margin * 2.0 + f64::EPSILON);
            assert!(expanded_w >= compact_w);
        }
    }

    #[test]
    fn quick_palette_shrinks_instead_of_overflowing_a_small_display() {
        // 1024x600 work area at 150% scaling cannot host a 960x620 logical
        // flyout, so the size is clamped rather than pushed offscreen.
        let (width, height) = fit_within(960.0 * 1.5, 620.0 * 1.5, 1024.0, 600.0, 36.0);
        assert!(width <= 1024.0);
        assert!(height <= 600.0);
    }

    #[test]
    fn quick_palette_centres_on_a_secondary_monitor_left_of_primary() {
        // Negative-origin monitors are common when a display is arranged to
        // the left of the primary; the flyout must land there, not at x >= 0.
        let secondary = PhysicalRect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1032,
        };
        let (x, y) = centered_in_work_area(secondary, 560.0, 620.0);
        assert_eq!(x, -1240);
        assert_eq!(y, 206);
    }

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

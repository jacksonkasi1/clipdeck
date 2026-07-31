//! Keeps native window chrome aligned with the persisted appearance setting.
//!
//! Webview colors are handled by the frontend. This module owns the matching
//! Tauri window theme, DWM frame, and Windows backdrop so native decorations do
//! not drift from the selected theme.

use crate::models::ThemeMode;

/// Resolves the persisted preference against the current operating-system
/// theme. Explicit choices never inherit a later system change.
pub fn resolve_dark(mode: ThemeMode, system_dark: bool) -> bool {
    match mode {
        ThemeMode::System => system_dark,
        ThemeMode::Light => false,
        ThemeMode::Dark => true,
    }
}

#[cfg(not(test))]
use tauri::{AppHandle, Emitter, Manager, Theme, WebviewWindow, Window};

#[cfg(not(test))]
use crate::models::{Backdrop, Settings, SystemAppearance};
#[cfg(not(test))]
use crate::AppState;

/// Re-applies native appearance to every open window and returns the current
/// operating-system appearance for the webview store.
#[cfg(not(test))]
#[tauri::command]
pub fn sync_native_appearance(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> SystemAppearance {
    let settings = state.settings.read().clone();
    apply_all(&app, &settings)
}

/// Applies the persisted appearance to one native window.
#[cfg(not(test))]
pub fn apply_window(
    window: &WebviewWindow,
    settings: &Settings,
    system: &SystemAppearance,
) -> Backdrop {
    if let Err(error) = window.set_theme(theme_override(settings.theme)) {
        log::warn!("could not update native window theme: {error}");
    }

    apply_surface(window, settings, resolve_dark(settings.theme, system.dark))
}

/// Applies the persisted appearance to every native window.
#[cfg(not(test))]
pub fn apply_all(app: &AppHandle, settings: &Settings) -> SystemAppearance {
    let system = crate::win::appearance::read();
    for window in app.webview_windows().values() {
        apply_window(window, settings, &system);
    }
    let _ = app.emit("appearance-changed", &system);
    system
}

/// Handles an operating-system theme notification. Only System mode follows
/// the notification; explicit Light and Dark preferences remain fixed.
#[cfg(not(test))]
pub fn handle_system_theme_changed(window: &Window, theme: Theme) {
    let app = window.app_handle();
    let state: tauri::State<'_, AppState> = app.state();
    let settings = state.settings.read().clone();
    if settings.theme != ThemeMode::System {
        return;
    }

    let mut system = crate::win::appearance::read();
    system.dark = matches!(theme, Theme::Dark);
    for webview in app.webview_windows().values() {
        apply_surface(webview, &settings, system.dark);
    }
    let _ = app.emit("appearance-changed", &system);
}

#[cfg(not(test))]
fn apply_surface(window: &WebviewWindow, settings: &Settings, dark: bool) -> Backdrop {
    let effective = crate::win::backdrop::apply(window, settings.backdrop, dark);
    let _ = window.emit("clipdeck:backdrop", effective);
    effective
}

#[cfg(not(test))]
fn theme_override(mode: ThemeMode) -> Option<Theme> {
    match mode {
        ThemeMode::System => None,
        ThemeMode::Light => Some(Theme::Light),
        ThemeMode::Dark => Some(Theme::Dark),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_mode_follows_the_operating_system() {
        assert!(resolve_dark(ThemeMode::System, true));
        assert!(!resolve_dark(ThemeMode::System, false));
    }

    #[test]
    fn explicit_dark_ignores_the_operating_system() {
        assert!(resolve_dark(ThemeMode::Dark, true));
        assert!(resolve_dark(ThemeMode::Dark, false));
    }

    #[test]
    fn explicit_light_ignores_the_operating_system() {
        assert!(!resolve_dark(ThemeMode::Light, true));
        assert!(!resolve_dark(ThemeMode::Light, false));
    }
}

//! Clipdeck library crate.
//!
//! The `run()` function is the single entry point invoked from `main.rs`.
//! Everything else in the crate is reached through commands or events emitted
//! from inside `run`.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

pub mod clipboard;
pub mod commands;
pub mod db;
pub mod error;
pub mod models;
pub mod tray;
pub mod window;

mod win;

/// Shared application state handed to every command handler.
pub struct AppState {
    pub db: Arc<db::Db>,
    pub image_root: PathBuf,
    pub thumb_root: PathBuf,
    pub settings: parking_lot::RwLock<models::Settings>,
    pub foreground: parking_lot::Mutex<isize>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                window::toggle(&window);
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .invoke_handler(tauri::generate_handler![
            commands::list_items,
            commands::get_item,
            commands::flavors_for,
            commands::copy_to_clipboard,
            commands::paste_active,
            commands::set_favorite,
            commands::delete_item,
            commands::clear_history,
            commands::counts,
            commands::load_settings,
            commands::save_settings,
            commands::prune_now,
            commands::appearance,
            commands::open_settings_window,
            commands::hide_window,
            commands::quit_app,
        ])
        .setup(|app| {
            bootstrap(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hiding rather than exiting matches the Win+V flyout behaviour
                // and avoids the slow second-launch Tauri performs.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, _| {});
}

/// Wires up everything that has to be alive before the first window appears:
/// the SQLite database, the asset directories, the clipboard listener, the
/// tray icon, and the global shortcut.
fn bootstrap(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?;
    let image_root = data_dir.join("images");
    let thumb_root = data_dir.join("thumbs");
    std::fs::create_dir_all(&image_root)?;
    std::fs::create_dir_all(&thumb_root)?;

    let db_path = data_dir.join("clipdeck.db");
    let db = Arc::new(db::Db::open(&db_path)?);
    let settings = parking_lot::RwLock::new(db.load_settings().unwrap_or_default());

    let state = AppState {
        db: Arc::clone(&db),
        image_root,
        thumb_root,
        settings,
        foreground: parking_lot::Mutex::new(0),
    };
    app.manage(state);

    // Apply backdrop before showing the window so the user never sees a
    // frame without Acrylic.
    if let Some(window) = app.get_webview_window("main") {
        let app_state: tauri::State<AppState> = app.state();
        let settings = app_state.settings.read().clone();
        let dark = crate::win::appearance::read().dark;
        let backdrop = crate::win::backdrop::apply(&window, settings.backdrop, dark);
        log::info!("applied backdrop: {backdrop:?}");
    }

    // Tray icon and global shortcut are installed even on autostart.
    tray::install(app)?;
    commands::install_hotkey(app)?;
    commands::install_clipboard_listener(app)?;

    Ok(())
}

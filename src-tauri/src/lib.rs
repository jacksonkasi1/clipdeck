//! Clipdeck library crate.
//!
//! The `run()` function is the single entry point invoked from `main.rs`.
//! Everything else in the crate is reached through commands or events emitted
//! from inside `run`.

#[cfg(not(test))]
use std::path::PathBuf;
#[cfg(not(test))]
use std::sync::Arc;

#[cfg(not(test))]
use tauri::{Manager, WindowEvent};
#[cfg(not(test))]
use tauri_plugin_autostart::MacosLauncher;

pub mod clipboard;
#[cfg(not(test))]
pub mod commands;
pub mod db;
pub mod error;
pub mod hotkey;
pub mod models;
pub mod native_appearance;
pub mod storage;
pub mod sync;
#[cfg(not(test))]
pub mod tray;
#[cfg(not(test))]
pub mod window;

mod win;

/// Shared application state handed to every command handler.
#[cfg(not(test))]
pub struct AppState {
    pub db: Arc<db::Db>,
    pub storage_root: Arc<parking_lot::RwLock<PathBuf>>,
    pub storage_operation: Arc<parking_lot::RwLock<()>>,
    pub settings: Arc<parking_lot::RwLock<models::Settings>>,
    pub sync: sync::SyncService,
    pub active_hotkey: parking_lot::Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>,
    pub foreground: parking_lot::Mutex<isize>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(test))]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                window::toggle(&window);
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            commands::set_item_tags,
            commands::edit_item,
            commands::delete_item,
            commands::clear_history,
            commands::clear_category,
            commands::counts,
            commands::load_settings,
            commands::save_settings,
            commands::change_storage_location,
            commands::prune_now,
            commands::appearance,
            commands::open_settings_window,
            commands::open_external_url,
            commands::open_storage_folder,
            commands::hide_window,
            commands::set_always_on_top,
            commands::set_preview_visible,
            commands::sync_state,
            commands::regenerate_pairing_code,
            commands::quit_app,
            native_appearance::sync_native_appearance,
        ])
        .setup(|app| {
            bootstrap(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    // Hiding rather than exiting matches the Win+V flyout behaviour
                    // and avoids the slow second-launch Tauri performs.
                    api.prevent_close();
                    let _ = window.hide();
                }
                WindowEvent::ThemeChanged(theme) => {
                    native_appearance::handle_system_theme_changed(window, *theme);
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, _| {});
}

/// Wires up everything that has to be alive before the first window appears:
/// the SQLite database, the asset directories, the clipboard listener, the
/// tray icon, and the global shortcut.
#[cfg(not(test))]
fn bootstrap(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?;
    let db_path = data_dir.join("clipdeck.db");
    let db = Arc::new(db::Db::open(&db_path)?);
    let loaded_settings = db.load_settings().unwrap_or_default();
    db.save_settings(&loaded_settings)?;
    let settings = Arc::new(parking_lot::RwLock::new(loaded_settings));
    let requested_root = settings
        .read()
        .storage_path
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| data_dir.clone());
    let storage_path = if storage::prepare_root(&requested_root).is_ok() {
        requested_root
    } else {
        storage::prepare_root(&data_dir)?;
        settings.write().storage_path = None;
        db.save_settings(&settings.read())?;
        data_dir.clone()
    };
    for managed_root in storage::managed_asset_roots(&storage_path) {
        app.asset_protocol_scope()
            .allow_directory(managed_root, true)?;
    }

    let sync = match sync::SyncService::start(
        app.handle().clone(),
        Arc::clone(&db),
        Arc::clone(&settings),
    ) {
        Ok(service) => service,
        Err(error) => {
            log::warn!("LAN sync could not start: {error}");
            sync::SyncService::inactive()
        }
    };
    let state = AppState {
        db: Arc::clone(&db),
        storage_root: Arc::new(parking_lot::RwLock::new(storage_path)),
        storage_operation: Arc::new(parking_lot::RwLock::new(())),
        settings: Arc::clone(&settings),
        sync,
        active_hotkey: parking_lot::Mutex::new(None),
        foreground: parking_lot::Mutex::new(0),
    };
    app.manage(state);

    // Apply backdrop before showing the window so the user never sees a
    // frame without Acrylic.
    if let Some(window) = app.get_webview_window("main") {
        let app_state: tauri::State<AppState> = app.state();
        let settings = app_state.settings.read().clone();
        let system = crate::win::appearance::read();
        let backdrop = native_appearance::apply_window(&window, &settings, &system);
        log::info!("applied backdrop: {backdrop:?}");
    }

    // Tray icon and global shortcut are installed even on autostart.
    tray::install(app)?;
    commands::install_hotkey(app);
    if let Err(error) = commands::enforce_history_policy_on_startup(app) {
        log::error!("startup history cleanup failed: {error}");
    }
    commands::install_clipboard_listener(app)?;

    Ok(())
}

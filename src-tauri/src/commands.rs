//! Tauri command handlers and one-shot helper functions.
//!
//! Commands return `Result<T, Error>` so the frontend always receives a
//! uniform error shape. Helper functions (no `#[tauri::command]`) live here
//! too when they need to be called from `lib.rs` or `tray.rs`.

use std::path::PathBuf;
use std::sync::{mpsc, Arc};

use tauri::{App, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::clipboard::listener::{self, CaptureSink, ClipEvent};
use crate::db::Db;
use crate::error::{Error, Result};
use crate::models::{
    ClipItem, Counts, ImageMeta, ItemKind, ListQuery, PasteFlavor, Settings, StoredFile,
    StoredFileStatus, SyncState, SystemAppearance,
};
use crate::win::paste;
use crate::AppState;

// ---- command handlers ----------------------------------------------------

#[tauri::command]
pub async fn list_items(
    state: tauri::State<'_, AppState>,
    query: ListQuery,
) -> Result<Vec<ClipItem>> {
    state.db.list(&query).map_err(|error| {
        log::error!("list_items failed: {error}");
        error
    })
}

#[tauri::command]
pub async fn get_item(state: tauri::State<'_, AppState>, id: i64) -> Result<ClipItem> {
    state.db.get(id)?.ok_or(Error::NotFound("clipboard item"))
}

#[tauri::command]
pub async fn flavors_for(state: tauri::State<'_, AppState>, id: i64) -> Result<FlavorBundle> {
    let item = state.db.get_required(id)?;
    let (_, html, rtf) = state
        .db
        .flavors(id)?
        .ok_or(Error::NotFound("clipboard item"))?;
    Ok(FlavorBundle {
        text: if item.kind == ItemKind::Text
            || item.kind == ItemKind::Link
            || item.kind == ItemKind::Email
            || item.kind == ItemKind::Color
        {
            Some(item.content.clone())
        } else {
            None
        },
        html,
        rtf,
        files: item.files.clone(),
        image: item.image.clone(),
    })
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlavorBundle {
    pub text: Option<String>,
    pub html: Option<String>,
    pub rtf: Option<String>,
    pub files: Vec<String>,
    pub image: Option<ImageMeta>,
}

#[tauri::command]
pub async fn copy_to_clipboard(
    state: tauri::State<'_, AppState>,
    id: i64,
    flavor: PasteFlavor,
) -> Result<()> {
    let item = state.db.get_required(id)?;
    let (_, html, rtf) = state
        .db
        .flavors(id)?
        .ok_or(Error::NotFound("clipboard item"))?;
    state.db.touch(id)?;
    crate::clipboard::writer::put_back_on_clipboard(
        &item,
        flavor,
        html.as_deref(),
        rtf.as_deref(),
    )?;
    Ok(())
}

#[tauri::command]
pub async fn paste_active(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    id: i64,
    flavor: PasteFlavor,
) -> Result<()> {
    let item = state.db.get_required(id)?;
    let (_, html, rtf) = state
        .db
        .flavors(id)?
        .ok_or(Error::NotFound("clipboard item"))?;
    state.db.touch(id)?;

    crate::clipboard::writer::put_back_on_clipboard(
        &item,
        flavor,
        html.as_deref(),
        rtf.as_deref(),
    )?;

    let target = *state.foreground.lock();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    if !paste::paste_to(target) {
        return Err(Error::Other(
            "the previous application could not receive the paste command".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn set_favorite(state: tauri::State<'_, AppState>, id: i64, value: bool) -> Result<()> {
    state.db.set_favorite(id, value)?;
    Ok(())
}

#[tauri::command]
pub async fn edit_item(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    id: i64,
    content: String,
) -> Result<ClipItem> {
    if content.trim().is_empty() {
        return Err(Error::Other("clipboard content cannot be empty".into()));
    }
    let kind = crate::clipboard::classify(content.trim());
    let hash = crate::clipboard::hash_text(&content);
    let item = state.db.update_text_content(id, &content, kind, &hash)?;
    let _ = app.emit("clip-updated", &item);
    Ok(item)
}

#[tauri::command]
pub async fn delete_item(state: tauri::State<'_, AppState>, id: i64) -> Result<()> {
    let _storage_guard = state.storage_operation.read();
    let orphans = state.db.delete(id)?;
    cleanup_asset_paths(&state.storage_root.read(), orphans);
    Ok(())
}

#[tauri::command]
pub async fn clear_history(
    state: tauri::State<'_, AppState>,
    include_favorites: bool,
) -> Result<()> {
    let _storage_guard = state.storage_operation.read();
    let orphans = state.db.clear(include_favorites)?;
    cleanup_asset_paths(&state.storage_root.read(), orphans);
    Ok(())
}

#[tauri::command]
pub async fn clear_category(
    state: tauri::State<'_, AppState>,
    kind: ItemKind,
    include_favorites: bool,
) -> Result<()> {
    let _storage_guard = state.storage_operation.read();
    let orphans = state.db.clear_kind(kind, include_favorites)?;
    cleanup_asset_paths(&state.storage_root.read(), orphans);
    Ok(())
}

#[tauri::command]
pub async fn counts(state: tauri::State<'_, AppState>) -> Result<Counts> {
    state.db.counts()
}

#[tauri::command]
pub async fn load_settings(state: tauri::State<'_, AppState>) -> Result<Settings> {
    Ok(state.settings.read().clone())
}

#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    mut settings: Settings,
) -> Result<Settings> {
    // Storage changes use the verified migration command; never accept a raw
    // path mutation through the general settings form.
    let previous = state.settings.read().clone();
    settings.storage_path = previous.storage_path.clone();
    let hotkey_changed = settings.hotkey != previous.hotkey;
    if hotkey_changed {
        switch_hotkey(&app, &settings.hotkey)?;
    }
    if let Err(error) = state.db.save_settings(&settings) {
        if hotkey_changed {
            if let Err(rollback_error) = switch_hotkey(&app, &previous.hotkey) {
                log::error!("could not restore the previous hotkey: {rollback_error}");
            }
        }
        return Err(error);
    }
    {
        let mut current = state.settings.write();
        *current = settings.clone();
    }
    apply_runtime_settings(&app, &settings)?;
    enforce_history_policy(&state)?;
    let _ = app.emit("settings-updated", &settings);
    Ok(settings)
}

#[tauri::command]
pub async fn change_storage_location(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<Settings> {
    let _storage_guard = state.storage_operation.write();
    let target = PathBuf::from(path.trim());
    if !target.is_absolute() {
        return Err(Error::Other(
            "storage location must be an absolute path".into(),
        ));
    }
    let old_root = state.storage_root.read().clone();
    if target == old_root {
        return Ok(state.settings.read().clone());
    }
    if crate::storage::paths_overlap(&target, &old_root)? {
        return Err(Error::Other(
            "choose a storage folder outside the current storage tree".into(),
        ));
    }

    // Reject occupied targets before the asset scope is granted or any files
    // are copied. A successful validation makes later rollback safe.
    crate::storage::validate_empty_migration_target(&target)?;

    crate::storage::copy_managed_storage(&old_root, &target)?;
    if let Err(error) = allow_storage_target_scope(&app, &target) {
        rollback_storage_target(&app, &target);
        return Err(error);
    }
    let mut next = state.settings.read().clone();
    next.storage_path = Some(target.to_string_lossy().into_owned());
    if let Err(error) = state.db.migrate_storage(&old_root, &target, &next) {
        rollback_storage_target(&app, &target);
        return Err(error);
    }
    *state.storage_root.write() = target;
    *state.settings.write() = next.clone();
    revoke_storage_target_scope(&app, &old_root);
    if let Err(error) = crate::storage::remove_managed_directories(&old_root) {
        log::warn!("old managed storage cleanup was skipped: {error}");
    }
    let _ = app.emit("settings-updated", &next);
    let _ = app.emit("clip-storage-migrated", ());
    Ok(next)
}

#[tauri::command]
pub async fn prune_now(state: tauri::State<'_, AppState>) -> Result<()> {
    enforce_history_policy(&state)
}

#[tauri::command]
pub async fn appearance() -> Result<SystemAppearance> {
    Ok(crate::win::appearance::read())
}

#[tauri::command]
pub async fn open_settings_window(app: AppHandle) -> Result<()> {
    show_settings_window(&app).map_err(Error::Other)
}

#[tauri::command]
pub async fn hide_window(window: tauri::WebviewWindow) -> Result<()> {
    crate::window::hide(&window);
    Ok(())
}

#[tauri::command]
pub async fn set_always_on_top(window: tauri::WebviewWindow, value: bool) -> Result<bool> {
    window
        .set_always_on_top(value)
        .map_err(|error| Error::Other(error.to_string()))?;
    Ok(value)
}

#[tauri::command]
pub async fn set_preview_visible(window: tauri::WebviewWindow, value: bool) -> Result<bool> {
    use tauri::{LogicalSize, Size};

    let current = window
        .inner_size()
        .map_err(|error| Error::Other(error.to_string()))?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let logical_width = f64::from(current.width) / scale;
    let logical_height = f64::from(current.height) / scale;
    if value {
        window
            .set_min_size(Some(Size::Logical(LogicalSize::new(920.0, 600.0))))
            .map_err(|error| Error::Other(error.to_string()))?;
        if logical_width < 920.0 {
            window
                .set_size(LogicalSize::new(1120.0, logical_height.max(600.0)))
                .map_err(|error| Error::Other(error.to_string()))?;
        }
    } else {
        window
            .set_min_size(Some(Size::Logical(LogicalSize::new(420.0, 600.0))))
            .map_err(|error| Error::Other(error.to_string()))?;
        if logical_width > 620.0 {
            window
                .set_size(LogicalSize::new(520.0, logical_height.max(600.0)))
                .map_err(|error| Error::Other(error.to_string()))?;
        }
    }
    Ok(value)
}

#[tauri::command]
pub async fn sync_state(state: tauri::State<'_, AppState>) -> Result<SyncState> {
    let settings = state.settings.read().clone();
    Ok(state.sync.state(&settings))
}

#[tauri::command]
pub async fn regenerate_pairing_code(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Settings> {
    let mut next = state.settings.read().clone();
    next.sync_pairing_code = format!(
        "{:06}",
        (crate::models::now_ms().unsigned_abs() ^ u64::from(std::process::id())) % 1_000_000
    );
    state.db.save_settings(&next)?;
    *state.settings.write() = next.clone();
    apply_runtime_settings(&app, &next)?;
    let _ = app.emit("settings-updated", &next);
    let _ = app.emit("sync-peers-updated", ());
    Ok(next)
}

#[tauri::command]
pub async fn quit_app(app: AppHandle) -> Result<()> {
    app.exit(0);
    Ok(())
}

// ---- helpers -------------------------------------------------------------

fn cleanup_asset_paths(storage_root: &std::path::Path, orphans: Vec<String>) {
    for path in orphans {
        let p = PathBuf::from(&path);
        if let Err(err) = crate::storage::remove_managed_asset(storage_root, &p) {
            log::debug!("could not remove orphan {path}: {err}");
        }
    }
}

fn rollback_storage_target(app: &AppHandle, target: &std::path::Path) {
    revoke_storage_target_scope(app, target);
    if let Err(error) = crate::storage::remove_managed_directories(target) {
        log::warn!("failed storage target cleanup was incomplete: {error}");
    }
}

fn allow_storage_target_scope(app: &AppHandle, target: &std::path::Path) -> Result<()> {
    for managed_root in crate::storage::managed_asset_roots(target) {
        app.asset_protocol_scope()
            .allow_directory(managed_root, true)
            .map_err(|error| Error::Other(error.to_string()))?;
    }
    Ok(())
}

fn revoke_storage_target_scope(app: &AppHandle, target: &std::path::Path) {
    for managed_root in crate::storage::managed_asset_roots(target) {
        if let Err(error) = app
            .asset_protocol_scope()
            .forbid_directory(managed_root, true)
        {
            log::warn!("failed storage target scope could not be removed: {error}");
        }
    }
}

fn enforce_history_policy(state: &tauri::State<'_, AppState>) -> Result<()> {
    let _storage_guard = state.storage_operation.read();
    let settings = state.settings.read().clone();
    let storage_root = state.storage_root.read().clone();
    let orphans = state
        .db
        .prune(settings.max_items, settings.retention_days)?;
    cleanup_asset_paths(&storage_root, orphans);
    Ok(())
}

/// Applies retention immediately during startup, before clipboard capture can
/// enqueue background asset work.
pub fn enforce_history_policy_on_startup(app: &App) -> Result<()> {
    let state: tauri::State<AppState> = app.state();
    enforce_history_policy(&state)
}

/// Installs the saved global shortcut without making startup depend on it. A
/// stale, unsupported, or OS-conflicting binding is replaced with the first
/// available safe fallback and persisted so the UI stays truthful.
pub fn install_hotkey(app: &App) {
    let state: tauri::State<AppState> = app.state();
    let saved = state.settings.read().hotkey.clone();
    if switch_hotkey(app.handle(), &saved).is_ok() {
        return;
    }

    log::warn!("saved global shortcut is unavailable; trying safe fallbacks");
    for fallback in ["Ctrl+Shift+V", "Ctrl+Alt+V", "Ctrl+Shift+C"] {
        if fallback == saved {
            continue;
        }
        if switch_hotkey(app.handle(), fallback).is_ok() {
            let mut settings = state.settings.write().clone();
            settings.hotkey = fallback.to_string();
            if let Err(error) = state.db.save_settings(&settings) {
                log::error!("could not persist fallback global shortcut: {error}");
            }
            *state.settings.write() = settings.clone();
            let _ = app.emit("settings-updated", &settings);
            return;
        }
    }
    log::error!("no safe global shortcut could be registered; use the tray icon to open Clipdeck");
}

/// Spawns the clipboard listener with a sink that writes to the DB and emits
/// `clip-updated` events to the frontend.
pub fn install_clipboard_listener(app: &App) -> Result<()> {
    let state: tauri::State<AppState> = app.state();
    let (snapshot_tx, snapshot_rx) = mpsc::sync_channel::<SnapshotJob>(16);
    let snapshot_db = Arc::clone(&state.db);
    let snapshot_app = app.handle().clone();
    let snapshot_storage_root = Arc::clone(&state.storage_root);
    let snapshot_storage_operation = Arc::clone(&state.storage_operation);
    std::thread::Builder::new()
        .name("file-snapshot".into())
        .spawn(move || {
            while let Ok(job) = snapshot_rx.recv() {
                let _storage_guard = snapshot_storage_operation.read();
                if snapshot_db.get(job.id).ok().flatten().is_none() {
                    continue;
                }
                let storage_root = snapshot_storage_root.read().clone();
                match crate::storage::snapshot_files(
                    &storage_root,
                    &job.hash,
                    &job.originals,
                    job.max_bytes,
                ) {
                    Ok(assets) => match snapshot_db.set_file_assets(job.id, &assets) {
                        Ok(orphans) => {
                            cleanup_asset_paths(&storage_root, orphans);
                            if let Ok(item) = snapshot_db.get_required(job.id) {
                                let _ = snapshot_app.emit("clip-updated", &item);
                            }
                        }
                        Err(error) => {
                            let group = crate::storage::file_root(&storage_root).join(&job.hash);
                            if group.exists() {
                                cleanup_asset_paths(
                                    &storage_root,
                                    vec![group.to_string_lossy().into_owned()],
                                );
                            }
                            log::error!("file snapshot DB update failed: {error}");
                        }
                    },
                    Err(error) => {
                        let group = crate::storage::file_root(&storage_root).join(&job.hash);
                        if group.exists() {
                            cleanup_asset_paths(
                                &storage_root,
                                vec![group.to_string_lossy().into_owned()],
                            );
                        }
                        log::error!("file snapshot failed: {error}");
                    }
                }
            }
        })
        .map_err(|error| Error::Other(format!("snapshot worker start failed: {error}")))?;

    let sink = Arc::new(TauriSink {
        db: Arc::clone(&state.db),
        app: app.handle().clone(),
        storage_root: Arc::clone(&state.storage_root),
        storage_operation: Arc::clone(&state.storage_operation),
        settings: Arc::clone(&state.settings),
        sync: state.sync.clone(),
        snapshot_tx,
    });
    listener::start_listener(sink).map_err(|e| Error::Other(format!("listener start failed: {e}")))
}

/// Bridge from the listener thread to the DB and the webview.
struct TauriSink {
    db: Arc<Db>,
    app: AppHandle,
    storage_root: Arc<parking_lot::RwLock<PathBuf>>,
    storage_operation: Arc<parking_lot::RwLock<()>>,
    settings: Arc<parking_lot::RwLock<Settings>>,
    sync: crate::sync::SyncService,
    snapshot_tx: mpsc::SyncSender<SnapshotJob>,
}

struct SnapshotJob {
    id: i64,
    hash: String,
    originals: Vec<String>,
    max_bytes: u64,
}

impl CaptureSink for TauriSink {
    fn handle(&self, event: ClipEvent) {
        let settings = self.settings.read().clone();
        if (event.kind == ItemKind::Image && !settings.capture_images)
            || (event.kind == ItemKind::Files && !settings.capture_files)
        {
            return;
        }
        if event.source.as_ref().is_some_and(|source| {
            settings
                .ignored_apps
                .iter()
                .any(|ignored| source_matches_ignored(source, ignored))
        }) {
            return;
        }

        let _storage_guard = self.storage_operation.read();
        let storage_root = self.storage_root.read().clone();
        match persist(&self.db, &storage_root, &event, &settings) {
            Ok(Persisted { item, is_new }) => {
                match self.db.prune(settings.max_items, settings.retention_days) {
                    Ok(orphans) => cleanup_asset_paths(&storage_root, orphans),
                    Err(error) => log::error!("automatic history cleanup failed: {error}"),
                }
                if is_new {
                    let _ = self.app.emit("clip-updated", &item);
                    self.sync.enqueue_item(&item);
                } else {
                    let _ = self.app.emit("clip-touched", &event.content_hash);
                }

                let retryable_assets = item.file_assets.is_empty()
                    || item.file_assets.iter().all(|asset| {
                        matches!(
                            asset.status,
                            StoredFileStatus::Failed | StoredFileStatus::Skipped
                        )
                    });
                if event.kind == ItemKind::Files
                    && settings.store_file_snapshots
                    && !event.files.is_empty()
                    && (is_new || retryable_assets)
                {
                    let job = SnapshotJob {
                        id: item.id,
                        hash: event.content_hash.clone(),
                        originals: event.files.clone(),
                        max_bytes: u64::from(settings.max_snapshot_size_mb) * 1024 * 1024,
                    };
                    match self.snapshot_tx.try_send(job) {
                        Ok(()) => {}
                        Err(mpsc::TrySendError::Full(job)) => {
                            self.mark_snapshot_failed(
                                job,
                                &storage_root,
                                "Snapshot queue was busy; copy the files again to retry",
                            );
                        }
                        Err(mpsc::TrySendError::Disconnected(job)) => {
                            self.mark_snapshot_failed(
                                job,
                                &storage_root,
                                "Snapshot worker is unavailable",
                            );
                        }
                    }
                }
            }
            Err(err) => log::error!("failed to persist clipboard event: {err}"),
        }
    }
}

fn source_matches_ignored(source: &crate::models::SourceApp, ignored: &str) -> bool {
    let ignored = ignored.trim();
    if ignored.is_empty() {
        return false;
    }
    source.name.eq_ignore_ascii_case(ignored)
        || source.exe_path.eq_ignore_ascii_case(ignored)
        || PathBuf::from(&source.exe_path)
            .file_name()
            .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(ignored))
}

impl TauriSink {
    fn mark_snapshot_failed(
        &self,
        job: SnapshotJob,
        storage_root: &std::path::Path,
        message: &str,
    ) {
        let assets: Vec<StoredFile> = job
            .originals
            .iter()
            .map(|path| StoredFile {
                original_path: path.clone(),
                stored_path: None,
                size_bytes: 0,
                is_directory: PathBuf::from(path).is_dir(),
                status: StoredFileStatus::Failed,
                message: Some(message.to_string()),
            })
            .collect();
        match self.db.set_file_assets(job.id, &assets) {
            Ok(orphans) => cleanup_asset_paths(storage_root, orphans),
            Err(error) => log::error!("could not record snapshot queue failure: {error}"),
        }
    }
}

struct Persisted {
    item: ClipItem,
    is_new: bool,
}

fn persist(
    db: &Db,
    storage_root: &std::path::Path,
    event: &ClipEvent,
    settings: &Settings,
) -> Result<Persisted> {
    let (image_meta, size_bytes) = if event.kind == ItemKind::Image {
        let bytes = event
            .image_bytes
            .as_deref()
            .ok_or_else(|| Error::Other("captured image bytes were missing".into()))?;
        let hash = &event.content_hash;
        let img_path = crate::storage::image_root(storage_root).join(format!("{hash}.png"));
        let thumb_path = crate::storage::thumb_root(storage_root).join(format!("{hash}.png"));
        std::fs::write(&img_path, bytes)?;
        write_thumbnail(bytes, &thumb_path)?;
        let (w, h) = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
            .map(|img| (img.width(), img.height()))
            .unwrap_or((0, 0));
        (
            Some(ImageMeta {
                path: img_path.to_string_lossy().to_string(),
                thumb_path: thumb_path.to_string_lossy().to_string(),
                width: w,
                height: h,
            }),
            bytes.len() as i64,
        )
    } else {
        (None, event.size_bytes)
    };

    let file_assets = if event.kind == ItemKind::Files && settings.store_file_snapshots {
        event
            .files
            .iter()
            .map(|path| StoredFile {
                original_path: path.clone(),
                stored_path: None,
                size_bytes: 0,
                is_directory: PathBuf::from(path).is_dir(),
                status: StoredFileStatus::Pending,
                message: None,
            })
            .collect()
    } else {
        Vec::new()
    };

    let new = crate::models::NewItem {
        kind: event.kind,
        preview: event.preview.clone(),
        content: event.content.clone(),
        html: event.html.clone(),
        rtf: event.rtf.clone(),
        image: image_meta.clone(),
        files: event.files.clone(),
        file_assets,
        size_bytes,
        content_hash: event.content_hash.clone(),
        source: event.source.clone(),
        device: None,
        sync_status: crate::models::SyncStatus::Local,
    };

    let upsert = db.upsert(&new)?;
    let item = db.get_required(upsert.id())?;
    Ok(Persisted {
        item,
        is_new: upsert.is_new(),
    })
}

fn write_thumbnail(bytes: &[u8], dest: &std::path::Path) -> Result<()> {
    let img = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
        .map_err(Error::Image)?;
    let thumb = img.thumbnail(256, 256);
    thumb
        .save_with_format(dest, image::ImageFormat::Png)
        .map_err(Error::Image)
}

/// Pushes the runtime parts of the settings (hotkey, backdrop, theme) to the
/// running app. Called from `save_settings`.
pub fn apply_runtime_settings(app: &AppHandle, settings: &Settings) -> Result<()> {
    crate::native_appearance::apply_all(app, settings);
    let autostart = app.autolaunch();
    let autostart_result = if settings.launch_at_login {
        autostart.enable()
    } else {
        autostart.disable()
    };
    if let Err(error) = autostart_result {
        log::warn!("could not update launch-at-login setting: {error}");
    }
    Ok(())
}

fn switch_hotkey(app: &AppHandle, combo: &str) -> Result<()> {
    let shortcut = crate::hotkey::parse(combo)?;
    let state: tauri::State<AppState> = app.state();
    let mut active = state.active_hotkey.lock();
    if active.as_ref() == Some(&shortcut) {
        return Ok(());
    }

    let manager = app.global_shortcut();
    manager
        .on_shortcut(shortcut, move |app, _scut, event| {
            if matches!(event.state(), ShortcutState::Pressed) {
                if let Some(window) = app.get_webview_window("main") {
                    crate::window::toggle(&window);
                }
            }
        })
        .map_err(|e| Error::Other(format!("hotkey registration failed: {e}")))?;

    if let Some(previous) = *active {
        if let Err(error) = manager.unregister(previous) {
            if let Err(rollback_error) = manager.unregister(shortcut) {
                log::error!("could not roll back new hotkey registration: {rollback_error}");
            }
            return Err(Error::Other(format!(
                "previous hotkey could not be released: {error}"
            )));
        }
    }
    *active = Some(shortcut);
    Ok(())
}

pub fn show_settings_window(app: &AppHandle) -> std::result::Result<(), String> {
    if let Some(existing) = app.get_webview_window("settings") {
        let state: tauri::State<AppState> = app.state();
        let settings = state.settings.read().clone();
        let system = crate::win::appearance::read();
        crate::native_appearance::apply_window(&existing, &settings, &system);
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let window =
        WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
            .title("Clipdeck settings")
            .inner_size(800.0, 680.0)
            .min_inner_size(680.0, 560.0)
            .resizable(true)
            .decorations(true)
            .skip_taskbar(true)
            .center()
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;
    let state: tauri::State<AppState> = app.state();
    let settings = state.settings.read().clone();
    let system = crate::win::appearance::read();
    crate::native_appearance::apply_window(&window, &settings, &system);
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

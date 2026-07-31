//! Tauri command handlers and one-shot helper functions.
//!
//! Commands return `Result<T, Error>` so the frontend always receives a
//! uniform error shape. Helper functions (no `#[tauri::command]`) live here
//! too when they need to be called from `lib.rs` or `tray.rs`.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{App, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::clipboard::listener::{self, CaptureSink, ClipEvent};
use crate::db::Db;
use crate::error::{Error, Result};
use crate::models::{
    ClipItem, Counts, ImageMeta, ItemKind, ListQuery, PasteFlavor, Settings, SystemAppearance,
};
use crate::win::paste;
use crate::AppState;

// ---- command handlers ----------------------------------------------------

#[tauri::command]
pub async fn list_items(
    state: tauri::State<'_, AppState>,
    query: ListQuery,
) -> Result<Vec<ClipItem>> {
    state.db.list(&query)
}

#[tauri::command]
pub async fn get_item(state: tauri::State<'_, AppState>, id: i64) -> Result<ClipItem> {
    state.db.get(id)?.ok_or(Error::NotFound("clipboard item"))
}

#[tauri::command]
pub async fn flavors_for(state: tauri::State<'_, AppState>, id: i64) -> Result<FlavorBundle> {
    let item = state.db.get_required(id)?;
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
        html: if item.has_html {
            Some(item.content.clone())
        } else {
            None
        },
        rtf: if item.has_rtf {
            Some(item.content.clone())
        } else {
            None
        },
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
    state.db.touch(id)?;
    put_back_on_clipboard(&item, flavor)?;
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
    state.db.touch(id)?;

    put_back_on_clipboard(&item, flavor)?;

    let target = *state.foreground.lock();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    if !paste::paste_to(target) {
        log::warn!(
            "paste target HWND was invalid ({target}); keystroke may not have been delivered"
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn set_favorite(state: tauri::State<'_, AppState>, id: i64, value: bool) -> Result<()> {
    state.db.set_favorite(id, value)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_item(state: tauri::State<'_, AppState>, id: i64) -> Result<()> {
    let orphans = state.db.delete(id)?;
    cleanup_assets(&state, orphans);
    Ok(())
}

#[tauri::command]
pub async fn clear_history(
    state: tauri::State<'_, AppState>,
    include_favorites: bool,
) -> Result<()> {
    let orphans = state.db.clear(include_favorites)?;
    cleanup_assets(&state, orphans);
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
    settings: Settings,
) -> Result<Settings> {
    state.db.save_settings(&settings)?;
    {
        let mut current = state.settings.write();
        *current = settings.clone();
    }
    apply_runtime_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub async fn prune_now(state: tauri::State<'_, AppState>) -> Result<()> {
    let settings = state.settings.read().clone();
    let orphans = state
        .db
        .prune(settings.max_items, settings.retention_days)?;
    cleanup_assets(&state, orphans);
    Ok(())
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
pub async fn quit_app(app: AppHandle) -> Result<()> {
    app.exit(0);
    Ok(())
}

// ---- helpers -------------------------------------------------------------

/// Writes the requested item to the system clipboard so the target app sees it
/// when the synthesized keystroke arrives.
fn put_back_on_clipboard(item: &ClipItem, flavor: PasteFlavor) -> Result<()> {
    use windows::Win32::System::DataExchange::{CloseClipboard, OpenClipboard};

    unsafe {
        if OpenClipboard(None).is_err() {
            return Err(Error::Clipboard("OpenClipboard failed".into()));
        }

        // Empty the clipboard before re-populating it; otherwise the OS keeps
        // both the old and new data, which can confuse paste consumers.
        windows::Win32::System::DataExchange::EmptyClipboard()
            .map_err(|e| Error::Clipboard(format!("EmptyClipboard: {e}")))?;

        let result = match (item.kind, flavor) {
            (ItemKind::Image, _) => {
                // Image paste through the keyboard is rare; place the path
                // as plain text so users can still share or paste it.
                if let Some(image) = &item.image {
                    write_unicode_text(&image.path)?;
                }
                Ok(())
            }
            (ItemKind::Files, _) => {
                let paths: Vec<String> = item.files.clone();
                write_file_list(&paths)?;
                Ok(())
            }
            (_, PasteFlavor::PlainText) | (_, PasteFlavor::Original) => {
                write_unicode_text(&item.content)?;
                Ok(())
            }
        };

        let _ = CloseClipboard();
        result
    }
}

unsafe fn write_unicode_text(text: &str) -> Result<()> {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::DataExchange::SetClipboardData;
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    const CF_UNICODETEXT: u32 = 13;

    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let byte_len = wide.len() * std::mem::size_of::<u16>();

    let alloc = GlobalAlloc(GMEM_MOVEABLE, byte_len)
        .map_err(|e| Error::Clipboard(format!("GlobalAlloc: {e}")))?;
    let ptr = GlobalLock(alloc);
    if ptr.is_null() {
        return Err(Error::Clipboard("GlobalLock failed".into()));
    }
    std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, ptr as *mut u8, byte_len);
    let _ = GlobalUnlock(alloc);

    if SetClipboardData(CF_UNICODETEXT, Some(HANDLE(alloc.0))).is_err() {
        return Err(Error::Clipboard("SetClipboardData failed".into()));
    }
    Ok(())
}

unsafe fn write_file_list(paths: &[String]) -> Result<()> {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::DataExchange::SetClipboardData;
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    const CF_HDROP: u32 = 15;

    // Double-NUL-terminated list of file paths (CF_HDROP layout).
    let mut buffer: Vec<u16> = Vec::new();
    for path in paths {
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        buffer.extend(wide);
    }
    buffer.push(0);

    let byte_len = buffer.len() * std::mem::size_of::<u16>();
    let alloc = GlobalAlloc(GMEM_MOVEABLE, byte_len)
        .map_err(|e| Error::Clipboard(format!("GlobalAlloc: {e}")))?;
    let ptr = GlobalLock(alloc);
    if ptr.is_null() {
        return Err(Error::Clipboard("GlobalLock failed".into()));
    }
    std::ptr::copy_nonoverlapping(buffer.as_ptr() as *const u8, ptr as *mut u8, byte_len);
    let _ = GlobalUnlock(alloc);

    if SetClipboardData(CF_HDROP, Some(HANDLE(alloc.0))).is_err() {
        return Err(Error::Clipboard("SetClipboardData failed".into()));
    }
    Ok(())
}

/// Removes on-disk image files that the DB no longer references.
fn cleanup_assets(_state: &tauri::State<'_, AppState>, orphans: Vec<String>) {
    for path in orphans {
        let p = PathBuf::from(&path);
        if let Err(err) = std::fs::remove_file(&p) {
            log::debug!("could not remove orphan {path}: {err}");
        }
    }
}

/// Registers the global shortcut and keeps it in sync with the current
/// settings. Re-registration is required when the user changes the binding.
pub fn install_hotkey(app: &App) -> Result<()> {
    let state: tauri::State<AppState> = app.state();
    let settings = state.settings.read().clone();
    register_shortcut(app, &settings.hotkey)?;
    Ok(())
}

fn register_shortcut(app: &App, combo: &str) -> Result<()> {
    let manager = app.global_shortcut();
    manager.unregister_all().ok();

    let parts: Vec<&str> = combo.split('+').map(str::trim).collect();
    let mut modifiers = Modifiers::empty();
    let mut code: Option<Code> = None;
    for part in parts {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "shift" => modifiers |= Modifiers::SHIFT,
            "alt" => modifiers |= Modifiers::ALT,
            "super" | "win" | "meta" => modifiers |= Modifiers::META,
            key => {
                code = Some(
                    key_name_to_code(key)
                        .ok_or_else(|| Error::Other(format!("unknown hotkey token: {key}")))?,
                )
            }
        }
    }
    let code = code.ok_or_else(|| Error::Other("hotkey must include a non-modifier key".into()))?;
    let shortcut = Shortcut::new(Some(modifiers), code);

    let app_handle = app.handle().clone();
    manager
        .on_shortcut(shortcut, move |_app, _scut, event| {
            if matches!(event.state(), ShortcutState::Pressed) {
                if let Some(window) = app_handle.get_webview_window("main") {
                    crate::window::toggle(&window);
                }
            }
        })
        .map_err(|e| Error::Other(format!("hotkey registration failed: {e}")))?;
    Ok(())
}

fn key_name_to_code(name: &str) -> Option<Code> {
    use Code::*;
    let normalized = name.to_ascii_uppercase();
    Some(match normalized.as_str() {
        "A" => KeyA,
        "B" => KeyB,
        "C" => KeyC,
        "D" => KeyD,
        "E" => KeyE,
        "F" => KeyF,
        "G" => KeyG,
        "H" => KeyH,
        "I" => KeyI,
        "J" => KeyJ,
        "K" => KeyK,
        "L" => KeyL,
        "M" => KeyM,
        "N" => KeyN,
        "O" => KeyO,
        "P" => KeyP,
        "Q" => KeyQ,
        "R" => KeyR,
        "S" => KeyS,
        "T" => KeyT,
        "U" => KeyU,
        "V" => KeyV,
        "W" => KeyW,
        "X" => KeyX,
        "Y" => KeyY,
        "Z" => KeyZ,
        "0" => Digit0,
        "1" => Digit1,
        "2" => Digit2,
        "3" => Digit3,
        "4" => Digit4,
        "5" => Digit5,
        "6" => Digit6,
        "7" => Digit7,
        "8" => Digit8,
        "9" => Digit9,
        "F1" => F1,
        "F2" => F2,
        "F3" => F3,
        "F4" => F4,
        "F5" => F5,
        "F6" => F6,
        "F7" => F7,
        "F8" => F8,
        "F9" => F9,
        "F10" => F10,
        "F11" => F11,
        "F12" => F12,
        "SPACE" => Space,
        "ENTER" => Enter,
        "TAB" => Tab,
        "ESC" => Escape,
        "ESCAPE" => Escape,
        "INSERT" => Insert,
        "DELETE" | "DEL" => Delete,
        "HOME" => Home,
        "END" => End,
        "PAGEUP" | "PGUP" => PageUp,
        "PAGEDOWN" | "PGDN" => PageDown,
        "LEFT" => ArrowLeft,
        "RIGHT" => ArrowRight,
        "UP" => ArrowUp,
        "DOWN" => ArrowDown,
        "BACKSLASH" => Backslash,
        "SLASH" => Slash,
        "COMMA" => Comma,
        "PERIOD" => Period,
        "SEMICOLON" => Semicolon,
        "QUOTE" => Quote,
        "BACKQUOTE" | "`" => Backquote,
        "MINUS" | "-" => Minus,
        "EQUALS" | "=" => Equal,
        "[" => BracketLeft,
        "]" => BracketRight,
        _ => return None,
    })
}

/// Spawns the clipboard listener with a sink that writes to the DB and emits
/// `clip-updated` events to the frontend.
pub fn install_clipboard_listener(app: &App) -> Result<()> {
    let state: tauri::State<AppState> = app.state();
    let sink = Arc::new(TauriSink {
        db: Arc::clone(&state.db),
        app: app.handle().clone(),
        image_root: state.image_root.clone(),
        thumb_root: state.thumb_root.clone(),
    });
    listener::start_listener(sink).map_err(|e| Error::Other(format!("listener start failed: {e}")))
}

/// Bridge from the listener thread to the DB and the webview.
struct TauriSink {
    db: Arc<Db>,
    app: AppHandle,
    image_root: PathBuf,
    thumb_root: PathBuf,
}

impl CaptureSink for TauriSink {
    fn handle(&self, event: ClipEvent) {
        match persist(&self.db, &self.image_root, &self.thumb_root, &event) {
            Ok(Some(item)) => {
                let _ = self.app.emit("clip-updated", &item);
            }
            Ok(None) => {
                // Dedup hit — emit a refresh so the list re-orders by recency.
                let _ = self.app.emit("clip-touched", &event.content_hash);
            }
            Err(err) => log::error!("failed to persist clipboard event: {err}"),
        }
    }
}

fn persist(
    db: &Db,
    image_root: &std::path::Path,
    thumb_root: &std::path::Path,
    event: &ClipEvent,
) -> Result<Option<crate::models::ClipItem>> {
    let (image_meta, size_bytes) = if event.kind == ItemKind::Image {
        let bytes = event
            .image_bytes
            .as_deref()
            .ok_or_else(|| Error::Other("captured image bytes were missing".into()))?;
        let hash = &event.content_hash;
        let img_path = image_root.join(format!("{hash}.png"));
        let thumb_path = thumb_root.join(format!("{hash}.png"));
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

    let new = crate::models::NewItem {
        kind: event.kind,
        preview: event.preview.clone(),
        content: event.content.clone(),
        has_html: event.has_html,
        has_rtf: event.has_rtf,
        image: image_meta.clone(),
        files: event.files.clone(),
        size_bytes,
        content_hash: event.content_hash.clone(),
        source: event.source.clone(),
    };

    let upsert = db.upsert(&new)?;
    let item = db.get(upsert.id())?;
    Ok(upsert.is_new().then_some(item).flatten())
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
    if let Err(e) = register_shortcut_on_handle(app, &settings.hotkey) {
        log::warn!("could not re-register hotkey: {e}");
    }
    if let Some(window) = app.get_webview_window("main") {
        let dark = crate::win::appearance::read().dark;
        let effective = crate::win::backdrop::apply(&window, settings.backdrop, dark);
        let _ = window.eval(format!(
            "window.dispatchEvent(new CustomEvent('clipdeck:backdrop', {{ detail: {:?} }}));",
            effective
        ));
    }
    Ok(())
}

fn register_shortcut_on_handle(app: &AppHandle, combo: &str) -> Result<()> {
    let manager = app.global_shortcut();
    manager.unregister_all().ok();

    let parts: Vec<&str> = combo.split('+').map(str::trim).collect();
    let mut modifiers = Modifiers::empty();
    let mut code: Option<Code> = None;
    for part in parts {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "shift" => modifiers |= Modifiers::SHIFT,
            "alt" => modifiers |= Modifiers::ALT,
            "super" | "win" | "meta" => modifiers |= Modifiers::META,
            key => {
                code = Some(
                    key_name_to_code(key)
                        .ok_or_else(|| Error::Other(format!("unknown hotkey token: {key}")))?,
                )
            }
        }
    }
    let code = code.ok_or_else(|| Error::Other("hotkey must include a non-modifier key".into()))?;
    let shortcut = Shortcut::new(Some(modifiers), code);

    let app_handle = app.clone();
    manager
        .on_shortcut(shortcut, move |_app, _scut, event| {
            if matches!(event.state(), ShortcutState::Pressed) {
                if let Some(window) = app_handle.get_webview_window("main") {
                    crate::window::toggle(&window);
                }
            }
        })
        .map_err(|e| Error::Other(format!("hotkey registration failed: {e}")))?;
    Ok(())
}

pub fn show_settings_window(app: &AppHandle) -> std::result::Result<(), String> {
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Clipdeck settings")
        .inner_size(720.0, 560.0)
        .min_inner_size(560.0, 420.0)
        .resizable(true)
        .decorations(true)
        .center()
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

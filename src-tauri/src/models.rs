//! Data types shared between the Rust core and the web frontend.
//!
//! All types are `camelCase` on the wire to match TypeScript conventions; the
//! mirrored definitions live in `src/lib/types.ts`.

use serde::{Deserialize, Serialize};

/// The high-level category of a clipboard entry.
///
/// This drives both the icon shown in the list and the filter tabs. It is
/// derived once at capture time (see `clipboard::classify`) so that filtering
/// never has to re-parse content.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    #[default]
    Text,
    Link,
    Email,
    Color,
    Image,
    Files,
}

impl ItemKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Link => "link",
            Self::Email => "email",
            Self::Color => "color",
            Self::Image => "image",
            Self::Files => "files",
        }
    }

    pub fn from_db_value(value: &str) -> Self {
        match value {
            "link" => Self::Link,
            "email" => Self::Email,
            "color" => Self::Color,
            "image" => Self::Image,
            "files" => Self::Files,
            _ => Self::Text,
        }
    }
}

/// Metadata about a captured image. The bytes themselves live on disk so that
/// listing the history never loads image data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMeta {
    /// Absolute path to the full-resolution PNG.
    pub path: String,
    /// Absolute path to the downscaled preview PNG.
    pub thumb_path: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StoredFileStatus {
    #[default]
    Pending,
    Ready,
    Skipped,
    Failed,
}

/// Durable snapshot metadata for a copied file or folder. The original path is
/// display-only; history cleanup never mutates the original filesystem item.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredFile {
    pub original_path: String,
    pub stored_path: Option<String>,
    pub size_bytes: u64,
    pub is_directory: bool,
    pub status: StoredFileStatus,
    pub message: Option<String>,
}

/// The application that owned the clipboard when an entry was captured.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceApp {
    /// Friendly name, e.g. "Visual Studio Code".
    pub name: String,
    /// Full path to the executable.
    pub exe_path: String,
    /// Absolute path to the extracted 32x32 PNG icon, if extraction succeeded.
    pub icon_path: Option<String>,
}

/// A single clipboard history entry as sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipItem {
    pub id: i64,
    pub kind: ItemKind,
    /// Single-line label rendered in the list (already trimmed and truncated).
    pub preview: String,
    /// Full plain-text payload. Empty for image entries.
    pub content: String,
    /// Whether a rich HTML flavour was captured alongside the plain text.
    pub has_html: bool,
    /// Whether an RTF flavour was captured alongside the plain text.
    pub has_rtf: bool,
    pub image: Option<ImageMeta>,
    pub files: Vec<String>,
    pub file_assets: Vec<StoredFile>,
    pub size_bytes: i64,
    pub source: Option<SourceApp>,
    pub favorite: bool,
    pub copy_count: i64,
    /// Unix milliseconds.
    pub first_copied_at: i64,
    /// Unix milliseconds.
    pub last_copied_at: i64,
}

/// Filter + paging parameters for a history query.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    /// Free-text search. When present, matched via SQLite FTS5 prefix search.
    #[serde(default)]
    pub search: Option<String>,
    /// Restrict to one or more categories. Empty = no kind filter.
    #[serde(default)]
    pub kinds: Vec<ItemKind>,
    /// Only return starred entries.
    #[serde(default)]
    pub favorites_only: bool,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

/// Which rich flavour to place on the clipboard when copying an entry back.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PasteFlavor {
    /// Restore every flavour that was captured (HTML/RTF/image/files).
    #[default]
    Original,
    /// Force plain text, discarding formatting.
    PlainText,
}

/// User-facing configuration, persisted in the `settings` table.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Settings schema version used for one-time behavioral migrations.
    #[serde(default = "default_settings_version")]
    pub settings_version: u32,
    /// Global hotkey in Tauri accelerator syntax, e.g. `Ctrl+Shift+V`.
    pub hotkey: String,
    /// Maximum number of non-favorite entries retained. 0 disables pruning.
    pub max_items: u32,
    /// Delete non-favorite entries older than this many days. 0 disables.
    pub retention_days: u32,
    /// Capture images from the clipboard.
    pub capture_images: bool,
    /// Capture file/folder copies.
    pub capture_files: bool,
    /// Save durable snapshots for file/folder clipboard entries.
    #[serde(default = "default_true")]
    pub store_file_snapshots: bool,
    /// Maximum bytes stored for one clipboard file or folder group.
    #[serde(default = "default_snapshot_limit_mb")]
    pub max_snapshot_size_mb: u32,
    /// Optional managed-content root. `None` uses Windows app data.
    #[serde(default)]
    pub storage_path: Option<String>,
    /// Skip entries whose source executable matches one of these names.
    pub ignored_apps: Vec<String>,
    /// Window backdrop material.
    pub backdrop: Backdrop,
    /// Theme preference.
    pub theme: ThemeMode,
    /// Paste immediately into the previously focused app on Enter.
    pub paste_on_enter: bool,
    /// Launch Clipdeck when Windows starts.
    pub launch_at_login: bool,
    /// Show the preview pane.
    pub show_preview: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            settings_version: 2,
            // Win+V is reserved by the OS shell and cannot be intercepted by a
            // user process, so we default to the de-facto convention used by
            // third-party clipboard managers on Windows.
            hotkey: "Ctrl+Shift+V".to_string(),
            max_items: 10_000,
            retention_days: 0,
            capture_images: true,
            capture_files: true,
            store_file_snapshots: true,
            max_snapshot_size_mb: 512,
            storage_path: None,
            ignored_apps: Vec::new(),
            backdrop: Backdrop::Acrylic,
            theme: ThemeMode::System,
            paste_on_enter: true,
            launch_at_login: false,
            show_preview: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Backdrop {
    /// Desktop Acrylic — matches the Windows 11 transient flyout material.
    Acrylic,
    /// Mica — tinted desktop wallpaper, cheaper to composite.
    Mica,
    /// Opaque Fluent neutral surface. Always available.
    Solid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    System,
    Light,
    Dark,
}

/// OS-derived appearance information pushed to the frontend so the web layer can
/// match the current Windows personalisation settings.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemAppearance {
    /// Accent colour as `#RRGGBB`.
    pub accent: String,
    /// True when Windows is set to a dark app theme.
    pub dark: bool,
}

/// Aggregate counters surfaced to the UI for the bottom status line.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    /// Total entries currently stored.
    pub total: i64,
    /// Entries marked as favourite.
    pub favorites: i64,
    /// Entries pinned by the user (alias for favourites; reserved for the
    /// pin feature added in a later iteration).
    pub pinned: i64,
    pub text: i64,
    pub images: i64,
    pub files: i64,
    pub links: i64,
    pub colors: i64,
    pub emails: i64,
    pub storage_bytes: i64,
}

/// The payload the listener hands to the persistence layer for each new
/// clipboard change. Defined here so the wire contract and the DB insert
/// shape stay aligned.
#[derive(Debug, Clone, Default)]
pub struct NewItem {
    pub kind: ItemKind,
    pub preview: String,
    pub content: String,
    /// Original rich clipboard flavours. These are kept separately from plain
    /// text so copying an entry back can faithfully restore formatting.
    pub html: Option<String>,
    pub rtf: Option<String>,
    pub image: Option<ImageMeta>,
    pub files: Vec<String>,
    pub file_assets: Vec<StoredFile>,
    pub size_bytes: i64,
    pub content_hash: String,
    pub source: Option<SourceApp>,
}

fn default_true() -> bool {
    true
}

fn default_snapshot_limit_mb() -> u32 {
    512
}

fn default_settings_version() -> u32 {
    2
}

/// Current unix timestamp in milliseconds.
pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

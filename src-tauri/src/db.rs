//! SQLite persistence layer.
//!
//! Design notes:
//! * A single connection guarded by a `parking_lot::Mutex` is used rather than a
//!   pool. Writes happen at human speed (once per copy) and reads are driven by
//!   keystrokes, so contention is nil and we avoid pool overhead entirely.
//! * WAL + `synchronous=NORMAL` keeps the write-per-copy path off the fsync path.
//! * Full-text search uses an FTS5 *external content* table, so the searchable
//!   text is not duplicated on disk. Sync triggers only fire when the indexed
//!   columns actually change, so toggling a star never touches the index.
//! * Image bytes live on disk, never in the database, so listing history rows
//!   stays cheap regardless of how many screenshots were captured.

use std::path::Path;

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::error::{Error, Result};
use crate::models::{
    now_ms, ClipItem, Counts, ImageMeta, ItemKind, ListQuery, NewItem, Settings, SourceApp,
};

/// Column list shared by every read query so that `row_to_item` stays valid.
const COLUMNS: &str = "id, kind, preview, content, html, rtf, image_path, thumb_path, \
     image_w, image_h, file_paths, size_bytes, app_name, app_exe, app_icon, \
     favorite, copy_count, first_copied_at, last_copied_at";

/// Plain text plus the optional HTML and RTF representations stored for an item.
pub type RichFlavors = (String, Option<String>, Option<String>);

/// Longest preview label we store. Anything longer is truncated for display but
/// the full payload is preserved in `content`.
const PREVIEW_LIMIT: usize = 320;

/// Outcome of a capture, so callers know whether to notify the UI of a brand new
/// row or of a reordered existing one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Upsert {
    Inserted(i64),
    Bumped(i64),
}

impl Upsert {
    pub fn id(self) -> i64 {
        match self {
            Self::Inserted(id) | Self::Bumped(id) => id,
        }
    }

    pub fn is_new(self) -> bool {
        matches!(self, Self::Inserted(_))
    }
}

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    /// Opens (creating if needed) the history database and applies migrations.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        Self::configure(&conn)?;
        Self::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// In-memory database, used by the unit tests.
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::configure(&conn)?;
        Self::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn configure(conn: &Connection) -> Result<()> {
        // `journal_mode` returns a row, so it must use `query_row` not `execute`.
        conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
        conn.execute_batch(
            "PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA temp_store = MEMORY;
             PRAGMA mmap_size = 67108864;",
        )?;
        Ok(())
    }

    fn migrate(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            r#"
CREATE TABLE IF NOT EXISTS items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    kind            TEXT    NOT NULL,
    preview         TEXT    NOT NULL,
    content         TEXT    NOT NULL DEFAULT '',
    html            TEXT,
    rtf             TEXT,
    image_path      TEXT,
    thumb_path      TEXT,
    image_w         INTEGER,
    image_h         INTEGER,
    file_paths      TEXT,
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    hash            TEXT    NOT NULL,
    app_name        TEXT,
    app_exe         TEXT,
    app_icon        TEXT,
    favorite        INTEGER NOT NULL DEFAULT 0,
    copy_count      INTEGER NOT NULL DEFAULT 1,
    first_copied_at INTEGER NOT NULL,
    last_copied_at  INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_hash ON items(hash);
CREATE INDEX IF NOT EXISTS idx_items_recent    ON items(last_copied_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_kind      ON items(kind, last_copied_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_favorite  ON items(favorite, last_copied_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
    preview,
    content,
    content='items',
    content_rowid='id',
    tokenize="unicode61 remove_diacritics 2"
);

CREATE TRIGGER IF NOT EXISTS items_fts_insert AFTER INSERT ON items BEGIN
    INSERT INTO items_fts(rowid, preview, content)
    VALUES (new.id, new.preview, new.content);
END;

CREATE TRIGGER IF NOT EXISTS items_fts_delete AFTER DELETE ON items BEGIN
    INSERT INTO items_fts(items_fts, rowid, preview, content)
    VALUES ('delete', old.id, old.preview, old.content);
END;

-- Scoped to the indexed columns so that bumping copy_count or toggling
-- `favorite` does not rewrite the full-text index.
CREATE TRIGGER IF NOT EXISTS items_fts_update
AFTER UPDATE OF preview, content ON items BEGIN
    INSERT INTO items_fts(items_fts, rowid, preview, content)
    VALUES ('delete', old.id, old.preview, old.content);
    INSERT INTO items_fts(rowid, preview, content)
    VALUES (new.id, new.preview, new.content);
END;

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#,
        )?;
        Ok(())
    }

    /// Inserts a new entry, or — when the same payload is already present —
    /// moves the existing row to the top and increments its copy counter.
    ///
    /// Dedup is keyed on the content hash, matching the behaviour users expect
    /// from clipboard managers: copying the same snippet twice yields one entry.
    pub fn upsert(&self, item: &NewItem) -> Result<Upsert> {
        let conn = self.conn.lock();
        let now = now_ms();

        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM items WHERE hash = ?1",
                params![item.content_hash],
                |r| r.get(0),
            )
            .optional()?;

        if let Some(id) = existing {
            conn.execute(
                "UPDATE items
                    SET copy_count = copy_count + 1,
                        last_copied_at = ?2,
                        app_name = COALESCE(?3, app_name),
                        app_exe  = COALESCE(?4, app_exe),
                        app_icon = COALESCE(?5, app_icon)
                  WHERE id = ?1",
                params![
                    id,
                    now,
                    item.source.as_ref().map(|s| &s.name),
                    item.source.as_ref().map(|s| &s.exe_path),
                    item.source.as_ref().and_then(|s| s.icon_path.as_ref()),
                ],
            )?;
            return Ok(Upsert::Bumped(id));
        }

        let preview = if item.preview.is_empty() {
            build_preview(item)
        } else {
            truncate_chars(&item.preview, PREVIEW_LIMIT)
        };
        let files_json = if item.files.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&item.files).unwrap_or_default())
        };

        conn.execute(
            "INSERT INTO items (
                kind, preview, content, html, rtf,
                image_path, thumb_path, image_w, image_h,
                file_paths, size_bytes, hash,
                app_name, app_exe, app_icon,
                favorite, copy_count, first_copied_at, last_copied_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5,
                ?6, ?7, ?8, ?9,
                ?10, ?11, ?12,
                ?13, ?14, ?15,
                0, 1, ?16, ?16
             )",
            params![
                item.kind.as_str(),
                preview,
                item.content,
                item.has_html,
                item.has_rtf,
                item.image.as_ref().map(|i| &i.path),
                item.image.as_ref().map(|i| &i.thumb_path),
                item.image.as_ref().map(|i| i.width),
                item.image.as_ref().map(|i| i.height),
                files_json,
                item.size_bytes,
                item.content_hash,
                item.source.as_ref().map(|s| &s.name),
                item.source.as_ref().map(|s| &s.exe_path),
                item.source.as_ref().and_then(|s| s.icon_path.as_ref()),
                now,
            ],
        )?;

        Ok(Upsert::Inserted(conn.last_insert_rowid()))
    }

    /// Returns history entries newest-first, honouring search and filters.
    pub fn list(&self, query: &ListQuery) -> Result<Vec<ClipItem>> {
        let conn = self.conn.lock();

        let limit = query.limit.unwrap_or(200).min(2_000) as i64;
        let offset = query.offset.unwrap_or(0) as i64;

        let mut sql = format!("SELECT {COLUMNS} FROM items WHERE 1 = 1");
        let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        // FTS5 prefix match. An unusable search string (e.g. only punctuation)
        // degrades to "no text filter" rather than returning zero rows.
        let match_expr = query.search.as_deref().and_then(fts_match_expression);
        if let Some(expr) = match_expr {
            sql.push_str(" AND id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)");
            binds.push(Box::new(expr));
        }

        if !query.kinds.is_empty() {
            let placeholders = std::iter::repeat_n("?", query.kinds.len())
                .collect::<Vec<_>>()
                .join(",");
            sql.push_str(&format!(" AND kind IN ({placeholders})"));
            for kind in &query.kinds {
                binds.push(Box::new(kind.as_str().to_string()));
            }
        }

        if query.favorites_only {
            sql.push_str(" AND favorite = 1");
        }

        sql.push_str(" ORDER BY last_copied_at DESC LIMIT ? OFFSET ?");
        binds.push(Box::new(limit));
        binds.push(Box::new(offset));

        let mut stmt = conn.prepare_cached(&sql)?;
        let refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
        let rows = stmt.query_map(refs.as_slice(), row_to_item)?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn get(&self, id: i64) -> Result<Option<ClipItem>> {
        let conn = self.conn.lock();
        let mut stmt =
            conn.prepare_cached(&format!("SELECT {COLUMNS} FROM items WHERE id = ?1"))?;
        Ok(stmt.query_row(params![id], row_to_item).optional()?)
    }

    /// Same as `get` but unwraps the `Option` into a `NotFound` error.
    /// Used by command handlers where the caller already has a valid id.
    pub fn get_required(&self, id: i64) -> Result<ClipItem> {
        self.get(id)?.ok_or(Error::NotFound("clipboard item"))
    }

    /// Returns the rich flavours for an entry: `(content, html, rtf)`.
    pub fn flavors(&self, id: i64) -> Result<Option<RichFlavors>> {
        let conn = self.conn.lock();
        Ok(conn
            .query_row(
                "SELECT content, html, rtf FROM items WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?)
    }

    pub fn set_favorite(&self, id: i64, favorite: bool) -> Result<()> {
        self.conn.lock().execute(
            "UPDATE items SET favorite = ?2 WHERE id = ?1",
            params![id, favorite as i32],
        )?;
        Ok(())
    }

    /// Marks an entry as just-used without incrementing the copy counter, so
    /// pasting from history floats the entry back to the top of the list.
    pub fn touch(&self, id: i64) -> Result<()> {
        self.conn.lock().execute(
            "UPDATE items SET last_copied_at = ?2 WHERE id = ?1",
            params![id, now_ms()],
        )?;
        Ok(())
    }

    /// Deletes one entry, returning any on-disk assets that are now orphaned.
    pub fn delete(&self, id: i64) -> Result<Vec<String>> {
        let conn = self.conn.lock();
        let assets = collect_assets(&conn, "WHERE id = ?1", params![id])?;
        conn.execute("DELETE FROM items WHERE id = ?1", params![id])?;
        Ok(assets)
    }

    /// Clears history. Starred entries survive unless `include_favorites`.
    pub fn clear(&self, include_favorites: bool) -> Result<Vec<String>> {
        let conn = self.conn.lock();
        let filter = if include_favorites {
            ""
        } else {
            "WHERE favorite = 0"
        };
        let assets = collect_assets(&conn, filter, params![])?;
        conn.execute(&format!("DELETE FROM items {filter}"), params![])?;
        Ok(assets)
    }

    /// Enforces the retention policy. Starred entries are never pruned.
    ///
    /// Returns the on-disk assets belonging to the removed rows.
    pub fn prune(&self, max_items: u32, retention_days: u32) -> Result<Vec<String>> {
        let conn = self.conn.lock();
        let mut assets = Vec::new();

        if retention_days > 0 {
            let cutoff = now_ms() - (retention_days as i64) * 86_400_000;
            let filter = "WHERE favorite = 0 AND last_copied_at < ?1";
            assets.extend(collect_assets(&conn, filter, params![cutoff])?);
            conn.execute(
                "DELETE FROM items WHERE favorite = 0 AND last_copied_at < ?1",
                params![cutoff],
            )?;
        }

        if max_items > 0 {
            // Keep the N most recent non-favorites; drop whatever falls past it.
            let filter = "WHERE favorite = 0 AND id NOT IN (
                              SELECT id FROM items WHERE favorite = 0
                              ORDER BY last_copied_at DESC LIMIT ?1
                          )";
            assets.extend(collect_assets(&conn, filter, params![max_items])?);
            conn.execute(&format!("DELETE FROM items {filter}"), params![max_items])?;
        }

        Ok(assets)
    }

    /// Aggregate counts surfaced to the UI for the status line.
    pub fn counts(&self) -> Result<Counts> {
        let conn = self.conn.lock();

        let total: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))?;
        let favorites: i64 =
            conn.query_row("SELECT COUNT(*) FROM items WHERE favorite = 1", [], |r| {
                r.get(0)
            })?;

        Ok(Counts {
            total,
            favorites,
            pinned: favorites,
        })
    }

    /// The hash of the most recently captured entry. Used to short-circuit
    /// duplicate `WM_CLIPBOARDUPDATE` notifications, which Windows delivers more
    /// than once for a single copy in some applications.
    pub fn newest_hash(&self) -> Result<Option<String>> {
        let conn = self.conn.lock();
        Ok(conn
            .query_row(
                "SELECT hash FROM items ORDER BY last_copied_at DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()?)
    }

    pub fn load_settings(&self) -> Result<Settings> {
        let conn = self.conn.lock();
        let raw: Option<String> = conn
            .query_row("SELECT value FROM settings WHERE key = 'app'", [], |r| {
                r.get(0)
            })
            .optional()?;

        // Deserialise leniently: a settings blob written by an older build that
        // lacks newly added fields must not wipe the user's configuration.
        Ok(raw
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default())
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<()> {
        let json = serde_json::to_string(settings)
            .map_err(|e| crate::error::Error::Other(e.to_string()))?;
        self.conn.lock().execute(
            "INSERT INTO settings (key, value) VALUES ('app', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![json],
        )?;
        Ok(())
    }
}

/// Gathers the image/thumbnail paths for rows matching `filter` so the caller can
/// unlink them after the rows are deleted.
fn collect_assets(
    conn: &Connection,
    filter: &str,
    binds: impl rusqlite::Params,
) -> Result<Vec<String>> {
    let sql = format!("SELECT image_path, thumb_path FROM items {filter}");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(binds, |r| {
        Ok((
            r.get::<_, Option<String>>(0)?,
            r.get::<_, Option<String>>(1)?,
        ))
    })?;

    let mut assets = Vec::new();
    for row in rows {
        let (image, thumb) = row?;
        assets.extend(image);
        assets.extend(thumb);
    }
    Ok(assets)
}

fn row_to_item(row: &Row<'_>) -> rusqlite::Result<ClipItem> {
    let image_path: Option<String> = row.get(6)?;
    let thumb_path: Option<String> = row.get(7)?;
    let image = match (image_path, thumb_path) {
        (Some(path), Some(thumb_path)) => Some(ImageMeta {
            path,
            thumb_path,
            width: row.get::<_, Option<u32>>(8)?.unwrap_or_default(),
            height: row.get::<_, Option<u32>>(9)?.unwrap_or_default(),
        }),
        _ => None,
    };

    let files = row
        .get::<_, Option<String>>(10)?
        .and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok())
        .unwrap_or_default();

    let app_name: Option<String> = row.get(12)?;
    let app_exe: Option<String> = row.get(13)?;
    let source = match (app_name, app_exe) {
        (Some(name), Some(exe_path)) => Some(SourceApp {
            name,
            exe_path,
            icon_path: row.get(14)?,
        }),
        _ => None,
    };

    Ok(ClipItem {
        id: row.get(0)?,
        kind: ItemKind::from_db_value(&row.get::<_, String>(1)?),
        preview: row.get(2)?,
        content: row.get(3)?,
        has_html: row.get::<_, Option<String>>(4)?.is_some(),
        has_rtf: row.get::<_, Option<String>>(5)?.is_some(),
        image,
        files,
        size_bytes: row.get(11)?,
        source,
        favorite: row.get::<_, i32>(15)? != 0,
        copy_count: row.get(16)?,
        first_copied_at: row.get(17)?,
        last_copied_at: row.get(18)?,
    })
}

/// Builds the single-line label shown in the list.
fn build_preview(item: &NewItem) -> String {
    if let Some(image) = &item.image {
        return format!("Image ({}×{})", image.width, image.height);
    }

    if !item.files.is_empty() {
        let first = item
            .files
            .first()
            .map(|p| file_name_of(p))
            .unwrap_or_default();
        return if item.files.len() == 1 {
            first
        } else {
            format!("{first} + {} more", item.files.len() - 1)
        };
    }

    let collapsed = item
        .content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("")
        .to_string();

    let label = if collapsed.is_empty() {
        item.content.trim().to_string()
    } else {
        collapsed
    };

    truncate_chars(&label, PREVIEW_LIMIT)
}

fn file_name_of(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

/// Truncates on a character boundary — byte slicing would panic on multi-byte
/// UTF-8, which clipboard content is full of.
fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    let mut out: String = value.chars().take(limit).collect();
    out.push('…');
    out
}

/// Turns a user search string into a safe FTS5 prefix-match expression.
///
/// Every token is quoted (so FTS5 operators inside user input are treated as
/// literals) and suffixed with `*` for as-you-type matching. Returns `None` when
/// nothing searchable remains.
fn fts_match_expression(search: &str) -> Option<String> {
    let tokens: Vec<String> = search
        .split_whitespace()
        .map(|token| {
            token
                .chars()
                .filter(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | '@' | '/' | '#'))
                .collect::<String>()
        })
        .filter(|token| !token.is_empty())
        .map(|token| format!("\"{token}\"*"))
        .collect();

    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_item(content: &str, hash: &str) -> NewItem {
        NewItem {
            kind: ItemKind::Text,
            content: content.to_string(),
            size_bytes: content.len() as i64,
            content_hash: hash.to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn insert_then_repeat_collapses_into_one_row() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.upsert(&text_item("hello world", "h1")).unwrap().is_new());
        let second = db.upsert(&text_item("hello world", "h1")).unwrap();
        assert!(!second.is_new());

        let items = db.list(&ListQuery::default()).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].copy_count, 2);
    }

    #[test]
    fn full_text_search_matches_prefixes() {
        let db = Db::open_in_memory().unwrap();
        db.upsert(&text_item("the quick brown fox", "h1")).unwrap();
        db.upsert(&text_item("lazy dog sleeping", "h2")).unwrap();

        let hits = db
            .list(&ListQuery {
                search: Some("quic".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].content, "the quick brown fox");
    }

    #[test]
    fn punctuation_only_search_does_not_hide_everything() {
        let db = Db::open_in_memory().unwrap();
        db.upsert(&text_item("anything", "h1")).unwrap();

        let hits = db
            .list(&ListQuery {
                search: Some("***".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(
            hits.len(),
            1,
            "unusable search must not filter everything out"
        );
    }

    #[test]
    fn toggling_favorite_keeps_the_row_searchable() {
        let db = Db::open_in_memory().unwrap();
        let id = db.upsert(&text_item("findable text", "h1")).unwrap().id();
        db.set_favorite(id, true).unwrap();

        let hits = db
            .list(&ListQuery {
                search: Some("findable".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].favorite);
    }

    #[test]
    fn prune_respects_favorites_and_max_items() {
        let db = Db::open_in_memory().unwrap();
        let keep = db.upsert(&text_item("starred", "fav")).unwrap().id();
        db.set_favorite(keep, true).unwrap();
        for i in 0..5 {
            db.upsert(&text_item(&format!("item {i}"), &format!("h{i}")))
                .unwrap();
        }

        db.prune(2, 0).unwrap();
        let items = db.list(&ListQuery::default()).unwrap();
        // 2 most recent non-favorites + the starred entry.
        assert_eq!(items.len(), 3);
        assert!(items.iter().any(|i| i.id == keep));
    }

    #[test]
    fn delete_reports_orphaned_assets() {
        let db = Db::open_in_memory().unwrap();
        let item = NewItem {
            kind: ItemKind::Image,
            image: Some(ImageMeta {
                path: "C:/tmp/a.png".into(),
                thumb_path: "C:/tmp/a.thumb.png".into(),
                width: 10,
                height: 10,
            }),
            content_hash: "img".into(),
            ..Default::default()
        };
        let id = db.upsert(&item).unwrap().id();

        let assets = db.delete(id).unwrap();
        assert_eq!(assets.len(), 2);
        assert!(db.get(id).unwrap().is_none());
    }

    #[test]
    fn multibyte_preview_is_truncated_safely() {
        let db = Db::open_in_memory().unwrap();
        let content = "🎉".repeat(PREVIEW_LIMIT + 50);
        db.upsert(&text_item(&content, "emoji")).unwrap();
        let items = db.list(&ListQuery::default()).unwrap();
        assert!(items[0].preview.ends_with('…'));
    }

    #[test]
    fn settings_round_trip() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.load_settings().unwrap().hotkey, "Ctrl+Shift+V");

        let settings = Settings {
            hotkey: "Ctrl+Alt+C".into(),
            max_items: 42,
            ..Default::default()
        };
        db.save_settings(&settings).unwrap();

        let loaded = db.load_settings().unwrap();
        assert_eq!(loaded.hotkey, "Ctrl+Alt+C");
        assert_eq!(loaded.max_items, 42);
    }
}

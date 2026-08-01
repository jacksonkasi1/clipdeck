# Clipdeck — v0.2.0 TODO

Snapshot of the work that needs to land between the current `v0.1.1` release
and the next cross-device release. This file is design-only: nothing has been
implemented yet. Each section ends with concrete deliverable(s) so the next
coder can pick it up without re-deriving the intent.

---

## 1. Quick-win bug fixes

Two small, well-scoped fixes that are not part of the LAN sync work but
should ride along with v0.2.0.

### 1a. "Open in browser" button does nothing on link previews

- **Repro:** Select a link item → click the "Open in browser" button in
  `PreviewPane.tsx:243`. Nothing happens.
- **Where:** `src/components/PreviewPane.tsx:243` calls
  `api.openUrl(url)` which is `opener.openUrl` from
  `@tauri-apps/plugin-opener` (`src/lib/tauri.ts:60`).
- **Likely cause:** the URL captured from the clipboard is missing the
  scheme (e.g. `example.com` instead of `https://example.com`) and the
  opener plugin returns an error silently. The clipboard classifier
  treats `text` URLs as text-only entries, and `is_link()` only succeeds
  when the scheme parses.
- **Fix:** before calling `api.openUrl`, normalise the URL:
  - `tryParseScheme(url)` first
  - if it has no scheme and looks like a domain (`looksLikeDomain(url)`),
    prepend `https://`
  - wrap the call in a try/catch and surface a toast on failure so the
    user gets feedback instead of silence.
- **Files to touch:** `src/components/PreviewPane.tsx`,
  `src/lib/url.ts` (new tiny helper), `src/lib/tauri.ts` if the error
  contract needs to be propagated.
- **Acceptance:** clicking the button opens the default browser within
  1 s for `https://example.com`, `example.com`, and rejects
  `not a url` with a friendly toast.

### 1b. `Ctrl+S` does not save while editing a clipboard item

- **Repro:** Select a text item → press `Enter` or click Pencil → edit
  content → press `Ctrl+S`. The form is not submitted.
- **Where:** `src/components/PreviewPane.tsx:318` — the `<textarea>`
  `onKeyDown` only handles `Escape` and `Ctrl+Enter`. There is no
  `Ctrl+S` handler anywhere in the renderer.
- **Important:** the global shortcut plugin (`Ctrl+S`) is **not**
  registered — `install_hotkey` only registers the open-shortcut
  (`src-tauri/src/commands.rs:422`). Browser default `Ctrl+S` triggers
  "save page as…" on the webview, which is also wrong.
- **Fix:** add `event.key === 's' && (event.ctrlKey || event.metaKey)`
  to the existing `onKeyDown`, prevent default, and call
  `event.currentTarget.form?.requestSubmit()`.
- **Files to touch:** `src/components/PreviewPane.tsx` only.
- **Acceptance:** `Ctrl+S` saves the edit and exits edit mode; `Enter`
  inserts a newline; `Ctrl+Enter` still saves.

---

## 2. Settings UI restructure — tabs

The single-page Settings scroll is going to grow further when file sync
controls land. The shape is:

```
Settings
├── Appearance            (theme, backdrop, preview)
├── Capture               (what to capture, history limits)
├── History & storage     (location, counts, clear actions)
├── Cross-device sync     ← biggest growth area
│   ├── General           (toggle, device name, color, pairing code)
│   ├── Content           (text/links/colors, images, files toggles)
│   ├── File filters      (extension mode + list, size cap)
│   └── Paired devices    (peers list, forget, regenerate PIN)
├── Keyboard shortcuts
└── Advanced              (debug log, mTLS pin, snapshot policy)
```

### Layout

- **Outer nav:** left rail with category icons + labels, fixed width
  (~200 px desktop, collapsing to a dropdown on the settings window).
  Matches the Windows 11 Fluent 2 secondary-nav idiom.
- **Content:** right pane scrolls independently. Each category is a
  `<section>` with the existing section header.
- **Sub-tabs:** inside the Cross-device category, use a horizontal
  `Segmented` control (the component already exists) so the four
  sub-sections stay one click deep.

### Implementation order

1. Extract the existing `Section` and `Row` components from
   `src/Settings.tsx` into `src/settings/Section.tsx` so they can be
   reused from inside the sub-tabs.
2. Build `src/settings/SettingsNav.tsx` (vertical nav) and the
   `<Tabs>` wrapper for sub-tabs.
3. Split `Settings.tsx` into five files:
   `src/settings/{Appearance,Capture,History,CrossDevice,Shortcuts,Advanced}.tsx`,
   re-exported from `Settings.tsx`.
4. The Cross-device tab owns the current Cross-device sync section
   plus the new content/filter/peer sub-sections (see §3 and §4).

### Acceptance

- Each category is reachable in one click from the left nav.
- Cross-device category has four sub-tabs that all render without
  re-fetching data.
- Keyboard navigation: <kbd>Tab</kbd> walks through controls in
  reading order; <kbd>Ctrl+1..6</kbd> jumps to a category.
- No layout shift when sub-tabs are switched.

---

## 3. Cross-device sync — file sync design

The current `feat/clipdeck-lan-sync` WIP only ships text-like payloads
(text/links/email/colors). v0.2.0 must add a **controllable** file sync
mode. The user's exact requirements:

> normal files copy by default it will be disabled ok if needed i can
> able and what kind of extension files i can copy or by default all
> ok if in case no need to copy .exe file .mp4 i can filter out or i
> can include some specific things and also when file copy we need
> to give control max this much size files only copy or all.

### 3a. Add to `Settings` (Rust + TS)

New fields on `models::Settings`:

```rust
pub sync_text: bool,          // default true,  covers text/link/email/color
pub sync_images: bool,        // default true,  covers ItemKind::Image
pub sync_files: bool,         // default false (opt-in)
pub sync_file_mode: FileMode, // Allowlist | Blocklist | All
pub sync_file_extensions: Vec<String>, // normalised ".ext" tokens
pub sync_max_file_size_mb: u32,        // default 25
pub sync_max_total_size_mb: u32,       // default 100, cumulative queue cap
```

`FileMode` is a new enum. The default list for the blocklist mode is:

```
.exe, .bat, .cmd, .msi, .scr, .com, .cpl, .dll, .sys, .inf,
.vbs, .js, .jse, .wsf, .ps1, .reg,
.mp4, .mov, .avi, .mkv, .webm, .flv, .wmv,
.iso, .vhd, .vhdx, .img, .dmg,
.zip, .rar, .7z, .tar, .gz
```

All of these are intentionally **defaults**, not hard-banned — the user
can flip to `Allowlist` and pick a small set, or clear the blocklist.

### 3b. Sizing policy

- **Per-file cap** (`sync_max_file_size_mb`): silently skip and log
  on the sender if a single file exceeds the cap. Never block the
  clipboard capture.
- **Per-batch cap** (`sync_max_total_size_mb`): when the cumulative
  queue size of the *current* sync envelope exceeds the cap, drop the
  oldest envelope items first (newest wins).
- **Cap on the receiver:** apply the same per-file cap again so a
  malicious peer can't ship a 4 GB blob regardless of what the sender
  claims.

### 3c. Wire shape

Files piggy-back on the existing TCP envelope. New variant:

```rust
struct SyncEnvelope {
  protocol: String,
  pairing_code: String,
  device: DeviceIdentity,
  body: SyncBody,
}

enum SyncBody {
  ClipUpsert(ClipSnapshot),
  ClipEdit { id_hash: String, content: String },
  FavoriteToggle { id_hash: String, favorite: bool },
  Tombstone { id_hash: String },
  FileUpsert { id_hash: String, file: FileSnapshot },
}

struct FileSnapshot {
  /// Original basename (display only — never used as a path).
  name: String,
  /// Absolute size, must match the streamed bytes.
  size: u64,
  /// MIME if known, otherwise "".
  mime: String,
  /// Streaming chunked bytes after the JSON envelope.
  chunk_count: u32,
}
```

Files stream in 64 KiB chunks after the JSON envelope, one chunk per
direction on a dedicated QUIC/TCP bidirectional stream per snapshot.
The receiver writes to `storage::file_root` / `image_root` (re-use
the existing asset roots), then calls `db::upsert(FileItem)`.

### 3d. Classification on the listener

`commands::CaptureSink::handle()` currently routes by `ItemKind`
(`text/link/email/color/image/files`). Add:

- If `kind == Files` and `settings.sync_files == false` → local-only,
  do not enqueue.
- If `kind == Files` and `settings.sync_file_mode != All` → filter
  each `StoredFile` by extension + size; drop files that fail either
  check, log them, and only enqueue the survivors.
- If `kind == Image` and `settings.sync_images == false` → local-only.

The receiver must apply the same filters as a defence-in-depth measure.

### 3e. Receiver-side persistence

- New `db::Db::import_synced_file_item(device, FileSnapshot, bytes)`
  writes the bytes to `storage::file_root/<device_id>/<hash>.bin` and
  inserts an `ItemKind::Files` row with `StoredFile { original_path,
  stored_path, size_bytes, is_directory: false, status: Ready }`.
- The receiver never trusts the sender's `original_path`. It only uses
  the basename for display and stores under a sanitized hash.

### 3f. Acceptance

- Two paired devices, files disabled by default: a copied file appears
  on the receiver **only** as a metadata stub (no bytes).
- Files enabled, `.exe` blocklisted: copying a `.exe` does not sync
  the file. The receiver does not see the entry.
- Files enabled, allowlist `[".txt", ".md"]`: copying a `.pdf` does
  not sync. A `.txt` 1 MB file syncs. A `.txt` 30 MB file is skipped
  with a log line.
- Files enabled, 5 MB cap: copying a 4 MB file syncs; a 6 MB file is
  skipped.

---

## 4. Cross-device sync — image bytes

Already partially scoped in `drifting-cooking-puzzle.md` PR 5. Pull
the relevant subset into a working list.

### 4a. Sender

- On `NewItem{ kind: Image }`, the sender reads the PNG bytes from
  `storage::image_root` and the thumbnail from `thumb_root`, base64
  (or `postcard`) encodes them into the `SyncEnvelope` body.
- Cap at 512 KiB total payload (PNG + thumbnail). Above the cap, skip
  silently with a log line. Never break the local capture.

### 4b. Receiver

- `db::Db::import_synced_image_item(device, ImageWire)` writes the PNG
  to `storage::image_root/<device_id>/<hash>.png` and the thumbnail
  to `thumb_root/<device_id>/<hash>.png`, then calls `db.upsert()`.

### 4c. Acceptance

- Two paired devices, copy a 200 kB PNG on A → appears on B within 2 s
  with thumbnail rendered.
- Copy a 5 MB PNG on A → silently skipped; no row on B.
- The local item on A is unchanged (capture path is not delayed).

---

## 5. Cross-device sync — edit / pin / delete propagation

The WIP only propagates new clip captures. v0.2.0 must also propagate:

- **Edit** — when the user edits an item's content locally, the change
  is sent to peers; peers apply the same edit to their row.
- **Pin** — when the user toggles favourite, the change is sent to
  peers.
- **Delete** — when the user deletes an item, peers also delete the
  matching row.

### 5a. Wire

- Add `ClipEdit { id_hash, content }`, `FavoriteToggle { id_hash,
  favorite }`, `Tombstone { id_hash }` to `SyncBody` (see §3c).
- `id_hash` is the existing `content_hash` for text-like items, plus
  a new `id_hash` column on `items` (idempotent migration) so a peer
  can address an item by its global ID regardless of local row id.

### 5b. LWW conflict resolution

- Each `NewItem` and each edit carries `origin_device_id`,
  `origin_lamport`, `origin_wall_ms` (three new columns, idempotent
  migration).
- `origin_lamport` is a per-device monotonic counter incremented on
  every emission.
- `merge.rs::lww_resolve` compares `(lamport, wall_ms)` tuples;
  tiebreaks by `origin_device_id` byte order (deterministic).

### 5c. Self-origin drop

- A peer must drop packets whose `origin_device_id == self.device_id`.
  Prevents loops when the same device is reachable via multiple paths.

### 5d. Acceptance

- Edit on A → B reflects the new content within 1 s.
- Pin on A → B's star mirror within 1 s.
- Delete on A → B's row removed within 1 s.
- A simulated simultaneous edit on both devices resolves to the same
  outcome on both (deterministic LWW).

---

## 6. Cross-device sync — mobile + release

Out of scope for the immediate TODO but flagged so the file/setting
design does not paint us into a corner:

- **Mobile halves** (iOS Swift, Android Kotlin) — the
  `drifting-cooking-puzzle.md` plan covers this in PR 7. Reuse the
  extension filter/size cap settings so mobile users get the same
  controls.
- **mTLS pairing** — today's PIN is cleartext on the LAN. The plan
  graduates to `rustls` mTLS + cert fingerprint pinning when the
  plugin crate is added (`plugins/tauri-plugin-clipdeck-sync/`).
- **Smoke test packaging** — the existing
  `scripts/smoke-test-windows.ps1` covers the local binary once the
  WIP is enabled. Add a second test that starts two Clipdeck
  instances on `127.0.0.1` and asserts a peer exchange.

---

## 7. Order of operations

Recommended PR order so each lands green and reviewable:

1. **PR A — bug fixes (1a, 1b).** Tiny, isolated, low-risk.
2. **PR B — Settings UI tabs.** Pure frontend restructure, no logic
   changes. The current Settings.tsx is split into the new layout.
3. **PR C — Cross-device tab content (text/links/colors already work,
   expose image toggle).** Adds the `sync_text` / `sync_images` /
   `sync_files` booleans to `Settings` and the new settings UI
   sections; the WIP `sync.rs` already handles the text path.
4. **PR D — File sync** (§3). The biggest PR; depends on the
   storage and DB helpers being able to write bytes from a foreign
   device.
5. **PR E — Image bytes** (§4). Quick follow-on once file sync's
   bytes-on-the-wire infra exists.
6. **PR F — Edit/pin/delete propagation** (§5). Requires the
   `id_hash` + LWW columns from §5a.
7. **PR G — Settings tabs polish + manual two-device smoke test** +
   v0.2.0 release.

Each PR must keep `cargo check`, `cargo tauri build`,
`npm run typecheck`, `npm test`, and `cargo test` (where runnable)
green.

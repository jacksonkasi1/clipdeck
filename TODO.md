# Clipdeck — v0.2.0 TODO

Snapshot of the work between the current `v0.1.1` release and the next
cross-device release. PR A and the non-sync portion of PR B are **done**. Cross-device work in
PRs C–F remains deferred; PR G is release follow-up.

> **Status legend**
> - ✅ done — code shipped, tests green, build verified locally.
> - 🟡 in progress / partial.
> - ⬜ pending — design is final, implementation not started.

---

## PR A — Quick-win bug fixes + multi-select ✅ DONE

Shipped in commits `e773bfc`, `8ad1639`, `5b5e6fe` on
`feat/clipdeck-lan-sync`.

### 1a. "Open in browser" button ✅

- New `src/lib/url.ts` with `hasScheme`, `looksLikeDomain`,
  `tryParseScheme`, `normaliseUrl`.
- Whitelist-only scheme regex (`https?` / `mailto`); `javascript:`,
  `file:`, `data:`, `ftp://` are rejected before `tryParseScheme`
  returns success.
- Localhost is accepted without a scheme (`localhost:3000` →
  `http://localhost:3000`).
- `PreviewPane.tsx` calls `normaliseUrl` then `api.openUrl`; failures
  surface through the new `toast()` surface instead of failing silently.
- Unit tests: `src/lib/url.test.ts` — 13 cases covering the rejection
  cases, IPv4, scheme-already-present, mailto + `@`.

### 1b. `Ctrl+S` saves an in-progress edit ✅

- `PreviewPane.tsx` `onKeyDown` now handles `Ctrl+S` / `Cmd+S` (calls
  `event.currentTarget.form?.requestSubmit()` and `preventDefault()`).
- `Enter` still inserts a newline; `Ctrl+Enter` still saves.
- The browser default (`save page as…`) is suppressed.

### 1c. Multi-select ✅

- zustand store gains `selectedIds: Set<number>`,
  `selectionAnchor: number | null`, `pendingSelection: number | null`.
- `ItemList` / `ItemRow` route clicks by modifier:
  - **plain** — single select, anchor moves.
  - **Ctrl/Cmd+click** — toggle membership, anchor preserved.
  - **Shift+click** — range from anchor to clicked row (clamped to
    filtered index).
- Keyboard: `Shift+↑/↓` extends range, `Ctrl+↑/↓` moves focus,
  `Ctrl+A` selects all in the filtered list, `Escape` clears.
- Toolbar **Delete** button routes to `deleteSelected()` when more
  than one row is highlighted.
- `deleteSelected` collects failed ids and toasts
  `<n> deleted, <m> failed`.

### 1d. Post-delete selection cursor ✅

- `deleteItem` captures the *successor* row before the async refresh
  and re-asserts `pendingSelection` both before and after the await.
  This survives a concurrent `refresh()` from another tab.
- The cursor lands on the next item if any; otherwise on the previous;
  otherwise cleared.

### 1e. Code review cleanups ✅

Sub-agent review of the PR A diff landed ten minor fixes:

- `toast.ts` rewritten with `createElement` (was JSX in a `.ts` file).
- `ItemRow` className uses `.filter(Boolean).join(' ')` so empty
  `kind-…` slots don't leave double spaces.
- `selectRange` defends against a stale anchor pointing past the
  filtered list.
- `refresh()` re-anchors when the filter changes so multi-select
  survives a search edit.
- `deleteSelected` uses the same `preserveSuccessor()` closure
  pattern as `deleteItem`.
- Removed dead `clearSelection` action.
- `deleteSelected` failures show a count toast instead of swallowing.
- `PreviewPane` toolbar adds `selectedIds` + `deleteSelected` to its
  store hook list.
- `EditItem` save error path also toasts.
- `normaliseUrl` no longer double-prefixes `https://` when the input
  already has a scheme.

### 1f. Filter-change selection persistence ✅

- `refresh()` records the new filtered index for the current anchor
  so the row stays selected when the user narrows the search.

### 1g. WebView2Loader.dll bundling ✅

Two bugs fixed before the local installer would actually launch:

1. `webview2-com-sys` drops `WebView2Loader.dll` under
   `target/<profile>/build/webview2-com-sys-*/out/x64/`, but the
   Tauri 2 `-windows-gnu` bundler looks at
   `target/<profile>/WebView2Loader.dll`. `src-tauri/build.rs` now
   copies the file into the expected location during the build.
2. `tauri.conf.json` `bundle.resources` previously declared
   `"target/release/WebView2Loader.dll": …` which preserved the
   long source path inside the installer. Switched to
   `{"target/release/WebView2Loader.dll": "WebView2Loader.dll"}` so
   the DLL is placed at the package root.

### 1h. Local Windows installer build ✅

- MinGW GNU toolchain (`x86_64-pc-windows-gnu`) with
  `RUSTUP_TOOLCHAIN` and `windres` on PATH.
- `cargo tauri build` produces
  `target/release/bundle/nsis/Clipdeck_0.1.1_x64-setup.exe` and the
  bundle now ships a working `WebView2Loader.dll`.

---

## PR B — Settings UI tabs ✅ DONE (sync sub-tabs deferred)

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
   plus the new content/filter/peer sub-sections (see PR C and PR D).

### Acceptance

- Each category is reachable in one click from the left nav.
- Cross-device category has four sub-tabs that all render without
  re-fetching data.
- Keyboard navigation: <kbd>Tab</kbd> walks through controls in
  reading order; <kbd>Ctrl+1..6</kbd> jumps to a category.
- No layout shift when sub-tabs are switched.

---

## PR C — Cross-device sync scope toggles ⬜ PENDING

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

### 3b. Sizing policy (PR C, repeated as PR D bytes)

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

### 3d. Classification on the listener (PR C; PR D for file bytes)

`commands::CaptureSink::handle()` currently routes by `ItemKind`
(`text/link/email/color/image/files`). Add:

- If `kind == Files` and `settings.sync_files == false` → local-only,
  do not enqueue.
- If `kind == Files` and `settings.sync_file_mode != All` → filter
  each `StoredFile` by extension + size; drop files that fail either
  check, log them, and only enqueue the survivors.
- If `kind == Image` and `settings.sync_images == false` → local-only.

The receiver must apply the same filters as a defence-in-depth measure.

### 3e. Receiver-side persistence (PR D bytes)

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

## PR D — Cross-device sync file bytes ⬜ PENDING

Once PR C lands the scope toggles, this PR adds the on-the-wire bytes
path for `ItemKind::Files`.

### 4a. Sender

- On `NewItem{ kind: Files }`, the sender reads the file bytes from
  `storage::file_root` and streams them after the JSON envelope in
  64 KiB chunks.
- Sender-side cap: `sync_max_file_size_mb`. Over the cap → skip
  silently with a log line. Never break the local capture.
- Per-batch cap: `sync_max_total_size_mb` cumulative queue size;
  drop oldest envelopes first (newest wins).

### 4b. Receiver

- `db::Db::import_synced_file_item(device, FileSnapshot, bytes)`
  writes the bytes to `storage::file_root/<device_id>/<hash>.bin`
  then inserts the row via `db.upsert(&NewItem)`.
- Receiver re-applies the same size cap as a defence-in-depth measure.

### 4c. Acceptance

- Two paired devices, copy a 1 MB `.txt` on A → appears on B within
  2 s with the file content available via the existing asset
  protocol scope.
- Copy a 30 MB `.txt` on A → silently skipped on A; no row on B.
- The local item on A is unchanged (capture path is not delayed).

---

## PR E — Cross-device sync image bytes ⬜ PENDING

Already partially scoped in `drifting-cooking-puzzle.md` PR 5. Pull
the relevant subset into a working list.

### 5a. Sender

- On `NewItem{ kind: Image }`, the sender reads the PNG bytes from
  `storage::image_root` and the thumbnail from `thumb_root`, base64
  (or `postcard`) encodes them into the `SyncEnvelope` body.
- Cap at 512 KiB total payload (PNG + thumbnail). Above the cap, skip
  silently with a log line. Never break the local capture.

### 5b. Receiver

- `db::Db::import_synced_image_item(device, ImageWire)` writes the PNG
  to `storage::image_root/<device_id>/<hash>.png` and the thumbnail
  to `thumb_root/<device_id>/<hash>.png`, then calls `db.upsert()`.

### 5c. Acceptance

- Two paired devices, copy a 200 kB PNG on A → appears on B within 2 s
  with thumbnail rendered.
- Copy a 5 MB PNG on A → silently skipped; no row on B.
- The local item on A is unchanged (capture path is not delayed).

---

## PR F — Edit / pin / delete propagation ⬜ PENDING

The WIP only propagates new clip captures. v0.2.0 must also propagate:

- **Edit** — when the user edits an item's content locally, the change
  is sent to peers; peers apply the same edit to their row.
- **Pin** — when the user toggles favourite, the change is sent to
  peers.
- **Delete** — when the user deletes an item, peers also delete the
  matching row.

### 6a. Wire

- Add `ClipEdit { id_hash, content }`, `FavoriteToggle { id_hash,
  favorite }`, `Tombstone { id_hash }` to `SyncBody` (see PR C §3c).
- `id_hash` is the existing `content_hash` for text-like items, plus
  a new `id_hash` column on `items` (idempotent migration) so a peer
  can address an item by its global ID regardless of local row id.

### 6b. LWW conflict resolution

- Each `NewItem` and each edit carries `origin_device_id`,
  `origin_lamport`, `origin_wall_ms` (three new columns, idempotent
  migration).
- `origin_lamport` is a per-device monotonic counter incremented on
  every emission.
- `merge.rs::lww_resolve` compares `(lamport, wall_ms)` tuples;
  tiebreaks by `origin_device_id` byte order (deterministic).

### 6c. Self-origin drop

- A peer must drop packets whose `origin_device_id == self.device_id`.
  Prevents loops when the same device is reachable via multiple paths.

### 6d. Acceptance

- Edit on A → B reflects the new content within 1 s.
- Pin on A → B's star mirror within 1 s.
- Delete on A → B's row removed within 1 s.
- A simulated simultaneous edit on both devices resolves to the same
  outcome on both (deterministic LWW).

---

## PR G — Mobile + release polish ⬜ PENDING

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

1. **PR A — bug fixes + multi-select + bundling** ✅ DONE
   (commits `e773bfc`, `8ad1639`, `5b5e6fe`).
2. **PR B — Settings UI tabs.** Pure frontend restructure, no logic
   changes. The current Settings.tsx is split into the new layout.
3. **PR C — Cross-device tab content (text/links/colors already work,
   expose image toggle).** Adds the `sync_text` / `sync_images` /
   `sync_files` booleans to `Settings` and the new settings UI
   sections; the WIP `sync.rs` already handles the text path.
4. **PR D — File sync bytes on the wire.** The biggest PR; depends
   on the storage and DB helpers being able to write bytes from a
   foreign device.
5. **PR E — Image bytes.** Quick follow-on once file sync's
   bytes-on-the-wire infra exists.
6. **PR F — Edit/pin/delete propagation.** Requires the `id_hash` +
   LWW columns from PR F §6a.
7. **PR G — Mobile halves + manual two-device smoke test** +
   v0.2.0 release.

Each PR must keep `cargo check`, `cargo tauri build`,
`npm run typecheck`, `npm test`, and `cargo test` (where runnable)
green.

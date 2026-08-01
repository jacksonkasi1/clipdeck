# Clipdeck

**Blazing-fast clipboard history for Windows.** Modeled on the Win+V flyout
with a Fluent 2 surface that reads as a native part of Windows 11.

> Press **Ctrl + Shift + V** anywhere to summon the popup, type to filter,
> arrow-keys to navigate, **Enter** to paste back to the app you were just
> using.

## Features

- **Compact by default** — a focused history window opens first; the optional
  preview pane expands alongside it for editing, rich previews, and metadata.
- **Captures everything** — text, links, emails, hex colors, images, file
  drops. Sensitive entries flagged by password managers are skipped
  automatically (`ExcludeClipboardContentFromMonitorProcessing`).
- **Hash-based dedup** — copying the same thing twice just bumps the
  counter; the list never fills with duplicates.
- **Full-text search** — SQLite FTS5 prefix search across the visible text,
  ranked as-you-type and loaded incrementally for large histories.
- **Tags and source search** — label entries locally and search by clipboard content,
  tag, application name, or executable path from the same search box.
- **Complete history controls** — edit supported values, pin favorites, delete
  individual entries, clear a type, or clear every non-favorite entry.
- **Managed local storage** — durable image and file snapshots with configurable
  location, retention, size limits, and safe verified migration.
- **Capture controls** — choose ignored applications, keep separate include and
  exclude extension lists, cap snapshot size, and store images as copied, PNG,
  JPEG, or WebP with normal, best, or manual compression.
- **Fluent 2 / Windows 11 visuals** — Segoe UI Variable with the `opsz`
  optical-size axis, 8 px overlay / 4 px control radii, Mica or Acrylic
  backdrop from `window-vibrancy`, OS accent color injected from the
  registry at startup, Mica-style dark mode toggled by `AppsUseLightTheme`.
- **Blazing fast** — pre-created hidden window reused for every
  invocation, dedicated Win32 clipboard-listener thread, format reads
  done in C with a single `OpenClipboard` call, virtualised 10 000-row
  list, images stored as files with separate thumbnails so list rendering
  never touches bitmap bytes.
- **No telemetry.** Everything lives in `%APPDATA%\Clipdeck`. Nothing
  leaves the machine.

## Requirements

| Tool                  | Version                                            |
| --------------------- | -------------------------------------------------- |
| OS                    | Windows 11 (build 22000+). Mica needs build 22000, Acrylic any Win10 build. |
| Rust                  | 1.85 or newer                                      |
| Node.js               | 22.12 or newer                                      |
| Visual Studio         | "Desktop development with C++" workload + Windows 11 SDK |
| WebView2               | pre-installed on Windows 11; otherwise the bootstrapper installs it |

## Development

```bash
npm install
npm run tauri dev
```

The first run compiles ~300 crates; subsequent runs are incremental.

## Production build

```bash
npm run tauri build
```

Produces `src-tauri/target/release/bundle/nsis/Clipdeck_*.exe` — a single-
file NSIS installer that installs per-user (no admin needed) and starts
with Windows when the user opts in.

For a reproducible x64 GNU build that keeps the large Rust build cache off
the C: drive, use PowerShell:

```powershell
.\scripts\build-win64.ps1
```

This writes the application executable and self-contained NSIS installer beneath
`D:\Program\rust-target\clipdeck\x86_64-pc-windows-gnu\release`. Developers
with Visual Studio Build Tools can instead run
`.\scripts\build-win64.ps1 -Toolchain msvc`.

## Project layout

```
clipdeck/
├── src/                      Frontend (React 19 + Vite 6)
│   ├── App.tsx               Two-pane root, applies theme + accent
│   ├── Settings.tsx          Settings window
│   ├── components/           SearchBar, CommandPalette, ItemList, ItemRow,
│   │                         PreviewPane, DetailsTable, Footer, shared icons
│   ├── lib/                  store (zustand), tauri (typed invoke wrappers),
│   │                         types (mirror of Rust models)
│   └── styles/               tokens.css, app.css, global.css
└── src-tauri/                Rust core
    ├── src/
    │   ├── main.rs           Windows-subsystem entry
    │   ├── lib.rs            Tauri builder, plugin registration, bootstrap
    │   ├── commands.rs       Every #[tauri::command] + clipboard sink
    │   ├── tray.rs           Tray icon and menu
    │   ├── window.rs         Show / hide at cursor + foreground capture
    │   ├── db.rs             SQLite + FTS5 + dedup + retention
    │   ├── models.rs         Wire types (camelCase via serde)
    │   ├── error.rs          Single Error enum with Serialize
    │   ├── clipboard/        Listener thread, format readers, classifier,
    │   │                     hasher
    │   └── win/              appearance (registry), backdrop (DWM+vibrancy),
    │                         source (owner/foreground), paste (SendInput)
    ├── icons/                Tray + window icons (auto-generated)
    ├── tauri.conf.json       Window config + capabilities
    └── Cargo.toml
```

## Default hotkey

**Ctrl + Shift + V.** Win+V is reserved by the OS shell and cannot be
captured by a user process, so this is the de-facto convention for
third-party clipboard managers on Windows.

## Architecture notes

### Clipboard listener

The listener runs on a dedicated thread that owns a **hidden top-level
window** with `WS_EX_TOOLWINDOW`. The shell broadcasts `WM_CLIPBOARDUPDATE`
to top-level windows only — message-only (`HWND_MESSAGE`) windows would
never receive it. We use `AddClipboardFormatListener` so the shell owns
the broadcast.

Each `WM_CLIPBOARDUPDATE`:
1. checks for the sensitive-data opt-out formats and drops the event if set;
2. reads `CF_UNICODETEXT`, `CF_HTML`, the registered "Rich Text Format",
   `CF_HDROP` (via `DragQueryFileW`), and `CF_DIB` / `CF_DIBV5`;
3. classifies the payload (`Text` / `Link` / `Email` / `Color` / `Image` /
   `Files`) and computes a content hash;
4. hands a `ClipEvent` to a `CaptureSink` trait object.

The sink writes images to `app_data/images/{hash}.png`, writes a 256-px
thumbnail next to it, and calls `Db::upsert` which collapses duplicates on
the content hash, bumping the `copy_count` instead.

### Paste back to the previous app

The hotkey handler captures `GetForegroundWindow` *before* the popup steals
focus and stores it in `AppState.foreground`. On paste:

1. release any modifier keys the user is holding so the synthetic V is a
   bare `Ctrl+V`;
2. `AllowSetForegroundWindow(ASFW_ANY)` (a background process cannot move
   focus otherwise);
3. `SetForegroundWindow(prev)` + `BringWindowToTop` + `ShowWindow(SW_RESTORE)`;
4. `AttachThreadInput` so the keystroke is delivered even if the shell
   briefly intercepted the focus transition;
5. `SendInput` Ctrl+V with scan codes (so ScanCodeMap overrides work).

### Backdrop

Two cooperating layers:
- **`window-vibrancy`** for the system material (Acrylic by default, with
  Mica and opaque as fallbacks).
- **DWM attributes** for rounded frame corners and dark-mode titlebar.
  The build degrades gracefully — `DwmSetWindowAttribute` returns
  `E_INVALIDARG` on older Windows builds, which we ignore.

The web layer paints its own surface with `color-mix(in srgb, var(--color-bg) 86%, transparent)`
on top, so the OS blur shows through but text stays legible.

## Privacy

Clipdeck reads the Windows registry to discover the user's accent color and
light/dark preference. It does not make any network calls. Clipboard entries
flagged with `ExcludeClipboardContentFromMonitorProcessing` or
`CanIncludeInClipboardHistory == 0` (set by 1Password, Bitwarden, KeePassXC,
Windows Hello, etc.) are dropped before they reach the database.

The SQLite database and default managed content store live in Tauri's Clipdeck
application-data directory. The Settings window shows the resolved storage
location and can safely migrate image, thumbnail, and file snapshots to a
different folder. History should be cleared from Settings so favorites and
managed assets are handled consistently.

## License

MIT

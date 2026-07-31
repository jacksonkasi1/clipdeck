# Clipdeck Windows UI and Clipboard Overhaul

Branch: `feat/clipdeck-windows-overhaul`

## Visual specification

- Default compact window: 520 x 720 logical pixels; minimum 420 x 600.
- Optional expanded window: 1120 x 720 logical pixels with a 1 px divider.
- Search header: 54 px; preview toolbar: 46 px; history rows: 48 px;
  footer/action strip: 46 px.
- Default theme: layered near-black Fluent surfaces with a restrained cyan
  accent. Light and System modes retain identical geometry and density.
- UI font: Segoe UI Variable; technical previews: Cascadia Mono.
- Controls use 8 px radii, subtle separators, 36 px pointer targets, and
  consistent Lucide-style monoline icons. No emoji icons.
- The history pane shows dense typed rows, favorite status, source/copy
  metadata, hover/selected/focus states, and favorites before recent items.
- The preview pane supplies contextual actions, a useful type-specific preview,
  and compact metadata for text, image, file/folder, link, color, and email.
- Empty history, no results, no selection, editing, confirmation, error,
  loading, and success/undo states must all be designed.

## Implementation checklist

### Phase 1 - UI shell (must complete before feature work)

- [x] Replace the light category dashboard with the premium compact/split-pane shell.
- [x] Establish dark, light, System, high-contrast, and reduced-motion tokens.
- [x] Use Lucide consistently with accessible icon buttons and tooltips.
- [x] Rebuild search, dense history rows, toolbar, preview, metadata, and footer.
- [x] Add adaptive compact/expanded sizing with safe responsive minimum widths.
- [x] Design all clipboard kinds plus empty, no-result, loading, editing, and error states.
- [x] Exercise the running desktop app in both Windows system and fixed themes.

### Phase 2 - Clipboard domain and real-time capture

- [x] Verify the Win32 clipboard listener window receives `WM_CLIPBOARDUPDATE`.
- [x] Capture text/HTML/RTF, links, email, colors, images, files, and folders.
- [x] Persist captures transactionally, deduplicate by content hash, and emit a
  frontend refresh event for both new and repeated copies.
- [x] Prevent self-generated writes from creating capture loops.
- [x] Keep images in the app asset store and pass only safe asset URLs over IPC.
- [x] Keep favorites pinned above non-favorites while preserving recency.

### Phase 3 - History actions and keyboard workflows

- [x] Edit text, link, color, and email items via Ctrl+E and preview click.
- [x] Toggle favorite from row/toolbar/keyboard and immediately re-order history.
- [x] Delete one item with confirmation/undo and never touch original files.
- [x] Clear all non-favorites with confirmation; preserve favorites by default.
- [x] Copy selected content and paste it into the previously active application.
- [x] Implement search, type/favorite filters, keyboard navigation, focus restore,
  and Escape clear-then-hide behavior.

### Phase 4 - Native Windows behavior

- [x] Use a single main-window/taskbar identity and a separate tool-only listener.
- [x] Remove forced always-on-top behavior; expose pinning only as an opt-in state.
- [x] Restore size/position safely on the active display and keep the window visible.
- [x] Preserve standard dragging, edge resizing, minimize/maximize/close, Alt+F4,
  Snap behavior, taskbar activation, and high-DPI scaling.
- [x] Keep tray, global shortcut, foreground restoration, and native paste reliable.
- [x] Apply Windows theme/accent changes live and keep dark/light chrome consistent.

### Phase 5 - Verification and delivery

- [x] Add/update Rust tests for parsing, hashing, dedup, retention, favorites,
  mutations, and clipboard retry/error behavior.
- [x] Add/update frontend tests for navigation, paging, item controls, platform
  shortcuts, theme, and accessible icon buttons.
- [x] Run formatting, TypeScript build, Rust tests, release build, and desktop smoke tests.
- [x] Review compact and expanded responsive layouts in dark, light, and System themes.
- [x] Update README architecture, keyboard reference, build steps,
  limitations, and macOS/Linux follow-ups.
- [x] Build the final size-gated NSIS installer and smoke-test the packaged executable.

## Acceptance gates

- The UI immediately matches the supplied premium desktop references in both themes.
- New Windows clipboard content appears without refresh or reopening the app.
- Edit, favorite, delete, clear-non-favorites, copy, paste, and search work by
  keyboard and mouse.
- The app opens once, is movable/resizable, stays on the active display, and is
  not topmost unless the user explicitly pins it.
- All required builds/tests and a release installer complete successfully.

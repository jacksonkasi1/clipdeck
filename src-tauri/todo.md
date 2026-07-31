# Clipdeck — Build Progress

Status: complete (2026-07-31).

## Goal
Produce a 64-bit `Clipdeck.exe` and NSIS installer (Windows + Tauri 2.11,
GNU toolchain).

## Verified output

- Frontend typecheck and Vite production build pass.
- Rust test suite compiles without warnings for `x86_64-pc-windows-gnu`.
- Tauri release build completes successfully.
- `clipdeck.exe` remains running in a launch smoke test.
- NSIS produces `Clipdeck_0.1.0_x64-setup.exe`.

## Already done
1. Heavy-installs redirected to `D:\Program`:
   - `src-tauri/.cargo/config.toml` → `CARGO_TARGET_DIR = "D:\\Program\\rust-target\\clipdeck"`
   - `.npmrc` → `cache=D:\\Program\\npm-store`
2. Downgraded Vite/Rolldown path to satisfy Node 20.10:
   - `package.json` → `vite ^6.0.0`, `@vitejs/plugin-react ^4.3.0`, `@types/node ^22`.
3. Reinstalled `node_modules` fresh to fix missing `@rolldown/binding-win32-x64-msvc`.
4. GNU toolchain installed at `/d/.rustup/toolchains/stable-x86_64-pc-windows-gnu`.
5. WinLibs MinGW-w64 unpacked to `D:\Program\MinGW\mingw64` (provides `as.exe`/`ld.exe`).
6. **Downgraded `windows` crate 0.62 → 0.61** in `src-tauri/Cargo.toml`. The user's
   code was written for the older API; 0.61 has `AttachThreadInput` in
   `Win32_System_Threading`, `ExtractIconW` in `Win32_UI_Shell`, `RegisterClipboardFormatW`
   returns `u32`, etc.
7. **Rewrote every Win32 call site** to the 0.61 signatures:
   - `src/clipboard/listener.rs` — `RegisterClassExW` + `WNDCLASSEXW` (was
     `WNDCLASSW`), `IsClipboardFormatAvailable(...).is_ok()`, `CreateWindowExW`
     returns `Result<HWND>`, `SetWindowPos` second arg is `Option<HWND>`,
     `Vec<PathBuf>` → `Vec<String>` for `ClipEvent.files`.
   - `src/clipboard/formats.rs` — `from_wide`/`pcwstr`/`to_wide` import moved
     from `super::` to `crate::win::`; Result-based APIs handled with `.ok()?`;
     added a `lock_hglobal` helper (clipboard returns `HANDLE`, `GlobalLock`
     wants `HGLOBAL`).
   - `src/win/paste.rs` — added `send_key`; `AttachThreadInput` now imported
     from `Win32_System_Threading`; `ShowWindowCommand` replaced with
     `SHOW_WINDOW_CMD`; `SW_RESTORE` used directly.
   - `src/win/source.rs` — `ExtractIconW` from `Win32_UI_Shell`; `VerQueryValueW`
     returns `BOOL` so use `.as_bool()`; fixed icon-handle signature mismatch
     (3 args, returns `HICON`, not 4 args / u32).
   - `src/win/backdrop.rs` — added explicit `use windows::Win32::Foundation::HWND`
     (without it, the bare `HWND` was resolving to Tauri's wrapper).
8. **Replaced `clipboard_win` crate** with raw Win32:
   - `src/commands.rs::put_back_on_clipboard` now uses `OpenClipboard` /
     `EmptyClipboard` / `GlobalAlloc` / `SetClipboardData` directly.
   - Removed the `clipboard-win = "5.4"` entry from `Cargo.toml`.
9. **Fixed `Result<Option<ClipItem>>` plumbing**:
   - `src/db.rs` gained `get_required(id) -> Result<ClipItem>` that unwraps
     the `None` case into `Error::NotFound`. Callers in `commands.rs` use it.
10. **Removed duplicate `Upsert` enum** in `src/db.rs` (was declared twice).
11. **Test code in `db.rs`** rewritten to use `content_hash` (was the old
    `hash` field name).
12. **`.cargo/config.toml`** dropped the now-unused `target = "..."` line so
    cargo resolves the toolchain's default.
13. **Use `crate-type = ["rlib"]` for the Windows desktop target.** The binary
    calls `clipdeck_lib::run()` by static Rust linkage; producing a DLL is not
    required and was the source of the MinGW export-ordinal overflow.
14. Removed stale imports and added the missing `NewItem::default()` support so
    the test suite compiles cleanly.
15. Carried captured image bytes through the listener event instead of opening
    the clipboard a second time, removing a race when the clipboard changes
    quickly.
16. Added `scripts/build-win64.ps1`, keeping build artifacts under `D:\Program`.

## Environment that worked
```bash
export PATH="/d/Program/MinGW/mingw64/bin:/d/.rustup/toolchains/stable-x86_64-pc-windows-gnu/lib/rustlib/x86_64-pc-windows-gnu/bin/self-contained:$PATH"
cd /d/WORK/WORK/OPENSOURCE/clipdeck/src-tauri
cargo +stable-x86_64-pc-windows-gnu check --offline   # ✅ clean
cargo +stable-x86_64-pc-windows-gnu build --release --offline  # ❌ link error
```

## Build command

```powershell
.\scripts\build-win64.ps1
```

The launch-at-login setting remains opt-in and is managed by the application;
the build process does not silently change the developer machine's startup
configuration.

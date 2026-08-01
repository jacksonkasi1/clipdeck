//! Identifies the application that owns or triggered a clipboard change.
//!
//! Resolution order:
//!
//! 1. `GetClipboardOwner` — the process that called `SetClipboardData` is the
//!    most accurate answer to "who copied this".
//! 2. `GetForegroundWindow` — used when nothing owns the clipboard yet (for
//!    instance drag-and-drop copies that never opened it).
//!
//! Icon extraction is intentionally skipped in v1; the row uses the display
//! name only, with a coloured fallback glyph derived from the process name.

use std::path::{Path, PathBuf};

use windows::Win32::Foundation::{CloseHandle, HWND};
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};
use windows::Win32::System::DataExchange::GetClipboardOwner;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::ExtractIconW;
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetForegroundWindow, GetWindowThreadProcessId, GA_ROOTOWNER,
};

use crate::models::SourceApp;

use super::{from_wide, pcwstr, to_wide};

/// Returns the foreground window's HWND as a raw `isize` so callers can keep
/// the value across the moment we steal focus.
pub fn current_foreground() -> isize {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            0
        } else {
            hwnd.0 as isize
        }
    }
}

/// True when `hwnd` belongs to the Clipdeck process itself.
///
/// The quick palette captures the previously focused window before it is shown.
/// Rapid hotkey presses can race that capture, so the caller must never store a
/// Clipdeck HWND as the paste target — doing so would make Enter paste into our
/// own webview instead of the user's application.
pub fn is_own_window(hwnd: isize) -> bool {
    use windows::Win32::System::Threading::GetCurrentProcessId;

    match pid_for_hwnd(hwnd) {
        Some(pid) => pid == unsafe { GetCurrentProcessId() },
        None => false,
    }
}

/// Returns the foreground window, or `None` when it is one of our own windows.
pub fn foreground_paste_target() -> Option<isize> {
    let hwnd = current_foreground();
    (hwnd != 0 && !is_own_window(hwnd)).then_some(hwnd)
}

/// Resolves the source application for a clipboard event.
///
/// `hint` is an optional foreground window captured before the popup appeared.
pub fn resolve(hint: Option<isize>) -> Option<SourceApp> {
    let owner = get_clipboard_owner_hwnd();
    let owner_pid = pid_for_hwnd(owner);
    let root_owner = root_owner(owner);
    let candidates = [
        owner_pid,
        pid_for_hwnd(root_owner),
        hint.and_then(pid_for_hwnd),
    ];

    for pid in candidates.into_iter().flatten() {
        if let Some(app) = from_pid(map_webview_to_host(pid)) {
            #[cfg(debug_assertions)]
            log::debug!(
                "source_resolution resolved=true pid={} executable={}",
                pid,
                Path::new(&app.exe_path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("unknown")
            );
            return Some(app);
        }
    }
    None
}

fn get_clipboard_owner_hwnd() -> isize {
    unsafe {
        let hwnd = GetClipboardOwner().ok();
        match hwnd {
            Some(h) if !h.0.is_null() => h.0 as isize,
            _ => 0,
        }
    }
}

fn pid_for_hwnd(hwnd: isize) -> Option<u32> {
    if hwnd == 0 {
        return None;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(HWND(hwnd as *mut _), Some(&mut pid)) };
    (pid != 0).then_some(pid)
}

fn root_owner(hwnd: isize) -> isize {
    if hwnd == 0 {
        return 0;
    }
    let root = unsafe { GetAncestor(HWND(hwnd as *mut _), GA_ROOTOWNER) };
    if root.0.is_null() {
        hwnd
    } else {
        root.0 as isize
    }
}

fn from_pid(pid: u32) -> Option<SourceApp> {
    let path = process_path(pid)?;
    let name = display_name(&path);
    let icon_path = extract_icon(&path);
    Some(SourceApp {
        name,
        exe_path: path.to_string_lossy().to_string(),
        icon_path,
    })
}

pub(crate) fn process_path(pid: u32) -> Option<PathBuf> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut size = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_FORMAT(0),
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(process);
        result.ok()?;
        Some(PathBuf::from(from_wide(&buffer[..size as usize])))
    }
}

fn map_webview_to_host(pid: u32) -> u32 {
    let Some(path) = process_path(pid) else {
        return pid;
    };
    if !is_webview_process(&path) {
        return pid;
    }

    let system = sysinfo::System::new_all();
    let mut current = sysinfo::Pid::from_u32(pid);
    let mut ancestors = Vec::new();
    let mut ancestor_pids = Vec::new();
    for _ in 0..16 {
        let Some(parent) = system.process(current).and_then(sysinfo::Process::parent) else {
            break;
        };
        let Some(process) = system.process(parent) else {
            break;
        };
        let Some(parent_path) = process.exe() else {
            break;
        };
        ancestors.push(parent_path.to_string_lossy().into_owned());
        ancestor_pids.push(parent.as_u32());
        current = parent;
    }
    crate::capture_policy::webview_host_index(&path.to_string_lossy(), &ancestors)
        .and_then(|index| ancestor_pids.get(index).copied())
        .unwrap_or(pid)
}

fn is_webview_process(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.eq_ignore_ascii_case("msedgewebview2.exe")
                || name.eq_ignore_ascii_case("webviewhost.exe")
        })
}

pub(crate) fn is_current_process(path: &str) -> bool {
    let Ok(current) = std::env::current_exe() else {
        return false;
    };
    normalize_path(&current) == normalize_path(Path::new(path))
}

pub(crate) fn normalize_path(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn display_name(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(str::to_owned)
        .unwrap_or_default();

    unsafe {
        let wide = to_wide(path.as_os_str().to_str().unwrap_or_default());
        let path_ptr = pcwstr(&wide);

        let size = GetFileVersionInfoSizeW(path_ptr, None);
        if size == 0 {
            return stem;
        }
        let mut block = vec![0u8; size as usize];
        if GetFileVersionInfoW(path_ptr, None, size, block.as_mut_ptr() as *mut _).is_err() {
            return stem;
        }

        // 040904E4 = US English, Unicode.
        let query = to_wide(r"\StringFileInfo\040904E4\FileDescription");
        let mut value_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut value_len = 0u32;
        let ok = VerQueryValueW(
            block.as_ptr() as *const _,
            pcwstr(&query),
            &mut value_ptr,
            &mut value_len,
        );
        if ok.as_bool() && !value_ptr.is_null() {
            let slice = std::slice::from_raw_parts(value_ptr as *const u16, value_len as usize);
            let result = from_wide(slice);
            if !result.is_empty() {
                return result;
            }
        }
    }
    stem
}

/// Best-effort extraction of the first icon. The icon is written as PNG bytes
/// into the app data directory so the webview can show it directly. Failures
/// are silent — the row will simply fall back to the text glyph.
fn extract_icon(path: &Path) -> Option<String> {
    let exe_str = path.as_os_str().to_str()?;
    let wide = to_wide(exe_str);
    unsafe {
        let icon = ExtractIconW(None, pcwstr(&wide), 0);
        if icon.0.is_null() {
            return None;
        }
        // For v1 we leak the icon handle (process exit cleans it up). The
        // webview row uses the app-name glyph when this returns `None`, so
        // silent failure is acceptable.
    }
    None
}

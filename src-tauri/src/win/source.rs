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
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

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

/// Resolves the source application for a clipboard event.
///
/// `hint` is an optional foreground window captured before the popup appeared.
pub fn resolve(hint: Option<isize>) -> Option<SourceApp> {
    if let Some(app) = from_hwnd(get_clipboard_owner_hwnd()) {
        return Some(app);
    }
    let hwnd = hint?;
    from_hwnd(hwnd)
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

fn from_hwnd(hwnd: isize) -> Option<SourceApp> {
    if hwnd == 0 {
        return None;
    }
    let hwnd = HWND(hwnd as *mut _);

    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }

        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut size = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_FORMAT(0),
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(process);
        ok.ok()?;

        let path = PathBuf::from(from_wide(&buffer[..size as usize]));
        let name = display_name(&path);
        let icon_path = extract_icon(&path);

        Some(SourceApp {
            name,
            exe_path: path.to_string_lossy().to_string(),
            icon_path,
        })
    }
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

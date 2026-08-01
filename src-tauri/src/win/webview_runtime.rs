//! Early WebView2 Runtime preflight for portable builds.

use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, IDYES, MB_ICONERROR, MB_YESNO, SW_SHOWNORMAL,
};
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY};
use winreg::RegKey;

use super::{pcwstr, to_wide};

const WEBVIEW2_CLIENT: &str =
    r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C72C1D9B3A}";
const DOWNLOAD_URL: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

pub fn ensure_available() -> bool {
    if runtime_version().is_some() {
        return true;
    }

    let title = to_wide("Clipdeck requires Microsoft Edge WebView2 Runtime");
    let message = to_wide(
        "Clipdeck could not find Microsoft Edge WebView2 Runtime. The portable package already includes WebView2Loader.dll, but Windows still needs the official Microsoft WebView2 Runtime.\n\nOpen Microsoft's download page now?",
    );
    let choice = unsafe {
        MessageBoxW(
            None,
            pcwstr(&message),
            pcwstr(&title),
            MB_YESNO | MB_ICONERROR,
        )
    };
    if choice == IDYES {
        let operation = to_wide("open");
        let url = to_wide(DOWNLOAD_URL);
        unsafe {
            let _ = ShellExecuteW(
                None,
                pcwstr(&operation),
                pcwstr(&url),
                None,
                None,
                SW_SHOWNORMAL,
            );
        }
    }
    false
}

fn runtime_version() -> Option<String> {
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let root = RegKey::predef(hive);
        for flags in [KEY_READ, KEY_READ | KEY_WOW64_32KEY] {
            let Ok(key) = root.open_subkey_with_flags(WEBVIEW2_CLIENT, flags) else {
                continue;
            };
            let Ok(version) = key.get_value::<String, _>("pv") else {
                continue;
            };
            if !version.trim().is_empty() && version != "0.0.0.0" {
                return Some(version);
            }
        }
    }
    None
}

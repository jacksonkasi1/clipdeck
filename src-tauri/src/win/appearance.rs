//! Reads Windows personalisation settings so the UI can match the OS.
//!
//! The registry is used rather than WinRT `UISettings` to avoid pulling a COM
//! apartment into the process for two integers. Both keys have been stable since
//! Windows 10 and are what the shell itself reads.

use crate::models::SystemAppearance;

/// Fluent's default brand colour, used when the accent cannot be read.
const FALLBACK_ACCENT: &str = "#0078D4";

#[cfg(windows)]
pub fn read() -> SystemAppearance {
    SystemAppearance {
        accent: accent_color().unwrap_or_else(|| FALLBACK_ACCENT.to_string()),
        dark: !apps_use_light_theme().unwrap_or(true),
    }
}

#[cfg(not(windows))]
pub fn read() -> SystemAppearance {
    SystemAppearance {
        accent: FALLBACK_ACCENT.to_string(),
        dark: false,
    }
}

/// Reads `HKCU\Software\Microsoft\Windows\DWM\AccentColor`.
///
/// The DWORD is stored as `0xAABBGGRR`, i.e. the byte order is the reverse of
/// CSS hex, so the channels are unpacked individually.
#[cfg(windows)]
fn accent_color() -> Option<String> {
    let raw = read_dword(r"Software\Microsoft\Windows\DWM", "AccentColor")?;
    let r = raw & 0xFF;
    let g = (raw >> 8) & 0xFF;
    let b = (raw >> 16) & 0xFF;
    Some(format!("#{r:02X}{g:02X}{b:02X}"))
}

/// Reads the app theme preference. `1` means light, `0` means dark.
#[cfg(windows)]
fn apps_use_light_theme() -> Option<bool> {
    read_dword(
        r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
        "AppsUseLightTheme",
    )
    .map(|value| value == 1)
}

#[cfg(windows)]
fn read_dword(subkey: &str, name: &str) -> Option<u32> {
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

    let subkey_w = super::to_wide(subkey);
    let name_w = super::to_wide(name);

    let mut value: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;

    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            super::pcwstr(&subkey_w),
            super::pcwstr(&name_w),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut _),
            Some(&mut size),
        )
    };

    status.is_ok().then_some(value)
}

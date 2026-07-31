//! Windows-specific integration.
//!
//! Everything that talks to Win32 lives under this module so the rest of the
//! crate stays platform-neutral in shape. Each submodule is deliberately narrow:
//!
//! * [`appearance`] — reads the user's accent colour and light/dark preference.
//! * [`backdrop`]   — applies Mica/Acrylic and Windows 11 frame attributes.
//! * [`source`]     — attributes a clipboard change to the application that made it.
//! * [`paste`]      — restores focus to the previous app and synthesises Ctrl+V.

pub mod appearance;
pub mod backdrop;
pub mod paste;
pub mod source;

use windows::core::PCWSTR;

/// Converts a Rust string into a NUL-terminated UTF-16 buffer for Win32 calls.
///
/// The returned `Vec` must outlive any `PCWSTR` taken from it.
pub fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Reads a NUL-terminated UTF-16 string out of a buffer.
pub fn from_wide(buffer: &[u16]) -> String {
    let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..end])
}

/// Borrows a wide buffer as a `PCWSTR`.
///
/// # Safety
/// The caller must keep `buffer` alive for as long as the pointer is used.
pub unsafe fn pcwstr(buffer: &[u16]) -> PCWSTR {
    PCWSTR(buffer.as_ptr())
}

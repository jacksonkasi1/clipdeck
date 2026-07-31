//! Reads the clipboard formats we care about from the Win32 clipboard.
//!
//! The Win32 clipboard is a synchronised shared resource. Each format read
//! follows the same recipe:
//!
//! 1. `OpenClipboard` (idempotent here because the listener is the only
//!    opener, but we still retry on `ERROR_ACCESS_DENIED`).
//! 2. `GetClipboardData(format)` returns an `HGLOBAL`. We lock it, copy the
//!    bytes out, and unlock before the next read.
//! 3. `CloseClipboard` exactly once.
//!
//! Lock contention with the source app is rare but real: the source app has
//! already finished writing by the time `WM_CLIPBOARDUPDATE` is dispatched, so
//! the retry is mostly belt-and-braces.

use std::path::PathBuf;
use std::sync::OnceLock;

use windows::Win32::Foundation::HGLOBAL;
use windows::Win32::System::DataExchange::{
    CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    RegisterClipboardFormatW,
};
use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

use crate::win::{from_wide, pcwstr, to_wide};

/// Standard clipboard format codes not exported by `windows` crate constants
/// that we still need.
pub const CF_UNICODETEXT: u32 = 13;
pub const CF_HDROP: u32 = 15;
pub const CF_DIB: u32 = 8;
pub const CF_DIBV5: u32 = 17;
pub const CF_HTML: &str = "HTML Format";
pub const CF_RTF: &str = "Rich Text Format";
pub const EXCLUDE_FROM_MONITOR: &str = "ExcludeClipboardContentFromMonitorProcessing";
pub const CAN_INCLUDE_IN_HISTORY: &str = "CanIncludeInClipboardHistory";

/// Pre-resolved handles to the registered clipboard formats so we only do the
/// `RegisterClipboardFormatW` lookup once per process.
pub struct Formats {
    pub html: u32,
    pub rtf: u32,
    pub exclude: u32,
    pub can_include: u32,
}

impl Formats {
    pub fn register() -> Self {
        Self {
            html: register(CF_HTML),
            rtf: register(CF_RTF),
            exclude: register(EXCLUDE_FROM_MONITOR),
            can_include: register(CAN_INCLUDE_IN_HISTORY),
        }
    }
}

fn register(name: &str) -> u32 {
    let wide = to_wide(name);
    unsafe { RegisterClipboardFormatW(pcwstr(&wide)) }
}

/// Indicates whether a clipboard change carries the "do not log this" flag
/// set by password managers and other sensitive apps.
pub fn is_sensitive(formats: &Formats) -> bool {
    unsafe {
        IsClipboardFormatAvailable(formats.exclude).is_ok()
            && !IsClipboardFormatAvailable(formats.can_include).is_ok()
    }
}

/// Returns the visible Unicode text on the clipboard, or an empty string if
/// there is none.
pub fn read_text() -> Option<String> {
    with_clipboard(|| {
        if unsafe { IsClipboardFormatAvailable(CF_UNICODETEXT) }.is_err() {
            return None;
        }
        let handle = unsafe { GetClipboardData(CF_UNICODETEXT) }.ok()?;
        let bytes = lock_handle(handle)?;
        // CF_UNICODETEXT is UTF-16LE and NUL-terminated.
        let end = bytes
            .chunks_exact(2)
            .position(|c| c == [0, 0])
            .map(|i| i * 2)
            .unwrap_or(bytes.len());
        let wide: Vec<u16> = bytes[..end]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        Some(String::from_utf16_lossy(&wide))
    })
}

/// Reads the CF_HTML format and returns just the inner fragment, stripping the
/// pre/post HTML envelope. Many apps (including Chromium-based ones) leave a
/// full document in CF_HTML and only the fragment is interesting.
pub fn read_html() -> Option<String> {
    let fmt = get_html_format()?;
    with_clipboard(|| {
        let handle = unsafe { GetClipboardData(fmt) }.ok()?;
        let bytes = lock_handle(handle)?;
        let raw = String::from_utf8_lossy(&bytes).into_owned();
        extract_fragment(&raw).or(Some(raw))
    })
}

fn get_html_format() -> Option<u32> {
    static FORMATS: OnceLock<Formats> = OnceLock::new();
    Some(FORMATS.get_or_init(Formats::register).html)
}

fn get_rtf_format() -> Option<u32> {
    static FORMATS: OnceLock<Formats> = OnceLock::new();
    Some(FORMATS.get_or_init(Formats::register).rtf)
}

/// Returns the raw RTF bytes as a UTF-8 string with non-ASCII replaced.
///
/// RTF is a 7-bit format; everything beyond that is control data, so the
/// lossy conversion is safe.
pub fn read_rtf() -> Option<String> {
    let fmt = get_rtf_format()?;
    with_clipboard(|| {
        if unsafe { IsClipboardFormatAvailable(fmt) }.is_err() {
            return None;
        }
        let handle = unsafe { GetClipboardData(fmt) }.ok()?;
        let bytes = lock_handle(handle)?;
        Some(String::from_utf8_lossy(&bytes).into_owned())
    })
}

/// Reads CF_HDROP into a vector of absolute file paths.
pub fn read_files() -> Vec<PathBuf> {
    use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

    with_clipboard(|| {
        if unsafe { IsClipboardFormatAvailable(CF_HDROP) }.is_err() {
            return None;
        }
        let handle = unsafe { GetClipboardData(CF_HDROP) }.ok()?;
        let hdrop = HDROP(handle.0);
        unsafe {
            let count = DragQueryFileW(hdrop, 0xFFFF_FFFF, None);
            let mut out = Vec::with_capacity(count as usize);
            for i in 0..count {
                let mut buf = [0u16; 4096];
                let n = DragQueryFileW(hdrop, i, Some(&mut buf));
                if n == 0 {
                    continue;
                }
                let path = PathBuf::from(from_wide(&buf[..n as usize]));
                out.push(path);
            }
            Some(out)
        }
    })
    .unwrap_or_default()
}

/// Reads CF_DIB or CF_DIBV5 and returns the bitmap as a PNG byte buffer.
///
/// We prefer the simpler CF_DIB form when present; CF_DIBV5 carries a few
/// extra metadata fields that the PNG encoder does not need.
pub fn read_image() -> Option<Vec<u8>> {
    with_clipboard(|| {
        let format = if unsafe { IsClipboardFormatAvailable(CF_DIBV5) }.is_ok() {
            CF_DIBV5
        } else if unsafe { IsClipboardFormatAvailable(CF_DIB) }.is_ok() {
            CF_DIB
        } else {
            return None;
        };

        let handle = unsafe { GetClipboardData(format) }.ok()?;
        let bytes = lock_handle(handle)?;
        dib_to_png(&bytes)
    })
}

/// Wraps `OpenClipboard` with a small retry loop because a pasting app can
/// briefly hold the clipboard exclusively.
fn with_clipboard<R>(f: impl FnOnce() -> Option<R>) -> Option<R> {
    for _ in 0..10 {
        if unsafe { OpenClipboard(None) }.is_ok() {
            let result = f();
            unsafe {
                let _ = CloseClipboard();
            }
            return result;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    None
}

/// Locks an `HANDLE` returned by `GetClipboardData` and returns its bytes as a `Vec<u8>`.
fn lock_handle(handle: windows::Win32::Foundation::HANDLE) -> Option<Vec<u8>> {
    // Cast `HANDLE` to `HGLOBAL` since the clipboard always returns GMEM-movable
    // memory blocks for the formats we care about.
    let hglobal = HGLOBAL(handle.0);
    lock_hglobal(hglobal)
}

/// Locks an `HGLOBAL` and returns its bytes as a `Vec<u8>`.
fn lock_hglobal(handle: HGLOBAL) -> Option<Vec<u8>> {
    unsafe {
        let ptr = GlobalLock(handle);
        if ptr.is_null() {
            return None;
        }
        let size = GlobalSize(handle);
        let bytes = std::slice::from_raw_parts(ptr as *const u8, size).to_vec();
        let _ = GlobalUnlock(handle);
        Some(bytes)
    }
}

/// Extracts the `<!--StartFragment-->...<!--EndFragment-->` body from a
/// CF_HTML byte stream. Falls back to the full body when the markers are
/// absent, which is the case for older producers.
fn extract_fragment(raw: &str) -> Option<String> {
    let start_marker = "<!--StartFragment-->";
    let end_marker = "<!--EndFragment-->";
    let start = raw.find(start_marker)? + start_marker.len();
    let end = raw.find(end_marker)?;
    if end < start {
        return None;
    }
    Some(raw[start..end].to_string())
}

/// Decodes a DIB into a PNG byte stream.
fn dib_to_png(bytes: &[u8]) -> Option<Vec<u8>> {
    use image::{ImageBuffer, RgbaImage};

    if bytes.len() < std::mem::size_of::<windows::Win32::Graphics::Gdi::BITMAPINFOHEADER>() {
        return None;
    }

    let header_size = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    let width = i32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    let height = i32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
    let bpp = u16::from_le_bytes([bytes[14], bytes[15]]);

    if bpp != 32 && bpp != 24 {
        return None;
    }

    let pixel_offset = header_size as usize;
    let src_w = width.unsigned_abs();
    // Positive height = bottom-up rows, the common case for screenshots.
    let (top_down, src_h) = if height < 0 {
        (true, (-height) as u32)
    } else {
        (false, height as u32)
    };

    let row_bytes = (bpp as u32 / 8) * src_w;
    let stride = (row_bytes + 3) & !3; // each row is 4-byte aligned
    let pixels_size = (stride * src_h) as usize;
    if bytes.len() < pixel_offset + pixels_size {
        return None;
    }
    let pixels = &bytes[pixel_offset..pixel_offset + pixels_size];

    let mut img: RgbaImage = ImageBuffer::new(src_w, src_h);
    for y in 0..src_h {
        let row = &pixels[(y * stride) as usize..];
        let target_y = if top_down { y } else { src_h - 1 - y };
        for x in 0..src_w {
            let px = (x * (bpp as u32 / 8)) as usize;
            let r = row[px + 2];
            let g = row[px + 1];
            let b = row[px];
            let a = if bpp == 32 { row[px + 3] } else { 255 };
            img.put_pixel(x, target_y, image::Rgba([r, g, b, a]));
        }
    }

    let mut out = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut out);
    img.write_to(&mut cursor, image::ImageFormat::Png).ok()?;
    Some(out)
}

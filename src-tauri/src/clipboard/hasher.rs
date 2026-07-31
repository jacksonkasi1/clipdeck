//! Content fingerprints used to collapse identical copies into a single row.
//!
//! We do not need a cryptographic hash: collisions would only mean two distinct
//! payloads sharing a single history entry, which is the user-visible behaviour
//! we want anyway. SHA-256 is used because it is fast on x86_64 with the SHA-NI
//! extensions and the constant comparison time avoids leaking history size
//! through timing.

use std::path::PathBuf;

use sha2::{Digest, Sha256};

pub fn hash_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let mut out = format!("{:x}", hasher.finalize());
    out.truncate(32); // 128-bit prefix is plenty for dedup.
    out
}

pub fn hash_image(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"img:");
    hasher.update(bytes);
    let mut out = format!("{:x}", hasher.finalize());
    out.truncate(32);
    out
}

pub fn hash_files(paths: &[PathBuf]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"files:");
    let mut sorted = paths.to_vec();
    sorted.sort();
    for path in &sorted {
        hasher.update(path.as_os_str().as_encoded_bytes());
        hasher.update([0u8]);
    }
    let mut out = format!("{:x}", hasher.finalize());
    out.truncate(32);
    out
}

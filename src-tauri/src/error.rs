//! Error type shared by every fallible boundary in the app.
//!
//! Every `#[tauri::command]` returns `Result<T, Error>`; `Error` serialises to a
//! plain string so the frontend can surface it without needing a matching shape.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),

    #[error("image error: {0}")]
    Image(#[from] image::ImageError),

    #[error("tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("clipboard is unavailable: {0}")]
    Clipboard(String),

    #[error("{0} not found")]
    NotFound(&'static str),

    #[error("{0}")]
    Other(String),
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<String> for Error {
    fn from(value: String) -> Self {
        Self::Other(value)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

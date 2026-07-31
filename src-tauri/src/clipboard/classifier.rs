//! Heuristic mapping from raw clipboard text to the item kinds shown in the UI.
//!
//! These heuristics are deliberately conservative: every kind other than plain
//! `Text` requires a clear signal, so a user pasting an arbitrary sentence
//! never sees their clipboard labelled as a "Link".

use crate::models::ItemKind;

pub fn classify(text: &str) -> ItemKind {
    let trimmed = text.trim();

    if looks_like_color(trimmed) {
        return ItemKind::Color;
    }
    if looks_like_url(trimmed) {
        return ItemKind::Link;
    }
    if looks_like_email(trimmed) {
        return ItemKind::Email;
    }
    ItemKind::Text
}

fn looks_like_url(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return false;
    }
    // Disallow whitespace inside the URL — would indicate a sentence that
    // happens to start with the protocol.
    !text.chars().any(char::is_whitespace)
}

fn looks_like_email(text: &str) -> bool {
    if text.len() > 254 || text.contains(char::is_whitespace) {
        return false;
    }
    let mut parts = text.splitn(2, '@');
    let local = parts.next().unwrap_or("");
    let domain = parts.next().unwrap_or("");
    !local.is_empty()
        && !domain.is_empty()
        && domain.contains('.')
        && local
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'))
}

fn looks_like_color(text: &str) -> bool {
    if !text.starts_with('#') {
        return false;
    }
    let body = &text[1..];
    (body.len() == 6 || body.len() == 3 || body.len() == 8 || body.len() == 4)
        && body.chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text() {
        assert_eq!(classify("hello world"), ItemKind::Text);
    }

    #[test]
    fn url() {
        assert_eq!(classify("https://example.com"), ItemKind::Link);
        assert_eq!(classify("http://example.com/path?q=1"), ItemKind::Link);
        assert_ne!(classify("https://example.com extra"), ItemKind::Link);
    }

    #[test]
    fn email() {
        assert_eq!(classify("user@example.com"), ItemKind::Email);
        assert_ne!(classify("hello world @ user"), ItemKind::Email);
    }

    #[test]
    fn hex_color() {
        assert_eq!(classify("#FFAA00"), ItemKind::Color);
        assert_eq!(classify("#fff"), ItemKind::Color);
        assert_ne!(classify("#NOTACOLOR"), ItemKind::Color);
    }
}

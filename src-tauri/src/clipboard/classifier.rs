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
    let rest = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"));
    let Some(rest) = rest else {
        return false;
    };
    // Disallow whitespace inside the URL — would indicate a sentence that
    // happens to start with the protocol.
    !rest.is_empty()
        && !matches!(rest.as_bytes().first(), Some(b'/' | b'?' | b'#'))
        && !text.chars().any(char::is_whitespace)
}

fn looks_like_email(text: &str) -> bool {
    if text.len() > 254 || text.contains(char::is_whitespace) {
        return false;
    }
    let mut parts = text.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    !local.is_empty()
        && !domain.is_empty()
        && parts.next().is_none()
        && domain.contains('.')
        && !matches!(domain.as_bytes().first(), Some(b'.' | b'-'))
        && !matches!(domain.as_bytes().last(), Some(b'.' | b'-'))
        && local
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'))
        && domain
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'))
}

fn looks_like_color(text: &str) -> bool {
    if let Some(body) = text.strip_prefix('#') {
        return matches!(body.len(), 3 | 4 | 6 | 8)
            && body.chars().all(|character| character.is_ascii_hexdigit());
    }
    looks_like_functional_color(text)
}

fn looks_like_functional_color(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let (family, body) = ["rgba", "rgb", "hsla", "hsl"]
        .into_iter()
        .find_map(|name| {
            lower
                .strip_prefix(name)
                .and_then(|rest| rest.strip_prefix('('))
                .and_then(|rest| rest.strip_suffix(')'))
                .map(|body| (name, body))
        })
        .unwrap_or(("", ""));
    if family.is_empty() || body.contains('(') || body.contains(')') {
        return false;
    }
    let normalized = body.replace([',', '/'], " ");
    let parts: Vec<&str> = normalized.split_whitespace().collect();
    if !matches!(parts.len(), 3 | 4) {
        return false;
    }
    let alpha_ok = parts.get(3).is_none_or(|value| parse_alpha(value));
    if family.starts_with("rgb") {
        parts[..3].iter().all(|value| parse_rgb(value)) && alpha_ok
    } else {
        parse_number(parts[0]).is_some()
            && parse_percent(parts[1])
            && parse_percent(parts[2])
            && alpha_ok
    }
}

fn parse_number(value: &str) -> Option<f32> {
    value
        .parse::<f32>()
        .ok()
        .filter(|number| number.is_finite())
}

fn parse_percent(value: &str) -> bool {
    value
        .strip_suffix('%')
        .and_then(parse_number)
        .is_some_and(|number| (0.0..=100.0).contains(&number))
}

fn parse_rgb(value: &str) -> bool {
    if value.ends_with('%') {
        parse_percent(value)
    } else {
        parse_number(value).is_some_and(|number| (0.0..=255.0).contains(&number))
    }
}

fn parse_alpha(value: &str) -> bool {
    if value.ends_with('%') {
        parse_percent(value)
    } else {
        parse_number(value).is_some_and(|number| (0.0..=1.0).contains(&number))
    }
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
        assert_ne!(classify("a@b@c.com"), ItemKind::Email);
    }

    #[test]
    fn hex_color() {
        assert_eq!(classify("#FFAA00"), ItemKind::Color);
        assert_eq!(classify("#fff"), ItemKind::Color);
        assert_ne!(classify("#NOTACOLOR"), ItemKind::Color);
    }

    #[test]
    fn functional_colors() {
        assert_eq!(classify("rgb(255 100 3 / 80%)"), ItemKind::Color);
        assert_eq!(classify("rgba(0, 10, 20, 0.5)"), ItemKind::Color);
        assert_eq!(classify("hsl(330 100% 50%)"), ItemKind::Color);
        assert_ne!(classify("rgb(999 0 0)"), ItemKind::Color);
        assert_ne!(classify("hsl(20 150% 10%)"), ItemKind::Color);
    }
}

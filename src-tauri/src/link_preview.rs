//! Best-effort webpage preview fetcher.
//!
//! The fetcher is deliberately conservative:
//!
//! * Only `http` and `https` URLs are accepted. `url::Url::parse` rejects
//!   anything that is not a real absolute URL, including clipboard text
//!   that merely looks like a domain.
//! * The HTTP fetch is delegated to PowerShell, which is available on every
//!   supported host. This keeps the binary footprint small and lets us
//!   inherit the system TLS stack and the user's proxy configuration.
//! * The HTML is parsed in pure Rust with a small handwritten scanner — no
//!   regex on the whole body and no full DOM. Every helper degrades to
//!   `None` instead of panicking, so a malformed page is rendered as a
//!   plain link card rather than crashing the app.
//! * All downloaded assets (favicon, OG image) are written under
//!   `<storage_root>/link-previews/`, which is part of the Tauri asset
//!   protocol scope, so the webview can render them via `convertFileSrc`.
//! * Any failure short-circuits to `Ok(None)`. The UI is expected to fall
//!   back to the existing minimal link card.

use std::io::Write;
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use url::Url;

use crate::error::{Error, Result};
use crate::models::LinkPreview;
use crate::storage;

/// Wall-time budget for the entire PowerShell fetch. The inner command has
/// its own timeout; this is the hard ceiling for the call as a whole.
const FETCH_TIMEOUT: Duration = Duration::from_secs(8);
/// Maximum body bytes accepted from the page. Anything beyond is discarded
/// by the PowerShell script; the HTML we actually need lives in the first
/// 256 KB anyway.
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;
/// Maximum bytes for the favicon / OG image.
const MAX_ASSET_BYTES: usize = 2 * 1024 * 1024;

const FETCH_SCRIPT: &str = r#"$ErrorActionPreference = 'Stop'
param(
    [Parameter(Mandatory = $true)][string]$Url,
    [int]$TimeoutMs = 6000,
    [int]$MaxBytes = 4194304
)
$request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $Url)
$request.Headers.UserAgent.ParseAdd('Clipmo/0.2 (link preview; +https://github.com/jacksonkasi1/clipmo)')
$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $true
$handler.MaxAutomaticRedirections = 5
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromMilliseconds($TimeoutMs)
try {
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    $status = [int]$response.StatusCode
    $finalUrl = $response.RequestMessage.RequestUri.AbsoluteUri
    if ($status -lt 200 -or $status -ge 300) {
        [pscustomobject]@{ Status = $status; FinalUrl = $finalUrl; ContentType = ''; Body = '' } | ConvertTo-Json -Compress
        exit 0
    }
    $contentType = ''
    if ($response.Content.Headers.TryGetValues('Content-Type', [ref]$values)) {
        $contentType = ($values | Select-Object -First 1)
    }
    $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $buffer = New-Object byte[] $MaxBytes
    $memory = [System.IO.MemoryStream]::new()
    $total = 0
    while ($true) {
        $read = $stream.ReadAsync($buffer, 0, $buffer.Length).GetAwaiter().GetResult()
        if ($read -le 0) { break }
        $memory.Write($buffer, 0, $read)
        $total += $read
        if ($total -ge $MaxBytes) { break }
    }
    $body = [Convert]::ToBase64String($memory.ToArray())
    [pscustomobject]@{
        Status = $status
        FinalUrl = $finalUrl
        ContentType = $contentType
        Body = $body
    } | ConvertTo-Json -Compress
} catch {
    [pscustomobject]@{ Status = 0; FinalUrl = $Url; ContentType = ''; Body = ''; Error = $_.Exception.Message } | ConvertTo-Json -Compress
} finally {
    $client.Dispose()
    $handler.Dispose()
}
"#;

/// Fetches the rich preview for `url`, caching assets under `storage_root`.
pub fn fetch(storage_root: &Path, input: &str) -> Result<Option<LinkPreview>> {
    let url = match parse_url(input) {
        Some(url) => url,
        None => return Ok(None),
    };
    let preview_root = storage::link_preview_root(storage_root);
    std::fs::create_dir_all(&preview_root)?;

    let response = match powershell_fetch(&url) {
        Ok(response) => response,
        Err(error) => {
            log::info!("link preview fetch skipped: {error}");
            return Ok(None);
        }
    };
    if response.body.is_empty() {
        return Ok(None);
    }
    if response.status != 200 && response.status != 0 {
        log::info!("link preview fetch status={} url={}", response.status, url);
    }
    if !is_html_content(&response.content_type) && !looks_like_html(&response.body) {
        return Ok(None);
    }

    let final_url = response.final_url;
    let head = head_window(&response.body, 256 * 1024);
    let title = parse_meta(&head, "property", "og:title")
        .or_else(|| parse_meta(&head, "name", "twitter:title"))
        .or_else(|| parse_html_title(&head))
        .map(trim_and_collapse)
        .filter(|value| !value.is_empty());
    let description = parse_meta(&head, "property", "og:description")
        .or_else(|| parse_meta(&head, "name", "twitter:description"))
        .or_else(|| parse_meta(&head, "name", "description"))
        .map(trim_and_collapse)
        .filter(|value| !value.is_empty());
    let site_name = parse_meta(&head, "property", "og:site_name")
        .map(trim_and_collapse)
        .filter(|value| !value.is_empty());
    let image_url = parse_meta(&head, "property", "og:image")
        .or_else(|| parse_meta(&head, "name", "twitter:image"))
        .or_else(|| parse_meta(&head, "name", "twitter:image:src"));
    let icon_url = parse_meta(&head, "property", "og:image:secure_url")
        .or_else(|| parse_link_rel(&head, "icon"))
        .or_else(|| parse_link_rel(&head, "shortcut icon"))
        .or_else(|| parse_link_rel(&head, "apple-touch-icon"));

    if title.is_none() && description.is_none() && site_name.is_none() && image_url.is_none() {
        return Ok(None);
    }

    let image_path = match image_url
        .as_deref()
        .and_then(|raw| resolve_url(&final_url, raw))
    {
        Some(resolved) => download_into(storage_root, &resolved, "image")
            .ok()
            .flatten(),
        None => None,
    };
    let favicon_path = match icon_url
        .as_deref()
        .and_then(|raw| resolve_url(&final_url, raw))
    {
        Some(resolved) => download_into(storage_root, &resolved, "favicon")
            .ok()
            .flatten()
            .or_else(|| download_favicon(&final_url, storage_root).ok().flatten()),
        None => download_favicon(&final_url, storage_root).ok().flatten(),
    };

    Ok(Some(LinkPreview {
        resolved_url: (final_url.as_str() != url.as_str()).then(|| final_url.to_string()),
        title,
        description,
        site_name,
        favicon_path,
        image_path,
        fetched_at: crate::models::now_ms(),
    }))
}

fn parse_url(input: &str) -> Option<Url> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    Url::parse(&with_scheme)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https"))
}

#[derive(Debug)]
struct FetchResponse {
    status: u16,
    final_url: Url,
    content_type: String,
    body: Vec<u8>,
}

fn powershell_fetch(url: &Url) -> Result<FetchResponse> {
    let deadline = Instant::now() + FETCH_TIMEOUT;
    let mut child = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            FETCH_SCRIPT,
            "-Url",
            url.as_str(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| Error::Other(format!("powershell launch failed: {error}")))?;
    {
        let stdout = child
            .stdout
            .as_mut()
            .ok_or_else(|| Error::Other("powershell stdout was not captured".into()))?;
        let _ = stdout.set_read_timeout(Some(remaining(deadline)));
    }
    let output = child
        .wait_with_output()
        .map_err(|error| Error::Other(format!("powershell wait failed: {error}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(Error::Other(format!(
            "powershell exit {:?}: {}",
            output.status.code(),
            stderr.trim()
        )));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|error| Error::Other(format!("powershell JSON parse failed: {error}")))?;
    let status = value
        .get("Status")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0) as u16;
    let final_url = value
        .get("FinalUrl")
        .and_then(serde_json::Value::as_str)
        .and_then(|raw| Url::parse(raw).ok())
        .unwrap_or_else(|| url.clone());
    let content_type = value
        .get("ContentType")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    let body_b64 = value
        .get("Body")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    if body_b64.is_empty() {
        return Ok(FetchResponse {
            status,
            final_url,
            content_type,
            body: Vec::new(),
        });
    }
    use base64::Engine;
    let body = base64::engine::general_purpose::STANDARD
        .decode(body_b64)
        .map_err(|error| Error::Other(format!("base64 decode failed: {error}")))?;
    if body.len() > MAX_BODY_BYTES {
        return Ok(FetchResponse {
            status,
            final_url,
            content_type,
            body: Vec::new(),
        });
    }
    Ok(FetchResponse {
        status,
        final_url,
        content_type,
        body,
    })
}

fn remaining(deadline: Instant) -> Duration {
    let now = Instant::now();
    if deadline <= now {
        Duration::ZERO
    } else {
        deadline - now
    }
}

fn is_html_content(content_type: &str) -> bool {
    content_type.contains("text/html") || content_type.contains("application/xhtml")
}

fn looks_like_html(body: &[u8]) -> bool {
    let head = head_window(body, 1024);
    let lower = head.to_ascii_lowercase();
    lower.contains("<html") || lower.contains("<!doctype html")
}

fn head_window(body: &[u8], max: usize) -> String {
    let upper = body.len().min(max);
    String::from_utf8_lossy(&body[..upper]).into_owned()
}

fn parse_meta(head: &str, attribute: &str, value: &str) -> Option<String> {
    let needle_lo = format!("{attribute}=\"{value}\"");
    let needle_hi = format!("{attribute}='{value}'");
    let lower = head.to_ascii_lowercase();
    let position = lower.find(&needle_lo).or_else(|| lower.find(&needle_hi))?;
    let tag = tag_at(&head[position..])?;
    extract_attr(&tag, "content")
}

fn parse_link_rel(head: &str, rel: &str) -> Option<String> {
    let needle_lo = format!("rel=\"{rel}\"");
    let needle_hi = format!("rel='{rel}'");
    let lower = head.to_ascii_lowercase();
    let position = lower.find(&needle_lo).or_else(|| lower.find(&needle_hi))?;
    let tag = tag_at(&head[position..])?;
    extract_attr(&tag, "href")
}

fn parse_html_title(head: &str) -> Option<String> {
    let lower = head.to_ascii_lowercase();
    let open = lower.find("<title")?;
    let after_tag = head[open..].find('>')? + open + 1;
    let close = head[after_tag..].to_ascii_lowercase().find("</title>")? + after_tag;
    Some(head[after_tag..close].to_string())
}

fn tag_at(slice: &str) -> Option<String> {
    let end = slice.find('>')?;
    Some(slice[..=end].to_string())
}

fn extract_attr(tag: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=");
    let lower = tag.to_ascii_lowercase();
    let position = lower.find(&needle)? + needle.len();
    let rest = &tag[position..];
    let quote = rest.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let body = &rest[quote.len_utf8()..];
    let close = body.find(quote)?;
    Some(body[..close].to_string())
}

fn resolve_url(base: &Url, raw: &str) -> Option<Url> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(absolute) = Url::parse(trimmed) {
        return Some(absolute);
    }
    base.join(trimmed).ok()
}

fn trim_and_collapse(mut value: String) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let mut out = String::with_capacity(trimmed.len());
    let mut in_whitespace = false;
    for ch in trimmed.chars() {
        if ch.is_whitespace() {
            if !in_whitespace {
                out.push(' ');
                in_whitespace = true;
            }
        } else {
            out.push(ch);
            in_whitespace = false;
        }
    }
    value.clear();
    value.push_str(out.trim());
    value
}

fn download_into(storage_root: &Path, url: &Url, label: &str) -> Result<Option<String>> {
    if !matches!(url.scheme(), "http" | "https") {
        return Ok(None);
    }
    let deadline = Instant::now() + FETCH_TIMEOUT;
    let response = match powershell_fetch(url) {
        Ok(response) => response,
        Err(error) => {
            log::info!("link preview asset fetch skipped: {error}");
            return Ok(None);
        }
    };
    if response.status != 200 {
        return Ok(None);
    }
    if response.body.is_empty() || response.body.len() > MAX_ASSET_BYTES {
        return Ok(None);
    }
    let digest = Sha256::digest(url.as_str().as_bytes());
    let ext = url
        .path_segments()
        .and_then(|segments| segments.filter(|s| !s.is_empty()).last())
        .and_then(|name| name.rsplit_once('.'))
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .filter(|ext| {
            matches!(
                ext.as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp" | "ico"
            )
        })
        .unwrap_or_else(|| "png".to_string());
    let path = if ext == "ico" {
        match transcode_ico_to_png(&response.body) {
            Some(transcoded) => write_asset(
                storage_root,
                label,
                &format!("{digest:x}"),
                "png",
                &transcoded,
            )?,
            None => return Ok(None),
        }
    } else {
        write_asset(
            storage_root,
            label,
            &format!("{digest:x}"),
            &ext,
            &response.body,
        )?
    };
    Ok(Some(path))
}

fn transcode_ico_to_png(bytes: &[u8]) -> Option<Vec<u8>> {
    let cursor = std::io::Cursor::new(bytes);
    let format = image::ImageFormat::Ico;
    let reader = image::ImageReader::with_format(cursor, format);
    let mut decoder = reader.into_decoder().ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(1024);
    limits.max_image_height = Some(1024);
    decoder.set_limits(limits);
    let frame = decoder.into_frames().next()?.ok()?;
    let buffer = frame.into_buffer();
    let mut out = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut out);
    use image::ImageEncoder;
    encoder
        .write_image(
            buffer.as_raw(),
            buffer.width(),
            buffer.height(),
            buffer.color().into(),
        )
        .ok()?;
    Some(out)
}

fn write_asset(
    storage_root: &Path,
    label: &str,
    digest: &str,
    ext: &str,
    bytes: &[u8],
) -> Result<String> {
    let preview_root = storage::link_preview_root(storage_root);
    std::fs::create_dir_all(&preview_root)?;
    let path = preview_root.join(format!("{label}-{digest}.{ext}"));
    let mut file = std::fs::File::create(&path)?;
    file.write_all(bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

fn download_favicon(url: &Url, storage_root: &Path) -> Result<Option<String>> {
    let origin = url.origin().ascii_serialization();
    let origin_url = match Url::parse(&format!("{origin}/")) {
        Ok(url) => url,
        Err(_) => return Ok(None),
    };
    let favicon = origin_url.join("favicon.ico")?;
    download_into(storage_root, &favicon, "favicon")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_url_normalises_bare_hosts() {
        let url = parse_url("example.com").expect("bare host should be accepted");
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("example.com"));
    }

    #[test]
    fn parse_url_rejects_unsafe_schemes() {
        assert!(parse_url("javascript:alert(1)").is_none());
        assert!(parse_url("file:///etc/passwd").is_none());
        assert!(parse_url("").is_none());
    }

    #[test]
    fn parse_meta_extracts_open_graph_title() {
        let html = r#"<html><head><meta property="og:title" content="Hello World"></head></html>"#;
        assert_eq!(
            parse_meta(html, "property", "og:title").as_deref(),
            Some("Hello World"),
        );
    }

    #[test]
    fn parse_meta_falls_back_to_meta_name() {
        let html = r#"<html><head><meta name="description" content="A test page"></head></html>"#;
        assert_eq!(
            parse_meta(html, "name", "description").as_deref(),
            Some("A test page"),
        );
    }

    #[test]
    fn parse_html_title_preserves_inner_whitespace() {
        let html = "<html><head><title>  Hello\n\n  World  </title></head></html>";
        assert_eq!(
            parse_html_title(html).as_deref(),
            Some("  Hello\n\n  World  "),
        );
    }

    #[test]
    fn parse_link_icon_finds_shortcut_icon() {
        let html = r#"<html><head><link rel="shortcut icon" href="/favicon.ico"></head></html>"#;
        assert_eq!(parse_link_icon(html).as_deref(), Some("/favicon.ico"));
    }

    #[test]
    fn trim_and_collapse_keeps_single_spaces() {
        let input = "  hello\n\n   world  \t  again ".to_string();
        assert_eq!(trim_and_collapse(input), "hello world again");
    }

    #[test]
    fn fetch_returns_none_for_unsafe_urls() {
        let temp = std::env::temp_dir().join("clipmo-link-preview-test");
        let _ = std::fs::create_dir_all(&temp);
        assert!(fetch(&temp, "javascript:alert(1)").unwrap().is_none());
        assert!(fetch(&temp, "not a url at all").unwrap().is_none());
        let _ = std::fs::remove_dir_all(&temp);
    }
}

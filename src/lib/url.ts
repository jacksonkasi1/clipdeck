// ** import lib
//
// URL helpers used by the preview pane to tolerate the clipboard giving
// us a bare domain (`example.com`) instead of a fully-qualified URL.
// The Tauri opener plugin rejects anything without a scheme, so we
// normalise before calling openUrl.

const SCHEME_RE = /^(?:https?|mailto):/i;
const DOMAIN_RE = /^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/.*)?$/;
const LOOPBACK_OR_IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/.*)?$/;
const LOCALHOST = /^localhost(?::\d+)?(?:[/?#].*)?$/i;

/**
 * Schemes we are willing to hand to the OS. Anything else (file://,
 * javascript:, data:, ftp://, …) is rejected outright — the toast
 * surfaces the rejection so the user understands why the click did
 * nothing.
 */
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto']);

/**
 * Returns true when `value` already carries a recognised scheme
 * (`https://…`, `mailto:…`). Bare hostnames such as `localhost:3000`
 * are NOT treated as schemes — they look like a host with a port.
 */
export function hasScheme(value: string): boolean {
  return SCHEME_RE.test(value.trim());
}

/**
 * Returns true when `value` looks like a domain we can hand to the
 * default browser without further classification. We accept bare
 * domains, names with a path, IPv4 addresses with a port, and
 * `localhost` (with optional port).
 */
export function looksLikeDomain(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && (
    DOMAIN_RE.test(trimmed)
    || LOOPBACK_OR_IPV4.test(trimmed)
    || LOCALHOST.test(trimmed)
  );
}

/**
 * Heuristic classification of the candidate URL. Returns the scheme
 * to prepend (`https` for clear-text browsing, `mailto` for `@`),
 * or `null` when the input is not recognisably addressable.
 */
export function tryParseScheme(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (hasScheme(trimmed)) {
    const colon = trimmed.indexOf(':');
    const scheme = trimmed.slice(0, colon).toLowerCase();
    return ALLOWED_SCHEMES.has(scheme) ? scheme : null;
  }
  if (looksLikeDomain(trimmed)) return 'https';
  if (trimmed.includes('@') && !trimmed.includes(' ')) return 'mailto';
  return null;
}

/**
 * Normalise a clipboard URL into something the opener plugin can
 * route. Returns the original input unchanged when no scheme can
 * be inferred — callers should surface a toast in that case.
 */
export function normaliseUrl(value: string): string {
  const trimmed = value.trim();
  if (hasScheme(trimmed)) return trimmed;
  if (LOCALHOST.test(trimmed)) return `http://${trimmed}`;
  if (looksLikeDomain(trimmed)) return `https://${trimmed}`;
  if (trimmed.includes('@') && !trimmed.includes(' ')) return `mailto:${trimmed}`;
  return trimmed;
}

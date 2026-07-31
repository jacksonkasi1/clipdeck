const NAMED_KEYS = new Set([
  'Space',
  'Enter',
  'Tab',
  'Escape',
  'Insert',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Backslash',
  'Slash',
  'Comma',
  'Period',
  'Semicolon',
  'Quote',
  'Backquote',
  'Minus',
  'Equals',
  'BracketLeft',
  'BracketRight',
]);

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  Esc: 'Escape',
  Del: 'Delete',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equals',
  '[': 'BracketLeft',
  ']': 'BracketRight',
};

export interface ShortcutKeyEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export function shortcutFromKeyEvent(
  event: ShortcutKeyEvent,
  metaLabel: 'Super' | 'Win',
): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return null;
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null;

  const key = normalizeShortcutKey(event.key);
  if (!key) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push(metaLabel);
  return [...parts, key].join('+');
}

export function normalizeShortcutKey(key: string): string | null {
  const normalized = KEY_ALIASES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  if (/^[A-Z0-9]$/.test(normalized)) return normalized;
  if (/^F(?:[1-9]|1[0-2])$/.test(normalized)) return normalized;
  return NAMED_KEYS.has(normalized) ? normalized : null;
}

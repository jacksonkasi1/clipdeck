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
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export type ShortcutRecorderKeyAction = 'leave' | 'blur' | 'record';

/** Keeps normal focus traversal outside the shortcut-capture path. */
export function shortcutRecorderKeyAction(key: string): ShortcutRecorderKeyAction {
  if (key === 'Tab') return 'leave';
  if (key === 'Escape') return 'blur';
  return 'record';
}

export function shortcutFromKeyEvent(
  event: ShortcutKeyEvent,
  metaLabel: 'Super' | 'Win',
): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return null;
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null;

  const key = normalizeShortcutCode(event.code) ?? normalizeShortcutKey(event.key);
  if (!key) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push(metaLabel);
  return [...parts, key].join('+');
}

/** Maps physical browser key codes to the names accepted by the native parser. */
export function normalizeShortcutCode(code: string | undefined): string | null {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
  if (code === 'Equal') return 'Equals';
  return NAMED_KEYS.has(code) ? code : null;
}

export function normalizeShortcutKey(key: string): string | null {
  const normalized = KEY_ALIASES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  if (/^[A-Z0-9]$/.test(normalized)) return normalized;
  if (/^F(?:[1-9]|1[0-2])$/.test(normalized)) return normalized;
  return NAMED_KEYS.has(normalized) ? normalized : null;
}

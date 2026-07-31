// ** import lib
import { describe, expect, it } from 'vitest';

import { normalizeShortcutKey, shortcutFromKeyEvent } from './global-shortcut';

describe('global shortcut recorder', () => {
  it('records supported keys with a primary modifier', () => {
    expect(shortcutFromKeyEvent({
      key: 'v',
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      metaKey: false,
    }, 'Win')).toBe('Ctrl+Shift+V');
  });

  it('rejects shortcuts that would capture ordinary typing', () => {
    expect(shortcutFromKeyEvent({
      key: 'v',
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
      metaKey: false,
    }, 'Win')).toBeNull();
  });

  it('rejects keys unsupported by the Rust registration layer', () => {
    expect(normalizeShortcutKey('AudioVolumeUp')).toBeNull();
    expect(normalizeShortcutKey('F13')).toBeNull();
    expect(normalizeShortcutKey('F12')).toBe('F12');
  });
});

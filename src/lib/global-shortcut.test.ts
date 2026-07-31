// ** import lib
import { describe, expect, it } from 'vitest';

import {
  normalizeShortcutCode,
  normalizeShortcutKey,
  shortcutFromKeyEvent,
  shortcutRecorderKeyAction,
} from './global-shortcut';

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

  it('prefers physical codes for shifted and non-Latin keyboard layouts', () => {
    expect(normalizeShortcutCode('Digit1')).toBe('1');
    expect(normalizeShortcutCode('Equal')).toBe('Equals');
    expect(shortcutFromKeyEvent({
      key: '!',
      code: 'Digit1',
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      metaKey: false,
    }, 'Win')).toBe('Ctrl+Shift+1');
    expect(shortcutFromKeyEvent({
      key: 'м',
      code: 'KeyV',
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    }, 'Win')).toBe('Ctrl+V');
  });

  it('lets Tab and Shift+Tab leave the recorder while Escape ends recording', () => {
    expect(shortcutRecorderKeyAction('Tab')).toBe('leave');
    expect(shortcutRecorderKeyAction('Escape')).toBe('blur');
    expect(shortcutRecorderKeyAction('v')).toBe('record');
  });
});

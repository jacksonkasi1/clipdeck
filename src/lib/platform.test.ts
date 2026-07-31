// ** import lib
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPlatform, getShortcutKeys, getShortcutLabel } from './platform';

describe('platform shortcut labels', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses Windows key names and never shows macOS command glyphs on Windows', () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows NT 10.0' });
    expect(getPlatform()).toBe('windows');
    expect(getShortcutKeys('edit')).toEqual(['Ctrl', 'E']);
    expect(getShortcutLabel('commands')).toBe('Ctrl+K');
    expect(getShortcutLabel('commands')).not.toContain('⌘');
  });

  it('uses native macOS labels only on macOS', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Macintosh' });
    expect(getPlatform()).toBe('macos');
    expect(getShortcutKeys('edit')).toEqual(['⌘', 'E']);
    expect(getShortcutLabel('commands')).toBe('⌘K');
  });
});

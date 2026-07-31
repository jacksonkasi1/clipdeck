// ** import lib
import { describe, expect, it, vi } from 'vitest';

import { applyTheme, resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('keeps an explicit dark preference when Windows is light', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('keeps an explicit light preference when Windows is dark', () => {
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('matches the current Windows appearance for the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('applyTheme', () => {
  it('updates the webview theme and accent from one shared path', () => {
    const setProperty = vi.fn();
    const target = {
      dataset: {} as DOMStringMap,
      style: { setProperty },
    } as unknown as HTMLElement;

    expect(applyTheme('system', { dark: true, accent: '#31b8e8' }, target)).toBe('dark');
    expect(target.dataset.theme).toBe('dark');
    expect(setProperty).toHaveBeenCalledWith('--accent', '#31b8e8');
  });
});

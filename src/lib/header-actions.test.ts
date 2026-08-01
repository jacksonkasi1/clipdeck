// ** import lib
import { describe, expect, it } from 'vitest';

import { isSearchActive, visibleHeaderActions } from './header-actions';

const base = { mode: 'full' as const, searchFocused: false, hasSearchText: false };

describe('visibleHeaderActions', () => {
  it('omits pin and commands in the quick flyout', () => {
    const actions = visibleHeaderActions({ ...base, mode: 'quick' });

    expect(actions).not.toContain('pin');
    expect(actions).not.toContain('commands');
    expect(actions).not.toContain('settings');
    expect(actions).toEqual(['preview']);
  });

  it('exposes the full application toolbar while search is idle', () => {
    expect(visibleHeaderActions(base)).toEqual(['preview', 'pin', 'commands', 'settings']);
  });

  it('hands the whole header to search once the field has focus', () => {
    expect(visibleHeaderActions({ ...base, searchFocused: true })).toEqual([]);
    expect(visibleHeaderActions({ ...base, mode: 'quick', searchFocused: true })).toEqual([]);
  });

  it('keeps only the clear affordance while a query is active', () => {
    expect(visibleHeaderActions({ ...base, searchFocused: true, hasSearchText: true }))
      .toEqual(['clearSearch']);
    // Blurring with text still applied keeps search in charge of the header,
    // so the icons do not flicker back in mid-filter.
    expect(visibleHeaderActions({ ...base, hasSearchText: true })).toEqual(['clearSearch']);
  });

  it('restores the permitted actions once the query is cleared', () => {
    expect(visibleHeaderActions({ ...base, hasSearchText: false }))
      .toEqual(['preview', 'pin', 'commands', 'settings']);
  });

  it('reports when search owns the header', () => {
    expect(isSearchActive(base)).toBe(false);
    expect(isSearchActive({ ...base, searchFocused: true })).toBe(true);
    expect(isSearchActive({ ...base, hasSearchText: true })).toBe(true);
  });
});

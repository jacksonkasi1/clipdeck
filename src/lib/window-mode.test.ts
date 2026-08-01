import { describe, expect, it } from 'vitest';

import { modeFromSearch } from './window-mode';

describe('window mode resolution', () => {
  it('reads the explicit mode parameter', () => {
    expect(modeFromSearch('?mode=quick')).toBe('quick');
    expect(modeFromSearch('?mode=full')).toBe('full');
  });

  it('defaults to the full application for unknown or missing values', () => {
    expect(modeFromSearch('')).toBe('full');
    expect(modeFromSearch('?mode=')).toBe('full');
    expect(modeFromSearch('?mode=compact')).toBe('full');
  });

  it('ignores unrelated query parameters', () => {
    expect(modeFromSearch('?theme=dark&mode=quick&x=1')).toBe('quick');
  });
});

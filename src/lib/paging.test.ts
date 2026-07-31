// ** import lib
import { describe, expect, it } from 'vitest';

import { HISTORY_PAGE_SIZE, mergeUniquePage, pageMayHaveMore } from './paging';

describe('mergeUniquePage', () => {
  it('preserves page order while removing overlapping and repeated IDs', () => {
    const current = [{ id: 3 }, { id: 2 }];
    const page = [{ id: 2 }, { id: 1 }, { id: 1 }, { id: 0 }];
    expect(mergeUniquePage(current, page).map((item) => item.id)).toEqual([3, 2, 1, 0]);
  });

  it('reuses the current array when a page contains no new rows', () => {
    const current = [{ id: 2 }];
    expect(mergeUniquePage(current, [{ id: 2 }])).toBe(current);
  });
});

describe('pageMayHaveMore', () => {
  it('keeps paging only when the backend filled the requested page', () => {
    expect(pageMayHaveMore(HISTORY_PAGE_SIZE)).toBe(true);
    expect(pageMayHaveMore(HISTORY_PAGE_SIZE - 1)).toBe(false);
  });
});

// ** import lib
import { describe, expect, it } from 'vitest';

import { getListKeyboardAction } from './list-navigation';

describe('getListKeyboardAction', () => {
  it('selects the first row when navigating without an existing selection', () => {
    expect(getListKeyboardAction('ArrowDown', -1, 4, true)).toEqual({ type: 'select', index: 0 });
  });

  it('wraps arrow navigation continuously at both ends', () => {
    expect(getListKeyboardAction('ArrowDown', 3, 4, true)).toEqual({ type: 'select', index: 0 });
    expect(getListKeyboardAction('ArrowUp', 0, 4, true)).toEqual({ type: 'select', index: 3 });
  });

  it('selects the last row on ArrowUp without an existing selection', () => {
    expect(getListKeyboardAction('ArrowUp', -1, 4, true)).toEqual({ type: 'select', index: 3 });
  });

  it('keeps page and absolute navigation inside the available rows', () => {
    expect(getListKeyboardAction('PageDown', 2, 4, true)).toEqual({ type: 'select', index: 3 });
    expect(getListKeyboardAction('End', 1, 4, true)).toEqual({ type: 'select', index: 3 });
  });

  it('pastes on Enter when the preference is enabled', () => {
    expect(getListKeyboardAction('Enter', 0, 1, true)).toEqual({ type: 'paste' });
  });

  it('copies on Enter when paste-on-enter is disabled', () => {
    expect(getListKeyboardAction('Enter', 0, 1, false)).toEqual({ type: 'copy' });
  });

  it('ignores navigation when the history is empty', () => {
    expect(getListKeyboardAction('ArrowDown', -1, 0, true)).toBeNull();
  });
});

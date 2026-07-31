// ** import lib
import { describe, expect, it } from 'vitest';

import { getListKeyboardAction } from './list-navigation';

describe('getListKeyboardAction', () => {
  it('selects the first row when navigating without an existing selection', () => {
    expect(getListKeyboardAction('ArrowDown', -1, 4, true)).toEqual({ type: 'select', index: 0 });
  });

  it('keeps navigation inside the available rows', () => {
    expect(getListKeyboardAction('ArrowUp', 0, 4, true)).toEqual({ type: 'select', index: 0 });
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

// ** import lib
import { describe, expect, it } from 'vitest';

import { mutationErrorMessage } from './mutation-error';

describe('mutation error messages', () => {
  it('shows useful Error and string details after the action summary', () => {
    expect(mutationErrorMessage('Settings could not be saved.', new Error('Shortcut is unavailable.')))
      .toBe('Settings could not be saved. Shortcut is unavailable.');
    expect(mutationErrorMessage('Storage location could not be changed.', 'Folder is read-only.'))
      .toBe('Storage location could not be changed. Folder is read-only.');
  });

  it('keeps a safe fallback when the rejection has no readable detail', () => {
    expect(mutationErrorMessage('Settings could not be saved.', { code: 500 }))
      .toBe('Settings could not be saved.');
  });
});

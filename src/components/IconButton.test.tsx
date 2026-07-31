// ** import lib
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('exposes the accessible label as both name and tooltip', () => {
    const markup = renderToStaticMarkup(<IconButton label="Copy item"><span /></IconButton>);
    expect(markup).toContain('aria-label="Copy item"');
    expect(markup).toContain('title="Copy item"');
  });

  it('exposes both states for toggle buttons', () => {
    const off = renderToStaticMarkup(<IconButton label="Favorite" active={false}><span /></IconButton>);
    const on = renderToStaticMarkup(<IconButton label="Favorite" active><span /></IconButton>);
    expect(off).toContain('aria-pressed="false"');
    expect(on).toContain('aria-pressed="true"');
  });

  it('does not mark ordinary action buttons as toggles', () => {
    const markup = renderToStaticMarkup(<IconButton label="Copy"><span /></IconButton>);
    expect(markup).not.toContain('aria-pressed');
  });
});

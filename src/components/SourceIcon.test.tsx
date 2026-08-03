/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { SourceIcon } from './SourceIcon';

const fileSrcMock = vi.hoisted(() => vi.fn((path: string) => `asset://${path}`));

vi.mock('../lib/tauri', () => ({
  fileSrc: fileSrcMock,
  api: { listItems: vi.fn(), counts: vi.fn() },
  on: vi.fn(),
}));

describe('SourceIcon', () => {
  it('renders a fallback glyph when no source is available', () => {
    const markup = renderToStaticMarkup(<SourceIcon source={null} />);
    expect(markup).toContain('source-icon-fallback');
    expect(markup).toContain('<svg');
    expect(markup).not.toContain('<img');
  });

  it('renders a fallback glyph when the source has no extracted icon', () => {
    const markup = renderToStaticMarkup(
      <SourceIcon source={{ name: 'Notepad', exePath: 'C:/notepad.exe', iconPath: null }} />,
    );
    expect(markup).toContain('<svg');
    expect(markup).not.toContain('<img');
  });

  it('renders a real <img> when an icon path is present', () => {
    const markup = renderToStaticMarkup(
      <SourceIcon
        source={{ name: 'Code', exePath: 'C:/code.exe', iconPath: 'C:/cache/abc.png' }}
        withTooltip
      />,
    );
    expect(markup).toContain('source-icon');
    expect(markup).toContain('asset://C:/cache/abc.png');
    expect(markup).toContain('title="From Code"');
  });
});

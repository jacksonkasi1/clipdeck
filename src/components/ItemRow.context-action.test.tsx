// ** import types
import type { ClipItem } from '../lib/types';

// ** import lib
/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const fileSrcMock = vi.hoisted(() => vi.fn((path: string) => `asset://${path}`));

vi.mock('../lib/tauri', () => ({
  fileSrc: fileSrcMock,
  api: { listItems: vi.fn(), counts: vi.fn(), revealItem: vi.fn(), openExternalUrl: vi.fn() },
  on: vi.fn(),
}));

import { ItemRow } from './ItemRow';

function makeBase(): ClipItem {
  return {
    id: 1,
    kind: 'text',
    preview: 'hello world',
    content: 'hello world',
    hasHtml: false,
    hasRtf: false,
    image: null,
    files: [],
    fileAssets: [],
    sizeBytes: 0,
    tags: [],
    source: { name: 'Notepad', exePath: 'C:/notepad.exe', iconPath: null },
    favorite: false,
    copyCount: 1,
    device: { id: 'local', name: 'local', platform: 'windows', color: '#000' },
    syncStatus: 'local',
    firstCopiedAt: 1,
    lastCopiedAt: 1,
  };
}

describe('ItemRow context action placement', () => {
  it('omits the context action for plain text entries', () => {
    const markup = renderToStaticMarkup(
      <ItemRow item={makeBase()} selected={false} position={1} total={1} onSelect={() => undefined} />,
    );
    expect(markup).not.toContain('context-action');
  });

  it('renders an Open in browser button for link entries', () => {
    const item: ClipItem = { ...makeBase(), kind: 'link', content: 'https://example.com', preview: 'https://example.com' };
    const markup = renderToStaticMarkup(
      <ItemRow item={item} selected={false} position={1} total={1} onSelect={() => undefined} />,
    );
    expect(markup).toContain('context-action');
    expect(markup).toContain('aria-label="Open in browser"');
  });

  it('renders a Reveal in Explorer button for file entries', () => {
    const item: ClipItem = {
      ...makeBase(),
      kind: 'files',
      files: ['C:/fake/photo.png'],
      fileAssets: [
        {
          originalPath: 'C:/fake/photo.png',
          storedPath: 'C:/clipmo-data/files/abc/000-photo.png',
          sizeBytes: 12,
          isDirectory: false,
          status: 'ready',
          message: null,
          thumbPath: null,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <ItemRow item={item} selected={false} position={1} total={1} onSelect={() => undefined} />,
    );
    expect(markup).toContain('context-action');
    expect(markup).toContain('aria-label="Reveal in File Explorer"');
  });

  it('renders a Reveal in Explorer button for image entries', () => {
    const item: ClipItem = {
      ...makeBase(),
      kind: 'image',
      image: {
        path: 'C:/clipmo-data/images/1.png',
        thumbPath: 'C:/clipmo-data/thumbs/1.png',
        width: 100,
        height: 100,
      },
    };
    const markup = renderToStaticMarkup(
      <ItemRow item={item} selected={false} position={1} total={1} onSelect={() => undefined} />,
    );
    expect(markup).toContain('context-action');
    expect(markup).toContain('aria-label="Reveal in File Explorer"');
  });
});

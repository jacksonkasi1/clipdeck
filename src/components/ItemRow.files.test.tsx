// ** import types
import type { ClipItem } from '../lib/types';

// ** import lib
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ItemRow } from './ItemRow';

const FILE_ITEM: ClipItem = {
  id: 42,
  kind: 'files',
  preview: 'OG_images.png',
  content: 'C:/fake/OG_images.png',
  hasHtml: false,
  hasRtf: false,
  image: null,
  files: ['C:/fake/OG_images.png'],
  fileAssets: [
    {
      originalPath: 'C:/fake/OG_images.png',
      storedPath: null,
      sizeBytes: 0,
      isDirectory: false,
      status: 'pending',
      message: null,
    },
  ],
  sizeBytes: 0,
  tags: [],
  source: { name: 'Explorer', exePath: 'C:/Windows/explorer.exe', iconPath: null },
  favorite: false,
  copyCount: 1,
  device: { id: 'local', name: 'local', platform: 'windows', color: '#000' },
  syncStatus: 'local',
  firstCopiedAt: 100,
  lastCopiedAt: 100,
};

const LINK_ITEM: ClipItem = { ...FILE_ITEM, id: 43, kind: 'link', preview: 'https://example.com', content: 'https://example.com' };
const EMAIL_ITEM: ClipItem = { ...FILE_ITEM, id: 44, kind: 'email', preview: 'a@b.com', content: 'a@b.com' };
const COLOR_ITEM: ClipItem = { ...FILE_ITEM, id: 45, kind: 'color', preview: '#39b9e8', content: '#39b9e8' };
const TEXT_ITEM: ClipItem = { ...FILE_ITEM, id: 46, kind: 'text', preview: 'hello', content: 'hello' };

describe('ItemRow quick-view rendering across clipboard kinds', () => {
  it('renders the file kind row identically in quick mode and full mode', () => {
    const quick = renderToStaticMarkup(
      <ItemRow item={FILE_ITEM} selected position={1} total={1} mode="quick" onSelect={() => undefined} />,
    );
    const full = renderToStaticMarkup(
      <ItemRow item={FILE_ITEM} selected position={1} total={1} mode="full" onSelect={() => undefined} />,
    );

    // The file row is shown — not hidden, not stubbed out, no error markup.
    expect(quick).toContain('OG_images.png');
    expect(quick).toContain('item-kind-files');
    expect(full).toContain('OG_images.png');
    expect(full).toContain('item-kind-files');
  });

  it('renders every clipboard kind without conditional hiding', () => {
    const items = [FILE_ITEM, LINK_ITEM, EMAIL_ITEM, COLOR_ITEM, TEXT_ITEM];
    for (const item of items) {
      const markup = renderToStaticMarkup(
        <ItemRow item={item} selected={false} position={1} total={1} mode="quick" onSelect={() => undefined} />,
      );
      // The preview text is the primary identifier in the list — every kind
      // must surface it so the user can recognise the entry.
      expect(markup).toContain(item.preview);
      expect(markup).toContain(`item-kind-${item.kind}`);
    }
  });

  it('keeps the file kind identifiable while the asset snapshot is still pending', () => {
    const markup = renderToStaticMarkup(
      <ItemRow item={FILE_ITEM} selected position={1} total={1} mode="quick" onSelect={() => undefined} />,
    );

    // The row carries its preview (file name) and a kind-typed class, so a
    // second `clip-updated` that flips the asset from pending to ready
    // can re-render the same row without any special-case code path.
    expect(markup).toContain('row-title');
    expect(markup).toContain('OG_images.png');
    expect(markup).not.toContain('item-row-hidden');
    expect(markup).not.toContain('files-disabled');
  });
});

/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import { KindIcon } from './KindIcon';
import type { ClipItem } from '../lib/types';

const fileSrcMock = vi.hoisted(() => vi.fn((path: string) => `asset://${path}`));

vi.mock('../lib/tauri', () => ({
  fileSrc: fileSrcMock,
  api: {
    listItems: vi.fn(),
    counts: vi.fn(),
  },
  on: vi.fn(),
}));

function makeImageItem(thumbPath: string | null, id = 1): ClipItem {
  return {
    id,
    kind: 'image',
    preview: 'Image',
    content: '',
    hasHtml: false,
    hasRtf: false,
    image: thumbPath
      ? {
        path: `C:/clipmo-data/images/${id}.png`,
        thumbPath,
        width: 320,
        height: 240,
      }
      : null,
    files: [],
    fileAssets: [],
    sizeBytes: 0,
    tags: [],
    source: null,
    favorite: false,
    copyCount: 1,
    device: { id: 'local', name: 'local', platform: 'windows', color: '#000' },
    syncStatus: 'local',
    firstCopiedAt: 100,
    lastCopiedAt: 100,
  };
}

function makeFileItem(thumbPath: string | null, id = 1): ClipItem {
  return {
    id,
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
        storedPath: 'C:/clipmo-data/files/abc/000-OG_images.png',
        sizeBytes: 12_345,
        isDirectory: false,
        status: 'ready',
        message: null,
        thumbPath,
      },
    ],
    sizeBytes: 12_345,
    tags: [],
    source: { name: 'Explorer', exePath: 'C:/Windows/explorer.exe', iconPath: null },
    favorite: false,
    copyCount: 1,
    device: { id: 'local', name: 'local', platform: 'windows', color: '#000' },
    syncStatus: 'local',
    firstCopiedAt: 100,
    lastCopiedAt: 100,
  };
}

describe('KindIcon thumbnail behaviour', () => {
  it('renders a real <img> for an image kind with a thumb path', () => {
    const { container } = render(<KindIcon item={makeImageItem('C:/clipmo-data/thumbs/1.png')} />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.tagName).toBe('IMG');
    expect(img.src).toContain('asset://');
  });

  it('falls back to a generic file-image icon when the thumbnail fails to load', () => {
    const { container } = render(<KindIcon item={makeImageItem('C:/clipmo-data/thumbs/missing.png')} />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.src).toContain('missing.png');
    fireEvent.error(img);
    // After the error, the component re-renders without the <img> element.
    expect(container.querySelector('img')).toBeNull();
    // The fallback uses a FileImage icon (lucide renders an <svg>).
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders a real thumbnail for a file-kind item whose stored asset is an image', () => {
    const { container } = render(
      <KindIcon item={makeFileItem('C:/clipmo-data/thumbs/abc.png')} />,
    );
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.src).toContain('asset://');
    expect(img.src).toContain('thumbs/abc.png');
  });

  it('falls back to the files icon when the file-kind thumbnail fails to load', () => {
    const { container } = render(
      <KindIcon item={makeFileItem('C:/clipmo-data/thumbs/missing.png')} />,
    );
    const img = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('uses the lucide files icon when the file kind has no thumb path at all', () => {
    const { container } = render(<KindIcon item={makeFileItem(null)} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('uses the lucide file-image icon when the image kind has no thumb path at all', () => {
    const { container } = render(<KindIcon item={makeImageItem(null)} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

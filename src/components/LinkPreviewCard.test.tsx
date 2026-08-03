/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

import { LinkPreviewCard } from './LinkPreviewCard';
import type { ClipItem, LinkPreview } from '../lib/types';

const apiMock = vi.hoisted(() => ({
  fetchLinkPreview: vi.fn(),
  openExternalUrl: vi.fn(),
  revealItem: vi.fn(),
  listItems: vi.fn(),
  counts: vi.fn(),
}));

vi.mock('../lib/tauri', () => ({
  api: apiMock,
  fileSrc: (path: string) => `asset://${path}`,
  on: vi.fn(),
}));

function makeLinkItem(): ClipItem {
  return {
    id: 1,
    kind: 'link',
    preview: 'https://example.com/article',
    content: 'https://example.com/article',
    hasHtml: false,
    hasRtf: false,
    image: null,
    files: [],
    fileAssets: [],
    sizeBytes: 0,
    tags: [],
    source: null,
    favorite: false,
    copyCount: 1,
    device: { id: 'local', name: 'This device', platform: 'windows', color: '#28b7e8' },
    syncStatus: 'local',
    firstCopiedAt: 100,
    lastCopiedAt: 100,
  };
}

const richPreview: LinkPreview = {
  title: 'A nice article',
  description: 'Summary of the article content goes here.',
  siteName: 'Example',
  faviconPath: 'C:/clipmo-data/link-previews/favicon-abc.png',
  imagePath: 'C:/clipmo-data/link-previews/image-xyz.png',
  fetchedAt: 1,
};

beforeEach(() => {
  apiMock.fetchLinkPreview.mockReset();
  apiMock.fetchLinkPreview.mockResolvedValue(richPreview);
});

afterEach(cleanup);

describe('LinkPreviewCard', () => {
  it('renders the rich card with title, description, and asset image when metadata is available', async () => {
    const { container, getByText } = render(<LinkPreviewCard item={makeLinkItem()} />);
    await waitFor(() => expect(container.querySelector('.link-card--rich')).not.toBeNull());
    expect(getByText('A nice article')).not.toBeNull();
    expect(getByText('Summary of the article content goes here.')).not.toBeNull();
    expect(container.querySelector('.link-card-image')).not.toBeNull();
    expect(container.querySelector('.link-card-favicon')).not.toBeNull();
  });

  it('falls back to a minimal link card when the page publishes no metadata', async () => {
    apiMock.fetchLinkPreview.mockResolvedValueOnce({
      ...richPreview,
      title: null,
      description: null,
      siteName: null,
      faviconPath: null,
      imagePath: null,
    });
    const { container } = render(<LinkPreviewCard item={makeLinkItem()} />);
    await waitFor(() => expect(container.querySelector('.link-card--minimal')).not.toBeNull());
    expect(container.querySelector('.link-card--rich')).toBeNull();
  });

  it('falls back to a minimal link card when the fetch fails entirely', async () => {
    apiMock.fetchLinkPreview.mockResolvedValueOnce(null);
    const { container } = render(<LinkPreviewCard item={makeLinkItem()} />);
    await waitFor(() => expect(container.querySelector('.link-card--minimal')).not.toBeNull());
  });

  it('does not call the native command for a non-URL clipboard value', () => {
    const item = makeLinkItem();
    item.content = 'hello world';
    item.preview = 'hello world';
    apiMock.fetchLinkPreview.mockClear();
    const { container } = render(<LinkPreviewCard item={item} />);
    expect(apiMock.fetchLinkPreview).not.toHaveBeenCalled();
    expect(container.querySelector('.link-card--minimal')).not.toBeNull();
  });
});

/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

const fileSrcMock = vi.hoisted(() => vi.fn((path: string) => `asset://${path}`));

vi.mock('../lib/tauri', () => ({
  fileSrc: fileSrcMock,
  api: { listItems: vi.fn(), counts: vi.fn() },
  on: vi.fn(),
}));

import { SafeAssetImage, SafeImage } from './SafeImage';

afterEach(cleanup);

describe('SafeImage', () => {
  it('renders a real <img> when the source is reachable', () => {
    const { container } = render(
      <SafeImage
        src="https://example.test/image.png"
        alt="Example"
        fallback={<span data-testid="fallback-ok">missing</span>}
      />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('alt')).toBe('Example');
  });

  it('swaps to the fallback node when the <img> errors out', () => {
    const { container, getByTestId } = render(
      <SafeImage
        src="https://example.test/missing.png"
        alt="Missing"
        fallback={<span data-testid="fallback-after-error">missing</span>}
      />,
    );
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    fireEvent.error(img);
    // After the error, the <img> is gone and the fallback takes over.
    expect(container.querySelector('img')).toBeNull();
    expect(getByTestId('fallback-after-error')).not.toBeNull();
  });
});

describe('SafeAssetImage', () => {
  it('renders the fallback immediately when the path is empty', () => {
    const { container, getByTestId } = render(
      <SafeAssetImage
        path={null}
        alt="Nothing"
        fallback={<span data-testid="fallback-empty">empty</span>}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(getByTestId('fallback-empty')).not.toBeNull();
  });

  it('falls back when the asset protocol rejects the path', () => {
    const { container, getByTestId } = render(
      <SafeAssetImage
        path="C:/missing/file.png"
        alt="Gone"
        fallback={<span data-testid="fallback-rejected">unreachable</span>}
      />,
    );
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(getByTestId('fallback-rejected')).not.toBeNull();
  });
});

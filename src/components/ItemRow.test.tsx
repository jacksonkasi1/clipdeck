// ** import types
import type { ClipItem } from '../lib/types';

// ** import lib
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ItemRow } from './ItemRow';

const COLOR_ITEM: ClipItem = {
  id: 7,
  kind: 'color',
  preview: '#39b9e8',
  content: '#39b9e8',
  hasHtml: false,
  hasRtf: false,
  image: null,
  files: [],
  fileAssets: [],
  sizeBytes: 7,
  tags: [],
  source: null,
  favorite: false,
  copyCount: 1,
  device: {
    id: 'local',
    name: 'This device',
    platform: 'windows',
    color: '#28b7e8',
  },
  syncStatus: 'local',
  firstCopiedAt: 1,
  lastCopiedAt: 1,
};

describe('ItemRow', () => {
  it('keeps color row and swatch selectors in separate namespaces', () => {
    const markup = renderToStaticMarkup(
      <ItemRow
        item={COLOR_ITEM}
        selected
        position={1}
        total={1}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain('class="item-row selected item-kind-color"');
    expect(markup).toContain('class="kind-color"');
    expect(markup).not.toContain('class="item-row selected kind-color"');
    expect(markup).toContain('class="row-select-check is-checked"');
    expect(markup).toContain('aria-pressed="true"');
  });
});

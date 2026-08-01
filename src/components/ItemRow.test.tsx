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
  });

  it('renders no selection checkbox, so selection is background-only', () => {
    const markup = renderToStaticMarkup(
      <ItemRow
        item={COLOR_ITEM}
        selected
        multiSelected
        position={1}
        total={1}
        onSelect={() => undefined}
      />,
    );

    // The checkbox markup is removed outright rather than hidden with CSS, so
    // the row grid has no dead column and the list cannot regress into a
    // checkbox selection mode.
    expect(markup).not.toContain('row-select-check');
    expect(markup).not.toContain('to selection');
    // Selection stays exposed to assistive technology via aria-selected.
    expect(markup).toContain('aria-selected="true"');
    // The row has exactly one control left: the favourite toggle.
    expect(markup.match(/<button/g)).toHaveLength(1);
  });

  it('keeps scan-only information in the list and leaves detail to the pane', () => {
    const busy: ClipItem = {
      ...COLOR_ITEM,
      copyCount: 4,
      syncStatus: 'synced',
      source: { name: 'Visual Studio Code', exePath: 'C:/vscode/code.exe', iconPath: null },
    };
    const markup = renderToStaticMarkup(
      <ItemRow item={busy} selected={false} position={1} total={1} onSelect={() => undefined} />,
    );

    // One quiet source label survives; the repeated metadata does not.
    expect(markup).toContain('Visual Studio Code');
    expect(markup).not.toContain('Copied');
    expect(markup).not.toContain('device-badge');
    expect(markup).not.toContain('This device');
  });

  it('drops the subtitle entirely in the quick flyout so rows stay single-line', () => {
    const markup = renderToStaticMarkup(
      <ItemRow
        item={{ ...COLOR_ITEM, source: { name: 'Notepad', exePath: 'C:/notepad.exe', iconPath: null } }}
        selected={false}
        mode="quick"
        position={1}
        total={1}
        onSelect={() => undefined}
      />,
    );

    expect(markup).not.toContain('row-subtitle');
    expect(markup).not.toContain('Notepad');
    expect(markup).toContain('row-title');
  });

  it('compresses cross-device state to a single dot instead of a badge', () => {
    const pending = renderToStaticMarkup(
      <ItemRow
        item={{ ...COLOR_ITEM, syncStatus: 'pending' }}
        selected={false}
        position={1}
        total={1}
        onSelect={() => undefined}
      />,
    );
    const local = renderToStaticMarkup(
      <ItemRow item={COLOR_ITEM} selected={false} position={1} total={1} onSelect={() => undefined} />,
    );

    expect(pending).toContain('row-signal is-pending');
    expect(pending).not.toContain('device-badge');
    // A purely local item shows no signal at all.
    expect(local).not.toContain('row-signal');
  });

  it('marks the keyboard-active row without an accent focus ring', () => {
    const markup = renderToStaticMarkup(
      <ItemRow
        item={COLOR_ITEM}
        selected
        focused
        position={1}
        total={1}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain('is-focused');
  });
});

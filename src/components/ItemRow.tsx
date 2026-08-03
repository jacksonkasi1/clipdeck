// ** import types
import type { ClipItem } from '../lib/types';
import type { MouseEvent } from 'react';
import type { WindowMode } from '../lib/window-mode';

// ** import lib
import { ExternalLink, FolderOpen, Star } from 'lucide-react';

import { KindIcon } from './KindIcon';
import { IconButton } from './IconButton';
import { SourceIcon } from './SourceIcon';
import { useStore } from '../lib/store';
import { api } from '../lib/tauri';
import { normaliseUrl, tryParseScheme } from '../lib/url';
import { toast } from '../lib/toast';

interface Props {
  item: ClipItem;
  selected: boolean;
  /** True when the row is part of a multi-selection (highlighted but not the primary row). */
  multiSelected?: boolean;
  /** True when the list has keyboard focus and this row is the active one. */
  focused?: boolean;
  /** Quick rows are single-line; the full application affords one subtitle. */
  mode?: WindowMode;
  position: number;
  total: number;
  onSelect: (event: MouseEvent<HTMLDivElement>) => void;
}

export function ItemRow({
  item,
  selected,
  multiSelected = false,
  focused = false,
  mode = 'full',
  position,
  total,
  onSelect,
}: Props) {
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  // The left list is for scanning, so it carries the smallest amount of
  // information that still identifies a row. Everything the list used to
  // repeat — device name, sync wording, "Copied N times" — now lives only in
  // the details pane, which is where a user goes to inspect an entry.
  const remote = item.syncStatus !== 'local' && item.syncStatus !== 'synced';
  const contextAction = describeContextAction(item);

  return (
    <div
      role="option"
      id={`clip-item-${item.id}`}
      aria-selected={selected || multiSelected}
      aria-posinset={position}
      aria-setsize={total}
      className={[
        'item-row',
        selected ? 'selected' : '',
        multiSelected ? 'is-multi-selected' : '',
        focused ? 'is-focused' : '',
        `item-kind-${item.kind}`,
        contextAction ? 'has-context-action' : '',
      ].filter(Boolean).join(' ')}
      title="Double-click to paste"
      onClick={onSelect}
      onDoubleClick={() => {
        void import('../lib/tauri').then((m) => m.api.pasteActive(item.id, 'original'));
      }}
    >
      <span className="kind-icon">
        <KindIcon item={item} />
      </span>
      <div className="row-content">
        <div className="row-title" title={item.preview}>
          {item.preview || '(empty)'}
        </div>
        {/* One quiet source label, and only where there is room for it. The
            flyout stays single-line so more rows fit on screen. */}
        {mode === 'full' && (
          <div className="row-subtitle">
            <SourceIcon source={item.source} withTooltip size={12} />
            <span>{item.source?.name ?? kindLabel(item.kind)}</span>
          </div>
        )}
      </div>
      <div className="row-trailing">
        {/* Cross-device state is a single dot, not a badge with text and icons. */}
        {remote && (
          <span
            className={`row-signal is-${item.syncStatus}`}
            title={`${item.device.name} · ${item.syncStatus}`}
            aria-label={`${item.device.name}, ${item.syncStatus}`}
            role="img"
          />
        )}
        {contextAction && (
          <IconButton
            label={contextAction.label}
            className="context-action"
            onClick={(e) => {
              e.stopPropagation();
              void contextAction.run();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {contextAction.icon}
          </IconButton>
        )}
        <IconButton
          label={item.favorite ? 'Remove from favorites' : 'Add to favorites'}
          active={item.favorite}
          className="favorite-button"
          onClick={(e) => {
            e.stopPropagation();
            void toggleFavorite(item.id);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <Star size={15} fill={item.favorite ? 'currentColor' : 'none'} aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

function kindLabel(kind: ClipItem['kind']): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

interface ContextAction {
  label: string;
  icon: React.ReactNode;
  run: () => Promise<void> | void;
}

function describeContextAction(item: ClipItem): ContextAction | null {
  if (item.kind === 'link' || item.kind === 'email') {
    const raw = item.kind === 'email' ? `mailto:${item.content || item.preview}` : (item.content || item.preview);
    return {
      label: 'Open in browser',
      icon: <ExternalLink size={14} aria-hidden />,
      run: () => openExternalLink(raw),
    };
  }
  if (item.kind === 'files') {
    const target = item.fileAssets[0]?.storedPath
      ?? item.fileAssets[0]?.originalPath
      ?? item.files[0];
    if (!target) return null;
    return {
      label: 'Reveal in File Explorer',
      icon: <FolderOpen size={14} aria-hidden />,
      run: () => api.revealItem(target),
    };
  }
  if (item.kind === 'image' && item.image?.path) {
    return {
      label: 'Reveal in File Explorer',
      icon: <FolderOpen size={14} aria-hidden />,
      run: () => api.revealItem(item.image!.path),
    };
  }
  return null;
}

async function openExternalLink(raw: string): Promise<void> {
  const scheme = tryParseScheme(raw);
  if (!scheme) {
    toast('That link is not a URL Clipmo can open.', 'error');
    return;
  }
  try {
    await api.openExternalUrl(normaliseUrl(raw));
  } catch (error: unknown) {
    toast(`The default browser could not be opened: ${String(error)}`, 'error');
  }
}

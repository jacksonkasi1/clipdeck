// ** import types
import type { ClipItem } from '../lib/types';

// ** import lib
import { Star } from 'lucide-react';

import { KindIcon } from './KindIcon';
import { IconButton } from './IconButton';
import { useStore } from '../lib/store';

interface Props {
  item: ClipItem;
  selected: boolean;
  position: number;
  total: number;
  onSelect: () => void;
}

export function ItemRow({ item, selected, position, total, onSelect }: Props) {
  const toggleFavorite = useStore((s) => s.toggleFavorite);

  return (
    <div
      role="option"
      id={`clip-item-${item.id}`}
      aria-selected={selected}
      aria-posinset={position}
      aria-setsize={total}
      className={`item-row ${selected ? 'selected' : ''} item-kind-${item.kind}`}
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
        <div className="row-subtitle">
          <span>{item.source?.name ?? kindLabel(item.kind)}</span>
          {item.copyCount > 1 && <span>Copied {item.copyCount} times</span>}
        </div>
      </div>
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
        <Star size={17} fill={item.favorite ? 'currentColor' : 'none'} aria-hidden />
      </IconButton>
    </div>
  );
}

function kindLabel(kind: ClipItem['kind']): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

import { useStore } from '../lib/store';
import { fileSrc } from '../lib/tauri';
import type { ClipItem } from '../lib/types';

interface Props {
  item: ClipItem;
  selected: boolean;
  onSelect: () => void;
}

export function ItemRow({ item, selected, onSelect }: Props) {
  const toggleFavorite = useStore((s) => s.toggleFavorite);

  return (
    <div
      role="option"
      aria-selected={selected}
      className={`item-row ${selected ? 'selected' : ''} kind-${item.kind.toLowerCase()}`}
      onMouseDown={(e) => {
        // Prevent the row click from stealing focus from the search box.
        e.preventDefault();
        onSelect();
      }}
      onDoubleClick={() => {
        void import('../lib/tauri').then((m) => m.api.pasteActive(item.id, 'Original'));
      }}
    >
      <span className={`kind-icon kind-icon-${item.kind.toLowerCase()}`}>
        <KindIcon kind={item.kind} preview={item.preview} image={item.image?.thumbPath ?? null} />
      </span>
      <div className="row-content">
        <div className="row-preview" title={item.preview}>
          {item.preview || '(empty)'}
        </div>
        <div className="row-meta">
          {item.source?.name ?? 'Unknown source'}
          {item.copyCount > 1 && <span className="row-meta-sep"> · ×{item.copyCount}</span>}
        </div>
      </div>
      <button
        type="button"
        aria-label={item.favorite ? 'Unfavorite' : 'Favorite'}
        className={`favorite-button ${item.favorite ? 'active' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          void toggleFavorite(item.id);
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden focusable="false">
          <path
            d="M8 1.5l1.94 4.36 4.78.42-3.61 3.16 1.06 4.6L8 11.7 3.83 14.04l1.06-4.6L1.28 6.28l4.78-.42L8 1.5Z"
            fill={item.favorite ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

function KindIcon({
  kind,
  preview,
  image,
}: {
  kind: ClipItem['kind'];
  preview: string;
  image: string | null;
}) {
  if (kind === 'Image' && image) {
    return <img src={fileSrc(image)} alt="" className="kind-thumb" />;
  }
  if (kind === 'Color') {
    const hex = preview.trim();
    return <span className="color-swatch" style={{ background: hex }} aria-hidden />;
  }
  return (
    <span aria-hidden>
      {kind === 'Link'
        ? '↗'
        : kind === 'Email'
          ? '@'
          : kind === 'Files'
            ? '📁'
            : '¶'}
    </span>
  );
}

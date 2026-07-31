import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { useStore } from '../lib/store';
import { ItemRow } from './ItemRow';

export function ItemList() {
  const items = useStore((s) => s.items);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 8,
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (items.length === 0) return;
    const idx = items.findIndex((i) => i.id === selectedId);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[Math.min(idx + 1, items.length - 1)];
      if (next) select(next.id);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = items[Math.max(idx - 1, 0)];
      if (prev) select(prev.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedId) {
        void import('../lib/tauri').then((m) => m.api.pasteActive(selectedId, 'Original'));
      }
    }
  };

  return (
    <div
      ref={parentRef}
      className="item-list"
      role="listbox"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Clipboard entries"
    >
      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const item = items[row.index];
            if (!item) return null;
            return (
              <div
                key={item.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <ItemRow
                  item={item}
                  selected={item.id === selectedId}
                  onSelect={() => select(item.id)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <p>Your clipboard history will appear here.</p>
      <p className="empty-state-hint">
        Copy text, images, or files anywhere — they'll show up instantly.
      </p>
    </div>
  );
}

// ** import lib
import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Clipboard, SearchX } from 'lucide-react';

import { useStore } from '../lib/store';
import { getShortcutLabel } from '../lib/platform';
import { getListKeyboardAction } from '../lib/list-navigation';
import { api } from '../lib/tauri';
import { ItemRow } from './ItemRow';

export function ItemList() {
  const items = useStore((s) => s.items);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const search = useStore((s) => s.search);
  const loading = useStore((s) => s.loading);
  const loadingMore = useStore((s) => s.loadingMore);
  const hasMore = useStore((s) => s.hasMore);
  const loadMore = useStore((s) => s.loadMore);
  const pasteOnEnter = useStore((s) => s.settings?.pasteOnEnter ?? true);

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
    overscan: 8,
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const selectedIndex = items.findIndex((item) => item.id === selectedId);
    const action = getListKeyboardAction(e.key, selectedIndex, items.length, pasteOnEnter);
    if (!action) return;
    e.preventDefault();

    if (action.type === 'select') {
      const next = items[action.index];
      if (next) select(next.id);
      return;
    }
    if (selectedId === null) return;
    if (action.type === 'paste') void api.pasteActive(selectedId, 'original');
    else void api.copyToClipboard(selectedId, 'original');
  };

  useEffect(() => {
    const index = items.findIndex((item) => item.id === selectedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [items, selectedId, virtualizer]);

  useEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement || !hasMore) return;
    const loadNearEnd = () => {
      const remaining = scrollElement.scrollHeight
        - scrollElement.scrollTop
        - scrollElement.clientHeight;
      if (remaining <= 600) {
        void loadMore().catch((error: unknown) => {
          console.error('Failed to load more clipboard history', error);
        });
      }
    };
    scrollElement.addEventListener('scroll', loadNearEnd, { passive: true });
    loadNearEnd();
    return () => scrollElement.removeEventListener('scroll', loadNearEnd);
  }, [hasMore, items.length, loadMore, loadingMore]);

  return (
    <div
      ref={parentRef}
      className="item-list"
      role="listbox"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Clipboard entries"
      aria-busy={loading || loadingMore}
      aria-activedescendant={selectedId !== null ? `clip-item-${selectedId}` : undefined}
    >
      {items.length === 0 ? (
        <EmptyState search={search} />
      ) : (
        <div
          role="presentation"
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
                role="presentation"
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
                  position={row.index + 1}
                  total={hasMore ? -1 : items.length}
                  onSelect={() => {
                    select(item.id);
                    parentRef.current?.focus({ preventScroll: true });
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
      {loadingMore && (
        <span className="sr-only" role="status" aria-live="polite">
          Loading more clipboard history
        </span>
      )}
    </div>
  );
}

function EmptyState({ search }: { search: string }) {
  const setSearch = useStore((s) => s.setSearch);

  if (search) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon"><SearchX size={24} aria-hidden /></span>
        <strong>No matches for “{search}”</strong>
        <span>Try another phrase or clear your search.</span>
        <button type="button" className="text-button" onClick={() => void setSearch('')}>
          Clear search
        </button>
      </div>
    );
  }

  return (
    <div className="empty-state">
      <span className="empty-state-icon"><Clipboard size={25} aria-hidden /></span>
      <strong>Your clipboard history is empty</strong>
      <span>Copy text, images, or files and they’ll appear here instantly.</span>
      <kbd>{getShortcutLabel('open')}</kbd>
    </div>
  );
}

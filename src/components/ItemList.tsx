// ** import lib
import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Clipboard, SearchX } from 'lucide-react';

import { useStore } from '../lib/store';
import { getShortcutLabel } from '../lib/platform';
import { ItemRow } from './ItemRow';

export function ItemList() {
  const items = useStore((s) => s.items);
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectOnly = useStore((s) => s.selectOnly);
  const selectToggle = useStore((s) => s.selectToggle);
  const selectRange = useStore((s) => s.selectRange);
  const search = useStore((s) => s.search);
  const loading = useStore((s) => s.loading);
  const loadingMore = useStore((s) => s.loadingMore);
  const hasMore = useStore((s) => s.hasMore);
  const loadMore = useStore((s) => s.loadMore);
  const parentRef = useRef<HTMLDivElement>(null);
  // Tracks whether the list owns keyboard focus so the active row can show a
  // slightly stronger neutral fill. This replaces the old accent focus ring,
  // which drew a blue rectangle around the entire scrolling container.
  const [listFocused, setListFocused] = useState(false);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
    overscan: 8,
  });

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

  const selectedSet = new Set(selectedIds);

  return (
    <div
      ref={parentRef}
      className={`item-list ${selectedIds.length > 1 ? 'is-multiselect' : ''}`}
      role="listbox"
      tabIndex={0}
      aria-label="Clipboard entries"
      aria-multiselectable="true"
      aria-busy={loading || loadingMore}
      aria-activedescendant={selectedId !== null ? `clip-item-${selectedId}` : undefined}
      onFocus={() => setListFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setListFocused(false);
        }
      }}
      onKeyDown={(event) => {
        // Ctrl+Space toggles the active row without a mouse, replacing the
        // per-row checkbox that used to provide keyboard multi-select.
        if (event.key === ' ' && (event.ctrlKey || event.metaKey) && selectedId !== null) {
          event.preventDefault();
          selectToggle(selectedId);
        }
      }}
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
                  multiSelected={selectedIds.length > 1 && selectedSet.has(item.id)}
                  focused={listFocused && item.id === selectedId}
                  position={row.index + 1}
                  total={hasMore ? -1 : items.length}
                  onSelect={(event) => {
                    if (event.shiftKey) selectRange(item.id);
                    else if (event.ctrlKey || event.metaKey) selectToggle(item.id);
                    else selectOnly(item.id);
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

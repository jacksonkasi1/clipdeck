import { useEffect, useRef } from 'react';

import { useStore } from '../lib/store';

export function SearchBar() {
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const refresh = useStore((s) => s.refresh);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void import('../lib/tauri').then((m) => m.api.hideWindow());
      }
      if (e.key === 'F5') {
        e.preventDefault();
        void refresh();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [refresh]);

  return (
    <div className="search-bar">
      <svg viewBox="0 0 16 16" aria-hidden focusable="false" className="icon-search">
        <path
          d="M10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Zm-.85 3.85a5 5 0 1 1 1.06-1.06l3.6 3.6a.75.75 0 1 1-1.06 1.06l-3.6-3.6Z"
          fill="currentColor"
        />
      </svg>
      <input
        ref={ref}
        type="text"
        placeholder="Type to search…"
        value={search}
        onChange={(e) => void setSearch(e.target.value)}
        aria-label="Search clipboard history"
      />
      {search && (
        <button
          type="button"
          aria-label="Clear search"
          className="icon-button"
          onClick={() => void setSearch('')}
        >
          <svg viewBox="0 0 16 16" aria-hidden focusable="false">
            <path
              d="M4.22 4.22a.75.75 0 0 1 1.06 0L8 6.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L9.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L8 9.06l-2.72 2.72a.75.75 0 0 1-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 0 1 0-1.06Z"
              fill="currentColor"
            />
          </svg>
        </button>
      )}
      <button
        type="button"
        aria-label="Pin window"
        className="icon-button"
        title="Pin window"
      >
        <svg viewBox="0 0 16 16" aria-hidden focusable="false">
          <path
            d="M9.71 2.29a1 1 0 0 0-1.42 0l-1 1A1 1 0 0 0 7 4v.59L4.7 6.88a1 1 0 0 0 0 1.41l.3.3L2.29 11.4a1 1 0 0 0 1.42 1.41l2.71-2.7.3.29a1 1 0 0 0 1.4 0L10 8.41H10.59a1 1 0 0 0 .71-.29l1-1a1 1 0 0 0 0-1.42l-1.3-1.29a3 3 0 0 0-1.29-2.12Z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  );
}

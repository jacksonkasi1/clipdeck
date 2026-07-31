// ** import lib
import { useEffect, useRef, useState } from 'react';
import {
  Command,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  Search,
  Settings2,
  SquareTerminal,
  X,
} from 'lucide-react';

import { IconButton } from './IconButton';
import { useStore } from '../lib/store';
import { api } from '../lib/tauri';
import { getPlatform, getShortcutLabel } from '../lib/platform';

export function SearchBar() {
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const refresh = useStore((s) => s.refresh);
  const visibleCount = useStore((s) => s.items.length);
  const hasMore = useStore((s) => s.hasMore);
  const showPreview = useStore((s) => s.showPreview);
  const showCommands = useStore((s) => s.showCommands);
  const setShowPreview = useStore((s) => s.setShowPreview);
  const setShowCommands = useStore((s) => s.setShowCommands);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.defaultPrevented || target?.matches('textarea, [contenteditable="true"]')) return;
      if (e.key === 'Escape') {
        if (showCommands) return;
        if (search) {
          e.preventDefault();
          void setSearch('');
        } else {
          void api.hideWindow();
        }
      }
      if (e.key === 'F5') {
        e.preventDefault();
        void refresh();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [refresh, search, setSearch, showCommands]);

  useEffect(() => {
    const focusSearch = () => {
      ref.current?.focus();
      ref.current?.select();
    };
    window.addEventListener('clipdeck:focus-search', focusSearch);
    return () => window.removeEventListener('clipdeck:focus-search', focusSearch);
  }, []);

  return (
    <header className="search-header">
      <div className="search-field">
        <Search size={19} strokeWidth={1.8} aria-hidden />
        <input
          ref={ref}
          type="search"
          placeholder="Type to search…"
          value={search}
          onChange={(e) => void setSearch(e.target.value)}
          aria-label="Search clipboard history"
          aria-describedby="search-results-status"
          autoComplete="off"
          spellCheck={false}
        />
        <span id="search-results-status" className="sr-only" aria-live="polite">
          {search
            ? `${hasMore ? 'At least ' : ''}${visibleCount} search ${visibleCount === 1 ? 'result' : 'results'}`
            : `${hasMore ? 'At least ' : ''}${visibleCount} clipboard ${visibleCount === 1 ? 'item' : 'items'} visible`}
        </span>
      </div>
      {search && (
        <IconButton label="Clear search" onClick={() => void setSearch('')}>
          <X size={17} aria-hidden />
        </IconButton>
      )}
      <IconButton
        label={pinned ? 'Unpin window' : 'Keep window on top'}
        active={pinned}
        onClick={() => {
          const next = !pinned;
          void api.setAlwaysOnTop(next).then(setPinned);
        }}
      >
        <Pin size={18} aria-hidden />
      </IconButton>
      <IconButton
        label={showPreview ? 'Hide preview pane' : 'Show preview pane'}
        active={showPreview}
        onClick={() => setShowPreview(!showPreview)}
      >
        {showPreview ? (
          <PanelRightClose size={18} aria-hidden />
        ) : (
          <PanelRightOpen size={18} aria-hidden />
        )}
      </IconButton>
      <IconButton
        label={`Commands (${getShortcutLabel('commands')})`}
        onClick={() => setShowCommands(true)}
      >
        {getPlatform() === 'macos' ? (
          <Command size={18} aria-hidden />
        ) : (
          <SquareTerminal size={18} aria-hidden />
        )}
      </IconButton>
      <IconButton
        className="search-settings-button"
        label={`Settings (${getShortcutLabel('settings')})`}
        onClick={() => void api.openSettingsWindow()}
      >
        <Settings2 size={18} aria-hidden />
      </IconButton>
    </header>
  );
}

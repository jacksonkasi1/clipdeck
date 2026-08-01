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
import { toast } from '../lib/toast';
import { getPlatform, getShortcutLabel } from '../lib/platform';

export function SearchBar() {
  const mode = useStore((s) => s.mode);
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
        // In the flyout Escape is an unconditional dismiss. Clearing the search
        // first would leave a transient popup stranded on screen, which is not
        // how a Windows flyout behaves. The full application keeps the gentler
        // clear-then-hide behaviour.
        if (mode === 'quick') {
          e.preventDefault();
          void api.hideWindow();
          return;
        }
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
  }, [mode, refresh, search, setSearch, showCommands]);

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
        <Search size={16} strokeWidth={1.9} aria-hidden />
        <input
          ref={ref}
          type="search"
          placeholder={mode === 'quick' ? 'Search clipboard…' : 'Search content, tags, or application…'}
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
          <X size={16} aria-hidden />
        </IconButton>
      )}
      <IconButton
        label={pinLabel(mode, pinned)}
        active={pinned}
        onClick={() => {
          const next = !pinned;
          setPinned(next);
          // In quick mode pinning also suppresses native light-dismiss, so the
          // flag has to reach Rust; always-on-top alone would still let the
          // focus-lost handler hide the palette.
          const request = mode === 'quick'
            ? api.setQuickPinned(next)
            : api.setAlwaysOnTop(next);
          void request.catch((error: unknown) => {
            setPinned(!next);
            toast(`The pin state could not be changed: ${String(error)}`, 'error');
          });
        }}
      >
        <Pin size={17} aria-hidden />
      </IconButton>
      <IconButton
        label={showPreview ? 'Hide preview pane' : 'Show preview pane'}
        active={showPreview}
        onClick={() => void setShowPreview(!showPreview)}
      >
        {showPreview ? (
          <PanelRightClose size={17} aria-hidden />
        ) : (
          <PanelRightOpen size={17} aria-hidden />
        )}
      </IconButton>
      {/* The command palette and settings are application-level affordances.
          They would dominate the flyout's toolbar, so quick mode omits them and
          exposes settings through the tray and Ctrl+, instead. */}
      {mode === 'full' && (
        <>
          <IconButton
            label={`Commands (${getShortcutLabel('commands')})`}
            onClick={() => setShowCommands(true)}
          >
            {getPlatform() === 'macos' ? (
              <Command size={17} aria-hidden />
            ) : (
              <SquareTerminal size={17} aria-hidden />
            )}
          </IconButton>
          <IconButton
            className="search-settings-button"
            label={`Settings (${getShortcutLabel('settings')})`}
            onClick={() => void api.openSettingsWindow().catch((error: unknown) => {
              toast(`Settings could not be opened: ${String(error)}`, 'error');
            })}
          >
            <Settings2 size={17} aria-hidden />
          </IconButton>
        </>
      )}
    </header>
  );
}

function pinLabel(mode: 'quick' | 'full', pinned: boolean): string {
  if (mode === 'quick') {
    return pinned ? 'Unpin quick clipboard' : 'Keep quick clipboard open';
  }
  return pinned ? 'Unpin window' : 'Keep window on top';
}

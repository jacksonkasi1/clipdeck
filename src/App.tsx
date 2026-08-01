// ** import types
import type { Backdrop } from './lib/types';

// ** import lib
import { useEffect, useState } from 'react';

import { CommandPalette } from './components/CommandPalette';
import { DetailsTable } from './components/DetailsTable';
import { Footer } from './components/Footer';
import { ItemList } from './components/ItemList';
import { PreviewPane } from './components/PreviewPane';
import { SearchBar } from './components/SearchBar';
import { getListKeyboardAction } from './lib/list-navigation';
import { useStore } from './lib/store';
import { api, on } from './lib/tauri';
import { applyTheme } from './lib/theme';
import { ToastSurface } from './lib/toast';

let readinessSignaled = false;

export default function App() {
  const mode = useStore((s) => s.mode);
  const appearance = useStore((s) => s.appearance);
  const settings = useStore((s) => s.settings);
  const showPreview = useStore((s) => s.showPreview);
  const showDetails = useStore((s) => s.showDetails);
  const showCommands = useStore((s) => s.showCommands);
  const setShowCommands = useStore((s) => s.setShowCommands);
  const setShowPreview = useStore((s) => s.setShowPreview);
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const select = useStore((s) => s.select);
  const selectOnly = useStore((s) => s.selectOnly);
  const selectToggle = useStore((s) => s.selectToggle);
  const selectRange = useStore((s) => s.selectRange);
  const selectAll = useStore((s) => s.selectAll);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const deleteItem = useStore((s) => s.deleteItem);
  const deleteSelected = useStore((s) => s.deleteSelected);
  const clearHistory = useStore((s) => s.clearHistory);
  // Drives the short open transition. Reset on every quick invocation so the
  // palette animates in again instead of appearing already settled.
  const [opening, setOpening] = useState(mode === 'quick');

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  useEffect(() => {
    if (mode !== 'full' || readinessSignaled) return;
    readinessSignaled = true;
    // The native smoke test enables this handshake through an environment
    // variable. Reaching it proves that the main Tauri webview initialized,
    // initial store boot completed, and React mounted successfully.
    void api.signalFrontendReady().catch((error: unknown) => {
      readinessSignaled = false;
      console.error('Failed to signal Clipdeck frontend readiness', error);
    });
  }, [mode]);

  // The quick palette is a reused webview: it is hidden, not destroyed. Rust
  // emits `clipdeck:quick-opened` on every invocation so the palette can replay
  // its transition and put the caret back in the search field.
  useEffect(() => {
    if (mode !== 'quick') return;
    const replayOpen = () => {
      setOpening(true);
      window.requestAnimationFrame(() => setOpening(false));
      window.dispatchEvent(new CustomEvent('clipdeck:focus-search'));
    };
    replayOpen();
    const unlisten = on<void>('clipdeck:quick-opened', replayOpen);
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [mode]);

  useEffect(() => {
    applyTheme(settings?.theme ?? 'system', appearance);
    document.documentElement.dataset.backdrop = settings?.backdrop ?? 'acrylic';
  }, [settings?.theme, settings?.backdrop, appearance]);

  useEffect(() => {
    const unlisten = on<Backdrop>('clipdeck:backdrop', (effective) => {
      document.documentElement.dataset.backdrop = effective.toLowerCase();
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      const editing =
        target?.matches('input, textarea, select, [contenteditable="true"]') ?? false;

      if (showCommands && event.key === 'Escape') {
        event.preventDefault();
        setShowCommands(false);
        return;
      }
      if (modifier && key === 'k') {
        event.preventDefault();
        setShowCommands(!showCommands);
        return;
      }

      const selectedIndex = items.findIndex((item) => item.id === selectedId);
      const searchHasFocus = target?.matches('input[type="search"]') ?? false;
      const listAction = (!editing || searchHasFocus)
        ? getListKeyboardAction(
            event.key,
            selectedIndex,
            items.length,
            settings?.pasteOnEnter ?? true,
          )
        : null;
      if (listAction) {
        event.preventDefault();
        if (listAction.type === 'select') {
          const next = items[listAction.index];
          if (next) {
            if (event.shiftKey) selectRange(next.id);
            else if (modifier) selectToggle(next.id);
            else selectOnly(next.id);
          }
        } else if (selectedId !== null) {
          if (listAction.type === 'paste') {
            void api.pasteActive(selectedId, 'original');
          } else {
            void api.copyToClipboard(selectedId, 'original');
          }
        }
        return;
      }
      if (editing) return;

      if (modifier && key === 'a') {
        event.preventDefault();
        selectAll();
        return;
      }
      if (modifier && key === 'c' && selectedId && !window.getSelection()?.toString()) {
        event.preventDefault();
        const target = selectedIds.length > 1 ? selectedIds : [selectedId];
        for (const id of target) void api.copyToClipboard(id, 'original');
      } else if (modifier && key === 'e' && selectedId) {
        event.preventDefault();
        if (!showPreview) {
          void setShowPreview(true);
          window.setTimeout(() => window.dispatchEvent(new CustomEvent('clipdeck:edit-selected')), 0);
        } else {
          window.dispatchEvent(new CustomEvent('clipdeck:edit-selected'));
        }
      } else if (modifier && key === 'd' && selectedId) {
        event.preventDefault();
        const target = selectedIds.length > 1 ? selectedIds : [selectedId];
        for (const id of target) void toggleFavorite(id);
      } else if (event.key === 'Delete' && !(modifier && event.shiftKey)) {
        event.preventDefault();
        if (selectedIds.length > 1) {
          void deleteSelected();
        } else if (selectedId !== null) {
          void deleteItem(selectedId);
        }
      } else if (event.key === 'Escape' && selectedIds.length > 0) {
        event.preventDefault();
        select(null);
      } else if (modifier && key === ',') {
        event.preventDefault();
        void api.openSettingsWindow().catch((error: unknown) => {
          console.error('Settings could not be opened', error);
        });
      } else if (modifier && event.shiftKey && key === 'p') {
        event.preventDefault();
        void setShowPreview(!showPreview);
      } else if (modifier && event.shiftKey && event.key === 'Delete') {
        event.preventDefault();
        void api.confirm(
          'Clear all non-favorite history items? Favorites will stay pinned.',
          'Clear history',
        ).then((approved) => {
          if (approved) return clearHistory(false);
        }).catch((error: unknown) => {
          console.error('Failed to confirm clearing clipboard history', error);
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    clearHistory,
    deleteItem,
    deleteSelected,
    items,
    select,
    selectAll,
    selectOnly,
    selectRange,
    selectToggle,
    selectedId,
    selectedIds,
    setShowCommands,
    setShowPreview,
    settings?.pasteOnEnter,
    showCommands,
    showPreview,
    toggleFavorite,
  ]);

  const frameClasses = [
    'app-frame',
    `is-${mode}`,
    showPreview ? '' : 'preview-is-hidden',
    mode === 'quick' && opening ? 'is-opening' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={frameClasses}
      role="application"
      aria-label={
        mode === 'quick' ? 'Clipdeck quick clipboard' : 'Clipdeck clipboard history'
      }
    >
      <aside className="history-pane" aria-label="Clipboard history">
        <SearchBar />
        <ItemList />
        <Footer />
      </aside>
      {showPreview && (
        <main className="content-pane">
          <PreviewPane />
          {/* The flyout shows a preview, not a metadata table: the details grid
              belongs to the full application where there is room for it. */}
          {mode === 'full' && showDetails && <DetailsTable />}
        </main>
      )}
      {mode === 'full' && <CommandPalette />}
      <ToastSurface />
    </div>
  );
}

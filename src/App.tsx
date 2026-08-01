// ** import types
import type { Backdrop } from './lib/types';

// ** import lib
import { useEffect } from 'react';

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

export default function App() {
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

  useEffect(() => {
    applyTheme(settings?.theme ?? 'system', appearance);
    document.documentElement.dataset.backdrop = settings?.backdrop ?? 'acrylic';
  }, [settings?.theme, settings?.backdrop, appearance]);

  useEffect(() => {
    if (!settings) return;
    void api.setPreviewVisible(showPreview);
  }, [settings, showPreview]);

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
          setShowPreview(true);
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
        setShowPreview(!showPreview);
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

  return (
    <div
      className={`app-frame ${showPreview ? '' : 'preview-is-hidden'}`}
      role="application"
      aria-label="Clipdeck clipboard history"
    >
      <aside className="history-pane" aria-label="Clipboard history">
        <SearchBar />
        <ItemList />
        <Footer />
      </aside>
      {showPreview && (
        <main className="content-pane">
          <PreviewPane />
          {showDetails && <DetailsTable />}
        </main>
      )}
      <CommandPalette />
      <ToastSurface />
    </div>
  );
}

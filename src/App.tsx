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
import { useStore } from './lib/store';
import { api, on } from './lib/tauri';
import { applyTheme } from './lib/theme';

export default function App() {
  const appearance = useStore((s) => s.appearance);
  const settings = useStore((s) => s.settings);
  const showPreview = useStore((s) => s.showPreview);
  const showDetails = useStore((s) => s.showDetails);
  const showCommands = useStore((s) => s.showCommands);
  const setShowCommands = useStore((s) => s.setShowCommands);
  const setShowPreview = useStore((s) => s.setShowPreview);
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const select = useStore((s) => s.select);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const deleteItem = useStore((s) => s.deleteItem);
  const clearHistory = useStore((s) => s.clearHistory);

  useEffect(() => {
    applyTheme(settings?.theme ?? 'system', appearance);
  }, [settings?.theme, appearance]);

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
      if (editing) return;

      const selectedIndex = items.findIndex((item) => item.id === selectedId);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = items[Math.max(0, Math.min(items.length - 1, selectedIndex + delta))];
        if (next) select(next.id);
      } else if (event.key === 'Enter' && selectedId) {
        event.preventDefault();
        if (settings?.pasteOnEnter ?? true) {
          void api.pasteActive(selectedId, 'original');
        } else {
          void api.copyToClipboard(selectedId, 'original');
        }
      } else if (modifier && key === 'c' && selectedId && !window.getSelection()?.toString()) {
        event.preventDefault();
        void api.copyToClipboard(selectedId, 'original');
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
        void toggleFavorite(selectedId);
      } else if (event.key === 'Delete' && selectedId && !(modifier && event.shiftKey)) {
        event.preventDefault();
        void deleteItem(selectedId);
      } else if (modifier && key === ',') {
        event.preventDefault();
        void api.openSettingsWindow();
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
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [clearHistory, deleteItem, items, select, selectedId, setShowCommands, setShowPreview, settings?.pasteOnEnter, showCommands, showPreview, toggleFavorite]);

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
    </div>
  );
}

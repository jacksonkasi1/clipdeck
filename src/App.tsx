import { useEffect } from 'react';

import { SearchBar } from './components/SearchBar';
import { TypeTabs } from './components/TypeTabs';
import { ItemList } from './components/ItemList';
import { PreviewPane } from './components/PreviewPane';
import { DetailsTable } from './components/DetailsTable';
import { Footer } from './components/Footer';
import { useStore } from './lib/store';
import { on } from './lib/tauri';
import type { Backdrop, SystemAppearance } from './lib/types';

export default function App() {
  const appearance = useStore((s) => s.appearance);
  const settings = useStore((s) => s.settings);
  const showPreview = useStore((s) => s.showPreview);

  useEffect(() => {
    document.documentElement.dataset.theme = appearance?.dark ? 'dark' : 'light';
  }, [appearance?.dark]);

  useEffect(() => {
    if (!settings) return;
    const dark =
      settings.theme === 'Dark' ||
      (settings.theme === 'System' && (appearance?.dark ?? false));
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [settings?.theme, appearance?.dark]);

  useEffect(() => {
    const syncAppearance = (next: SystemAppearance) => {
      const accent = document.createElement('style');
      accent.textContent = `:root { --color-accent: ${next.accent}; --color-accent-hover: ${next.accent}; }`;
      document.head.appendChild(accent);
    };
    if (appearance) syncAppearance(appearance);

    const unlisten = on<Backdrop>('clipdeck:backdrop', (effective) => {
      document.documentElement.dataset.backdrop = effective.toLowerCase();
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [appearance]);

  return (
    <div className="surface" role="application" aria-label="Clipdeck clipboard history">
      <aside className="left-pane">
        <SearchBar />
        <TypeTabs />
        <ItemList />
      </aside>
      <main className="right-pane">
        <PreviewPane />
        {showPreview && <DetailsTable />}
      </main>
      <Footer />
    </div>
  );
}

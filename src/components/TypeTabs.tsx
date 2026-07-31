import { useStore } from '../lib/store';
import type { ItemKind } from '../lib/types';

interface TabDef {
  kind: ItemKind;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  { kind: 'Text', label: 'Text', icon: <Glyph>¶</Glyph> },
  { kind: 'Image', label: 'Images', icon: <Glyph>▦</Glyph> },
  { kind: 'Files', label: 'Files', icon: <Glyph>📁</Glyph> },
  { kind: 'Link', label: 'Links', icon: <Glyph>↗</Glyph> },
  { kind: 'Color', label: 'Colors', icon: <Glyph>●</Glyph> },
  { kind: 'Email', label: 'Emails', icon: <Glyph>@</Glyph> },
];

function Glyph({ children }: { children: React.ReactNode }) {
  return <span className="tab-glyph">{children}</span>;
}

export function TypeTabs() {
  const activeKinds = useStore((s) => s.activeKinds);
  const favoritesOnly = useStore((s) => s.favoritesOnly);
  const toggleKind = useStore((s) => s.toggleKind);
  const toggleFavoritesOnly = useStore((s) => s.toggleFavoritesOnly);

  return (
    <nav className="type-tabs" aria-label="Filter by type">
      <button
        type="button"
        className={`tab ${favoritesOnly ? 'active' : ''}`}
        onClick={() => void toggleFavoritesOnly()}
        aria-pressed={favoritesOnly}
        title="Favorites only"
      >
        <Glyph>★</Glyph>
        <span className="tab-label">Favorites</span>
      </button>
      {TABS.map((tab) => {
        const active = activeKinds.includes(tab.kind);
        return (
          <button
            key={tab.kind}
            type="button"
            className={`tab ${active ? 'active' : ''}`}
            onClick={() => void toggleKind(tab.kind)}
            aria-pressed={active}
            title={tab.label}
          >
            {tab.icon}
            <span className="tab-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

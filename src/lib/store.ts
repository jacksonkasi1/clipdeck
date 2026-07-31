// ** import types
import type { ClipItem, Counts, ItemKind, ListQuery, Settings, SystemAppearance } from './types';

// ** import lib
import { create } from 'zustand';

import { HISTORY_PAGE_SIZE, mergeUniquePage, pageMayHaveMore } from './paging';
import { api, on } from './tauri';

interface State {
  items: ClipItem[];
  selectedId: number | null;
  search: string;
  activeKinds: ItemKind[];
  favoritesOnly: boolean;
  counts: Counts;
  settings: Settings | null;
  appearance: SystemAppearance | null;
  showPreview: boolean;
  showDetails: boolean;
  showCommands: boolean;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  nextOffset: number;
}

interface Actions {
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  setSearch: (search: string) => Promise<void>;
  toggleKind: (kind: ItemKind) => Promise<void>;
  toggleFavoritesOnly: () => Promise<void>;
  select: (id: number | null) => void;
  toggleFavorite: (id: number) => Promise<void>;
  editItem: (id: number, content: string) => Promise<void>;
  deleteItem: (id: number) => Promise<void>;
  clearHistory: (includeFavorites: boolean) => Promise<void>;
  clearCategory: (kind: ItemKind, includeFavorites?: boolean) => Promise<void>;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
  changeStorageLocation: (path: string) => Promise<Settings>;
  setShowPreview: (show: boolean) => void;
  setShowDetails: (show: boolean) => void;
  setShowCommands: (show: boolean) => void;
  applyAppearance: (appearance: SystemAppearance) => void;
}

let historyGeneration = 0;

export const useStore = create<State & Actions>((set, get) => ({
  items: [],
  selectedId: null,
  search: '',
  activeKinds: [],
  favoritesOnly: false,
  counts: {
    total: 0,
    favorites: 0,
    pinned: 0,
    text: 0,
    images: 0,
    files: 0,
    links: 0,
    colors: 0,
    emails: 0,
    storageBytes: 0,
  },
  settings: null,
  appearance: null,
  showPreview: false,
  showDetails: true,
  showCommands: false,
  loading: false,
  loadingMore: false,
  hasMore: false,
  nextOffset: 0,

  refresh: async () => {
    const generation = ++historyGeneration;
    set({ loading: true, loadingMore: false });
    try {
      const query = buildQuery(get(), 0);
      const [page, counts] = await Promise.all([api.listItems(query), api.counts()]);
      if (generation !== historyGeneration) return;
      const items = mergeUniquePage([], page);
      set((s) => ({
        items,
        counts,
        nextOffset: page.length,
        hasMore: pageMayHaveMore(page.length),
        selectedId: items.some((i) => i.id === s.selectedId)
          ? s.selectedId
          : (items[0]?.id ?? null),
      }));
    } finally {
      if (generation === historyGeneration) set({ loading: false });
    }
  },

  loadMore: async () => {
    const current = get();
    if (current.loading || current.loadingMore || !current.hasMore) return;
    const generation = historyGeneration;
    const offset = current.nextOffset;
    set({ loadingMore: true });
    try {
      const page = await api.listItems(buildQuery(get(), offset));
      if (generation !== historyGeneration) return;
      set((state) => ({
        items: mergeUniquePage(state.items, page),
        nextOffset: offset + page.length,
        hasMore: pageMayHaveMore(page.length),
      }));
    } finally {
      if (generation === historyGeneration) set({ loadingMore: false });
    }
  },

  setSearch: async (search) => {
    set({ search });
    await get().refresh();
  },

  toggleKind: async (kind) => {
    const active = get().activeKinds.includes(kind)
      ? get().activeKinds.filter((k) => k !== kind)
      : [...get().activeKinds, kind];
    set({ activeKinds: active });
    await get().refresh();
  },

  toggleFavoritesOnly: async () => {
    set({ favoritesOnly: !get().favoritesOnly });
    await get().refresh();
  },

  select: (id) => set({ selectedId: id }),

  toggleFavorite: async (id) => {
    const item = get().items.find((i) => i.id === id);
    if (!item) return;
    await api.setFavorite(id, !item.favorite);
    await get().refresh();
  },

  editItem: async (id, content) => {
    await api.editItem(id, content);
    await get().refresh();
  },

  deleteItem: async (id) => {
    await api.deleteItem(id);
    await get().refresh();
  },

  clearHistory: async (includeFavorites) => {
    await api.clearHistory(includeFavorites);
    await get().refresh();
  },

  clearCategory: async (kind, includeFavorites = false) => {
    await api.clearCategory(kind, includeFavorites);
    await get().refresh();
  },

  loadSettings: async () => {
    const settings = await api.loadSettings();
    set({ settings, showPreview: settings.showPreview });
  },

  saveSettings: async (settings) => {
    const next = await api.saveSettings(settings);
    set({ settings: next, showPreview: next.showPreview });
  },

  changeStorageLocation: async (path) => {
    const next = await api.changeStorageLocation(path);
    set({ settings: next });
    await get().refresh();
    return next;
  },

  setShowPreview: (show) => set({ showPreview: show }),
  setShowDetails: (show) => set({ showDetails: show }),
  setShowCommands: (show) => set({ showCommands: show }),

  applyAppearance: (appearance) => set({ appearance }),
}));

function buildQuery(s: State, offset: number): ListQuery {
  return {
    search: s.search.trim() || null,
    kinds: s.activeKinds,
    favoritesOnly: s.favoritesOnly,
    limit: HISTORY_PAGE_SIZE,
    offset,
  };
}

/** Boots event subscriptions. Call once from the root component. */
export async function bootStore() {
  const refresh = () =>
    useStore.getState().refresh().catch((error: unknown) => {
      console.error('Failed to refresh clipboard history', error);
    });

  // Subscribe before the initial fetch so a clipboard update that lands while
  // either webview is starting cannot be missed. One failed startup request
  // must not disable all later real-time updates.
  await Promise.all([
    on<ClipItem>('clip-updated', () => void refresh()),
    on<string>('clip-touched', () => void refresh()),
    on<Settings>('settings-updated', (settings) => {
      useStore.setState({ settings, showPreview: settings.showPreview });
    }),
  ]);

  const syncAppearance = async () => {
    try {
      const appearance = await api.appearance();
      useStore.getState().applyAppearance(appearance);
    } catch (error) {
      console.error('Failed to read system appearance', error);
    }
  };
  await Promise.allSettled([
    refresh(),
    useStore.getState().loadSettings(),
    syncAppearance(),
  ]);
  window.addEventListener('focus', () => void syncAppearance());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncAppearance();
  });
}

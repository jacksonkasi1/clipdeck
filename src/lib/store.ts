import { create } from 'zustand';

import { api, on } from './tauri';
import type { ClipItem, Counts, ItemKind, ListQuery, Settings, SystemAppearance } from './types';

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
  loading: boolean;
}

interface Actions {
  refresh: () => Promise<void>;
  setSearch: (search: string) => Promise<void>;
  toggleKind: (kind: ItemKind) => Promise<void>;
  toggleFavoritesOnly: () => Promise<void>;
  select: (id: number | null) => void;
  toggleFavorite: (id: number) => Promise<void>;
  deleteItem: (id: number) => Promise<void>;
  clearHistory: (includeFavorites: boolean) => Promise<void>;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
  setShowPreview: (show: boolean) => void;
  applyAppearance: (appearance: SystemAppearance) => void;
}

export const useStore = create<State & Actions>((set, get) => ({
  items: [],
  selectedId: null,
  search: '',
  activeKinds: [],
  favoritesOnly: false,
  counts: { total: 0, favorites: 0, pinned: 0 },
  settings: null,
  appearance: null,
  showPreview: true,
  loading: false,

  refresh: async () => {
    set({ loading: true });
    try {
      const query = buildQuery(get());
      const [items, counts] = await Promise.all([api.listItems(query), api.counts()]);
      set((s) => ({
        items,
        counts,
        selectedId: items.some((i) => i.id === s.selectedId)
          ? s.selectedId
          : (items[0]?.id ?? null),
      }));
    } finally {
      set({ loading: false });
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

  deleteItem: async (id) => {
    await api.deleteItem(id);
    await get().refresh();
  },

  clearHistory: async (includeFavorites) => {
    await api.clearHistory(includeFavorites);
    await get().refresh();
  },

  loadSettings: async () => {
    const settings = await api.loadSettings();
    set({ settings, showPreview: settings.showPreview });
  },

  saveSettings: async (settings) => {
    const next = await api.saveSettings(settings);
    set({ settings: next });
  },

  setShowPreview: (show) => set({ showPreview: show }),

  applyAppearance: (appearance) => set({ appearance }),
}));

function buildQuery(s: State): ListQuery {
  return {
    search: s.search.trim() || null,
    kinds: s.activeKinds.length ? s.activeKinds : null,
    favoritesOnly: s.favoritesOnly,
    limit: 200,
    offset: 0,
  };
}

/** Boots event subscriptions. Call once from the root component. */
export async function bootStore() {
  await Promise.all([useStore.getState().refresh(), useStore.getState().loadSettings()]);

  await on<ClipItem>('clip-updated', async () => {
    await useStore.getState().refresh();
  });

  await on<string>('clip-touched', async () => {
    await useStore.getState().refresh();
  });

  const appearance = await api.appearance();
  useStore.getState().applyAppearance(appearance);
}

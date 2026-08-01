// ** import types
import type { ClipItem, Counts, ItemKind, ListQuery, Settings, SyncState, SystemAppearance } from './types';

// ** import lib
import { create } from 'zustand';

import { HISTORY_PAGE_SIZE, mergeUniquePage, pageMayHaveMore } from './paging';
import { api, on } from './tauri';

interface State {
  items: ClipItem[];
  selectedId: number | null;
  selectedIds: number[];
  selectionAnchor: number | null;
  search: string;
  activeKinds: ItemKind[];
  favoritesOnly: boolean;
  counts: Counts;
  settings: Settings | null;
  sync: SyncState | null;
  appearance: SystemAppearance | null;
  showPreview: boolean;
  showDetails: boolean;
  showCommands: boolean;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  nextOffset: number;
  /**
   * Optional override consumed by `refresh()` after a destructive action.
   * Stores the chosen successor id so the user lands on the same logical row
   * instead of having the selection jump to the top of the list.
   */
  pendingSelection: number | null;
}

interface Actions {
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  setSearch: (search: string) => Promise<void>;
  toggleKind: (kind: ItemKind) => Promise<void>;
  toggleFavoritesOnly: () => Promise<void>;
  select: (id: number | null) => void;
  selectOnly: (id: number) => void;
  selectToggle: (id: number) => void;
  selectRange: (id: number) => void;
  selectAll: () => void;
  toggleFavorite: (id: number) => Promise<void>;
  editItem: (id: number, content: string) => Promise<void>;
  deleteItem: (id: number) => Promise<void>;
  deleteSelected: () => Promise<void>;
  clearHistory: (includeFavorites: boolean) => Promise<void>;
  clearCategory: (kind: ItemKind, includeFavorites?: boolean) => Promise<void>;
  loadSettings: () => Promise<void>;
  loadSyncState: () => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
  regeneratePairingCode: () => Promise<void>;
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
  selectedIds: [],
  selectionAnchor: null,
  pendingSelection: null,
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
  sync: null,
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
      set((s) => {
        const override = s.pendingSelection;
        const fallback = items.some((i) => i.id === s.selectedId)
          ? s.selectedId
          : (items[0]?.id ?? null);
        const nextSelectedId =
          override !== null && items.some((i) => i.id === override)
            ? override
            : fallback;
        // Re-validate the multi-selection against the now-current items.
        const validIds = items.map((i) => i.id);
        const nextSelectedIds = s.selectedIds.filter((id) => validIds.includes(id));
        if (nextSelectedId !== null && !nextSelectedIds.includes(nextSelectedId)) {
          nextSelectedIds.unshift(nextSelectedId);
        }
        return {
          items,
          counts,
          nextOffset: page.length,
          hasMore: pageMayHaveMore(page.length),
          selectedId: nextSelectedId,
          selectedIds: nextSelectedIds,
          selectionAnchor: nextSelectedIds.length ? s.selectionAnchor : null,
          pendingSelection: null,
        };
      });
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

  select: (id) => {
    if (id === null) {
      set({ selectedId: null, selectedIds: [], selectionAnchor: null });
      return;
    }
    set({ selectedId: id, selectedIds: [id], selectionAnchor: id });
  },

  selectOnly: (id) => set({ selectedId: id, selectedIds: [id], selectionAnchor: id }),

  selectToggle: (id) => {
    const state = get();
    const isSelected = state.selectedIds.includes(id);
    const nextSelectedIds = isSelected
      ? state.selectedIds.filter((existing) => existing !== id)
      : [...state.selectedIds, id];
    // When toggling on, anchor follows the new item so a subsequent Shift+arrow
    // extends from it. When toggling off, keep the existing anchor if it still
    // points to a selected item — otherwise the just-deselected item would be
    // silently re-included in the next Shift+arrow range.
    const nextSelectedId = isSelected
      ? (nextSelectedIds[nextSelectedIds.length - 1] ?? null)
      : id;
    const anchorStillSelected = state.selectionAnchor !== null
      && nextSelectedIds.includes(state.selectionAnchor);
    const nextAnchor = isSelected
      ? (anchorStillSelected ? state.selectionAnchor : id)
      : id;
    set({
      selectedIds: nextSelectedIds,
      selectedId: nextSelectedId,
      selectionAnchor: nextAnchor,
    });
  },

  selectRange: (id) => {
    const state = get();
    const anchor = state.selectionAnchor ?? state.selectedId ?? id;
    const fromIndex = state.items.findIndex((item) => item.id === anchor);
    const toIndex = state.items.findIndex((item) => item.id === id);
    if (fromIndex < 0 || toIndex < 0) {
      set({ selectedId: id, selectedIds: [id], selectionAnchor: id });
      return;
    }
    const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
    const rangeIds = state.items.slice(start, end + 1).map((item) => item.id);
    set({
      selectedIds: rangeIds,
      selectedId: id,
      selectionAnchor: anchor,
    });
  },

  selectAll: () => {
    const ids = get().items.map((item) => item.id);
    set({
      selectedIds: ids,
      selectedId: ids[0] ?? null,
      selectionAnchor: ids[0] ?? null,
    });
  },

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
    const items = get().items;
    const index = items.findIndex((item) => item.id === id);
    // Prefer the row that will occupy the deleted position next; fall back
    // to the previous row if the deleted item was last, otherwise nothing.
    const successor = index >= 0 ? items[index + 1] ?? items[index - 1] ?? null : null;
    // Hold the successor in a closure so a concurrent `clip-updated` event
    // (which fires `refresh()` and clears `pendingSelection`) can't overwrite
    // the destination before our final refresh runs.
    const preserveSuccessor = () => set({ pendingSelection: successor?.id ?? null });
    preserveSuccessor();
    await api.deleteItem(id);
    await get().refresh();
    preserveSuccessor();
    await get().refresh();
  },

  deleteSelected: async () => {
    const ids = get().selectedIds;
    if (ids.length === 0) return;
    const items = get().items;
    const lastIndex = items.reduce(
      (max, item, currentIndex) => (ids.includes(item.id) ? currentIndex : max),
      -1,
    );
    const successor = lastIndex >= 0
      ? items
          .slice(lastIndex + 1)
          .find((item) => !ids.includes(item.id)) ?? items.slice(0, lastIndex).reverse().find((item) => !ids.includes(item.id)) ?? null
      : null;
    const preserveSuccessor = () => set({ pendingSelection: successor?.id ?? null });
    preserveSuccessor();
    const failed: number[] = [];
    for (const id of ids) {
      try {
        await api.deleteItem(id);
      } catch (error) {
        console.error('Failed to delete item', id, error);
        failed.push(id);
      }
    }
    if (failed.length > 0) {
      try {
        const { toast } = await import('./toast');
        toast(
          `Couldn't delete ${failed.length} item${failed.length === 1 ? '' : 's'} — see console.`,
          'error',
        );
      } catch {
        // Toast surface is optional — never let a UI affordance block a delete.
      }
    }
    await get().refresh();
    preserveSuccessor();
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

  loadSyncState: async () => {
    const sync = await api.syncState();
    set({ sync });
  },

  saveSettings: async (settings) => {
    const next = await api.saveSettings(settings);
    set({ settings: next, showPreview: next.showPreview });
    await get().loadSyncState();
  },

  regeneratePairingCode: async () => {
    const next = await api.regeneratePairingCode();
    set({ settings: next });
    await get().loadSyncState();
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
    on<void>('sync-peers-updated', () => {
      void useStore.getState().loadSyncState();
    }),
    on<SystemAppearance>('appearance-changed', (appearance) => {
      useStore.getState().applyAppearance(appearance);
    }),
  ]);

  const syncAppearance = async () => {
    try {
      const appearance = await api.syncNativeAppearance();
      useStore.getState().applyAppearance(appearance);
    } catch (error) {
      console.error('Failed to read system appearance', error);
    }
  };
  await Promise.allSettled([
    refresh(),
    useStore.getState().loadSettings(),
    useStore.getState().loadSyncState(),
    syncAppearance(),
  ]);
  window.addEventListener('focus', () => void syncAppearance());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncAppearance();
  });
}

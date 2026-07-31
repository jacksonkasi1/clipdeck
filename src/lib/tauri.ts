import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';

import type {
  ClipItem,
  Counts,
  FlavorBundle,
  ListQuery,
  PasteFlavor,
  Settings,
  SystemAppearance,
} from './types';

// Thin typed wrappers around `#[tauri::command]` calls. Centralising these
// here means components never see the raw command name and a refactor on
// either side stays a single-file change.

export const api = {
  listItems: (query: ListQuery) => invoke<ClipItem[]>('list_items', { query }),
  getItem: (id: number) => invoke<ClipItem>('get_item', { id }),
  flavorsFor: (id: number) => invoke<FlavorBundle>('flavors_for', { id }),
  copyToClipboard: (id: number, flavor: PasteFlavor) =>
    invoke<void>('copy_to_clipboard', { id, flavor }),
  pasteActive: (id: number, flavor: PasteFlavor) =>
    invoke<void>('paste_active', { id, flavor }),
  setFavorite: (id: number, value: boolean) =>
    invoke<void>('set_favorite', { id, value }),
  deleteItem: (id: number) => invoke<void>('delete_item', { id }),
  clearHistory: (includeFavorites: boolean) =>
    invoke<void>('clear_history', { includeFavorites }),
  counts: () => invoke<Counts>('counts'),
  loadSettings: () => invoke<Settings>('load_settings'),
  saveSettings: (settings: Settings) =>
    invoke<Settings>('save_settings', { settings }),
  pruneNow: () => invoke<void>('prune_now'),
  appearance: () => invoke<SystemAppearance>('appearance'),
  openSettingsWindow: () => invoke<void>('open_settings_window'),
  hideWindow: () => invoke<void>('hide_window'),
  quitApp: () => invoke<void>('quit_app'),
};

/** Converts an absolute file path into a `http://asset.localhost/...` URL
 * that the webview can fetch via the Tauri asset protocol. */
export const fileSrc = convertFileSrc;

/** Subscribes to a Tauri event and returns the unsubscribe function. */
export function on<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  return listen<T>(event, (e) => handler(e.payload));
}

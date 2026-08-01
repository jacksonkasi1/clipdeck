// ** import types
import type { UnlistenFn } from '@tauri-apps/api/event';
import type {
  ApplicationInfo,
  ClipItem,
  Counts,
  IgnoredApp,
  FlavorBundle,
  ItemKind,
  ListQuery,
  PasteFlavor,
  Settings,
  SyncState,
  SystemAppearance,
} from './types';

// ** import lib
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { confirm, open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';

// Thin typed wrappers around native calls. Components never use raw command
// names, keeping the Rust/TypeScript boundary centralized and type checked.
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
  setItemTags: (id: number, tags: string[]) =>
    invoke<ClipItem>('set_item_tags', { id, tags }),
  editItem: (id: number, content: string) =>
    invoke<ClipItem>('edit_item', { id, content }),
  deleteItem: (id: number) => invoke<void>('delete_item', { id }),
  clearHistory: (includeFavorites: boolean) =>
    invoke<void>('clear_history', { includeFavorites }),
  clearCategory: (kind: ItemKind, includeFavorites = false) =>
    invoke<void>('clear_category', { kind, includeFavorites }),
  counts: () => invoke<Counts>('counts'),
  loadSettings: () => invoke<Settings>('load_settings'),
  saveSettings: (settings: Settings) =>
    invoke<Settings>('save_settings', { settings }),
  changeStorageLocation: (path: string) =>
    invoke<Settings>('change_storage_location', { path }),
  pruneNow: () => invoke<void>('prune_now'),
  appearance: () => invoke<SystemAppearance>('appearance'),
  syncNativeAppearance: () => invoke<SystemAppearance>('sync_native_appearance'),
  openSettingsWindow: () => invoke<void>('open_settings_window'),
  openExternalUrl: (url: string) => invoke<void>('open_external_url', { url }),
  openStorageFolder: () => invoke<void>('open_storage_folder'),
  hideWindow: () => invoke<void>('hide_window'),
  setAlwaysOnTop: (value: boolean) => invoke<boolean>('set_always_on_top', { value }),
  setPreviewVisible: (value: boolean) => invoke<boolean>('set_preview_visible', { value }),
  syncState: () => invoke<SyncState>('sync_state'),
  regeneratePairingCode: () => invoke<Settings>('regenerate_pairing_code'),
  quitApp: () => invoke<void>('quit_app'),
  listInstalledApps: () => invoke<ApplicationInfo[]>('list_installed_apps'),
  listRunningApps: () => invoke<ApplicationInfo[]>('list_running_apps'),
  resolveApplicationIdentity: (executablePath: string) =>
    invoke<IgnoredApp>('resolve_application_identity', { executablePath }),
  extractApplicationIcon: (executablePath: string) =>
    invoke<string | null>('extract_application_icon', { executablePath }),
  chooseStorageFolder: () => open({ directory: true, multiple: false }),
  chooseApplications: () => open({
    directory: false,
    multiple: true,
    filters: [{ name: 'Applications', extensions: ['exe'] }],
  }),
  confirm: (message: string, title = 'Clipdeck') =>
    confirm(message, { title, kind: 'warning' }),
  revealItem: (path: string) => revealItemInDir(path),
};

/** Converts an absolute file path into an asset URL available to the webview. */
export const fileSrc = convertFileSrc;

/** Subscribes to a Tauri event and returns the unsubscribe function. */
export function on<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  return listen<T>(event, (eventPayload) => handler(eventPayload.payload));
}

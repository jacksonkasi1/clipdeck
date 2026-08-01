// ** import lib
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Which native window this webview is running in.
 *
 * Clipdeck ships two long-lived windows with very different contracts, so the
 * React tree has to know which one it is mounted in. Mode is resolved from the
 * Tauri window *label* first and the `?mode=` URL parameter second — never from
 * the viewport width, because a narrow full application window is still a full
 * application window and an expanded quick palette is still a flyout.
 */
export type WindowMode = 'quick' | 'full';

export const QUICK_LABEL = 'quick';

function fromLabel(): WindowMode | null {
  try {
    const label = getCurrentWindow().label;
    if (label === QUICK_LABEL) return 'quick';
    if (label === 'main') return 'full';
  } catch {
    // Not running inside Tauri (unit tests, `vite dev` in a browser).
  }
  return null;
}

function fromSearch(search: string): WindowMode | null {
  const value = new URLSearchParams(search).get('mode');
  return value === 'quick' ? 'quick' : value === 'full' ? 'full' : null;
}

/** Resolves the current window mode, defaulting to the full application. */
export function resolveWindowMode(search = globalThis.location?.search ?? ''): WindowMode {
  return fromLabel() ?? fromSearch(search) ?? 'full';
}

/** Pure helper used by tests and by `resolveWindowMode`. */
export function modeFromSearch(search: string): WindowMode {
  return fromSearch(search) ?? 'full';
}

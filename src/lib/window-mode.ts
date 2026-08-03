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

/**
 * True when the bundle was produced by `vite dev` (or a Tauri dev build that
 * uses Vite under the hood). We avoid `import.meta.env` so this file stays
 * usable from unit tests and from the production bundle without pulling in
 * the Vite client types.
 */
export function isDevBuild(): boolean {
  // `import.meta.env.MODE` is the Vite replacement for `process.env.NODE_ENV`
  // for client code. Vite injects it at build time; in tests `import.meta.env`
  // is absent, so the optional-chain + logical-OR keeps everything compiling.
  const mode = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env?.MODE
    ?? (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env?.DEV;
  if (typeof mode === 'boolean') return mode;
  if (typeof mode === 'string') return mode !== 'production';
  // Running under Vitest in jsdom: still useful to surface diagnostics.
  return true;
}

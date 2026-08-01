// ** import types
import type { WindowMode } from './window-mode';

/**
 * Every action that can appear in the history-pane header, beside the search
 * text itself.
 */
export type HeaderAction = 'clearSearch' | 'preview' | 'pin' | 'commands' | 'settings';

export interface HeaderActionContext {
  /** Which native window the header belongs to. Never inferred from width. */
  mode: WindowMode;
  /** True while the search input holds focus. */
  searchFocused: boolean;
  /** True while the search query is non-empty. */
  hasSearchText: boolean;
}

/**
 * Actions each window is allowed to expose at all.
 *
 * The quick flyout is a transient palette: pinning, the command palette and
 * settings are application-level affordances that belong to the full window,
 * the tray menu and the global shortcuts. Listing them here — rather than
 * hiding them with CSS — keeps them out of the DOM, out of the tab order and
 * out of the accessibility tree.
 */
const ALLOWED: Record<WindowMode, readonly HeaderAction[]> = {
  quick: ['preview'],
  full: ['preview', 'pin', 'commands', 'settings'],
};

/** Canonical left-to-right order, so the header never reshuffles its icons. */
const ORDER: readonly HeaderAction[] = ['clearSearch', 'preview', 'pin', 'commands', 'settings'];

/**
 * True when search owns the header and the remaining utility actions step
 * aside. Typing keeps the header in this state after focus moves away, so the
 * icons do not pop back in while a filter is still applied.
 */
export function isSearchActive({ searchFocused, hasSearchText }: HeaderActionContext): boolean {
  return searchFocused || hasSearchText;
}

/**
 * The actions to render, in order.
 *
 * `clearSearch` is the only action that survives an active search, and it only
 * appears once there is something to clear.
 */
export function visibleHeaderActions(context: HeaderActionContext): HeaderAction[] {
  const allowed = new Set<HeaderAction>(ALLOWED[context.mode]);
  const searchActive = isSearchActive(context);

  return ORDER.filter((action) => {
    if (action === 'clearSearch') return context.hasSearchText;
    if (searchActive) return false;
    return allowed.has(action);
  });
}

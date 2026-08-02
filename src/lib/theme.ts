// ** import types
import type { SystemAppearance, ThemeMode } from './types';

export type ResolvedTheme = Exclude<ThemeMode, 'system'>;

type ThemeTarget = Pick<HTMLElement, 'dataset' | 'style'>;

/** Resolves a persisted preference without assuming an OS-specific default. */
export function resolveTheme(mode: ThemeMode, systemDark?: boolean): ResolvedTheme {
  if (mode === 'dark' || mode === 'light') return mode;
  return (systemDark ?? prefersDarkTheme()) ? 'dark' : 'light';
}

/** Applies the same resolved theme and Windows accent to every Clipmo webview. */
export function applyTheme(
  mode: ThemeMode,
  appearance: SystemAppearance | null,
  target: ThemeTarget = document.documentElement,
): ResolvedTheme {
  const resolved = resolveTheme(mode, appearance?.dark);
  target.dataset.theme = resolved;
  if (appearance?.accent) target.style.setProperty('--accent', appearance.accent);
  return resolved;
}

function prefersDarkTheme(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

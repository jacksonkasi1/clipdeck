// TypeScript mirror of the Rust models exposed by `commands.rs`.
// Field names are camelCase on the wire; serde's `rename_all = "camelCase"`
// is configured globally in `error.rs` via the `Serialize` implementation.

export type ItemKind = 'Text' | 'Link' | 'Email' | 'Color' | 'Image' | 'Files';

export type PasteFlavor = 'Original' | 'PlainText';

export type Backdrop = 'Acrylic' | 'Mica' | 'Solid';

export type ThemeMode = 'System' | 'Light' | 'Dark';

export interface ImageMeta {
  path: string;
  thumbPath: string;
  width: number;
  height: number;
}

export interface SourceApp {
  name: string;
  exePath: string;
  iconPath: string | null;
}

export interface ClipItem {
  id: number;
  kind: ItemKind;
  preview: string;
  content: string;
  hasHtml: boolean;
  hasRtf: boolean;
  image: ImageMeta | null;
  files: string[];
  sizeBytes: number;
  source: SourceApp | null;
  favorite: boolean;
  copyCount: number;
  firstCopiedAt: number;
  lastCopiedAt: number;
}

export interface ListQuery {
  search?: string | null;
  kinds?: ItemKind[] | null;
  favoritesOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface FlavorBundle {
  text: string | null;
  html: string | null;
  rtf: string | null;
  files: string[];
  image: ImageMeta | null;
}

export interface Counts {
  total: number;
  favorites: number;
  pinned: number;
}

export interface Settings {
  hotkey: string;
  maxItems: number;
  retentionDays: number;
  captureImages: boolean;
  captureFiles: boolean;
  ignoredApps: string[];
  backdrop: Backdrop;
  theme: ThemeMode;
  pasteOnEnter: boolean;
  launchAtLogin: boolean;
  showPreview: boolean;
}

export interface SystemAppearance {
  accent: string;
  dark: boolean;
}

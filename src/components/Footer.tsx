// ** import lib
import { CornerDownLeft, Trash2, X } from 'lucide-react';

import { IconButton } from './IconButton';
import { useStore } from '../lib/store';

/**
 * A low-weight hint strip.
 *
 * Both windows now share one footer language: a thin divider, muted text and
 * small key caps. The full application no longer carries previous/next buttons
 * — the arrow keys already do that, and two icon buttons in a status strip
 * made the footer compete with the list above it.
 */
export function Footer() {
  const mode = useStore((s) => s.mode);
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const select = useStore((s) => s.select);
  const selectedIds = useStore((s) => s.selectedIds);
  const deleteSelected = useStore((s) => s.deleteSelected);
  const pasteOnEnter = useStore((s) => s.settings?.pasteOnEnter ?? true);
  const hasSelection = items.some((item) => item.id === selectedId);
  const primaryVerb = pasteOnEnter ? 'Paste' : 'Copy';

  if (selectedIds.length > 1) {
    return (
      <footer className="history-footer selection-footer" aria-label="Selection actions">
        <span>{selectedIds.length} selected</span>
        <div className="footer-spacer" />
        <IconButton label="Clear selection" onClick={() => select(null)}>
          <X size={15} aria-hidden />
        </IconButton>
        {/* A destructive action does not need a filled button in a strip this
            small; it stays an icon and keeps the danger tint on the glyph. */}
        <IconButton
          label={`Delete ${selectedIds.length} selected items`}
          tone="danger"
          onClick={() => void deleteSelected()}
        >
          <Trash2 size={15} aria-hidden />
        </IconButton>
      </footer>
    );
  }

  return (
    <footer className="history-footer" aria-label="Keyboard actions">
      <span className="footer-hint">
        <kbd aria-label="Up and down arrows">↑↓</kbd>
        <span>Navigate</span>
      </span>
      <span className="footer-hint">
        <kbd aria-label="Enter"><CornerDownLeft size={12} aria-hidden /></kbd>
        <span>{hasSelection ? primaryVerb : 'Select an item'}</span>
      </span>
      {mode === 'quick' && (
        <span className="footer-hint">
          <kbd>Esc</kbd>
          <span>Close</span>
        </span>
      )}
    </footer>
  );
}

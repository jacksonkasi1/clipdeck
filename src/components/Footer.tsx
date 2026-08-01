// ** import lib
import { ArrowDown, ArrowUp, CornerDownLeft, Trash2, X } from 'lucide-react';

import { IconButton } from './IconButton';
import { useStore } from '../lib/store';

export function Footer() {
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const select = useStore((s) => s.select);
  const selectedIds = useStore((s) => s.selectedIds);
  const deleteSelected = useStore((s) => s.deleteSelected);
  const pasteOnEnter = useStore((s) => s.settings?.pasteOnEnter ?? true);
  const idx = items.findIndex((i) => i.id === selectedId);
  const item = idx >= 0 ? items[idx] : undefined;
  const prev = idx > 0 ? items[idx - 1] : undefined;
  const next = idx >= 0 && idx < items.length - 1 ? items[idx + 1] : undefined;

  const primaryHint = item
    ? `${pasteOnEnter ? 'Paste' : 'Copy'} selected item`
    : 'Select an item';

  if (selectedIds.length > 1) {
    return (
      <footer className="history-footer selection-footer" aria-label="Selection actions">
        <strong>{selectedIds.length} items selected</strong>
        <div className="footer-spacer" />
        <IconButton label="Clear selection" onClick={() => select(null)}>
          <X size={16} aria-hidden />
        </IconButton>
        <button type="button" className="bulk-delete-button" onClick={() => void deleteSelected()}>
          <Trash2 size={15} aria-hidden /> Delete selected
        </button>
      </footer>
    );
  }

  return (
    <footer className="history-footer" aria-label="Keyboard actions">
      <div className="footer-nav">
        <IconButton
          label="Previous item"
          disabled={!prev}
          onClick={() => prev && select(prev.id)}
        >
          <ArrowUp size={16} aria-hidden />
        </IconButton>
        <IconButton
          label="Next item"
          disabled={!next}
          onClick={() => next && select(next.id)}
        >
          <ArrowDown size={16} aria-hidden />
        </IconButton>
        <span>Navigate</span>
      </div>
      <div className="footer-spacer" />
      <div className="footer-paste">
        <kbd aria-label="Enter"><CornerDownLeft size={14} aria-hidden /></kbd>
        <span>{primaryHint}</span>
      </div>
    </footer>
  );
}

// ** import lib
import { ArrowDown, ArrowUp, CornerDownLeft } from 'lucide-react';

import { IconButton } from './IconButton';
import { useStore } from '../lib/store';

export function Footer() {
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const select = useStore((s) => s.select);
  const pasteOnEnter = useStore((s) => s.settings?.pasteOnEnter ?? true);
  const item = items.find((i) => i.id === selectedId);

  const idx = items.findIndex((i) => i.id === selectedId);
  const prev = idx > 0 ? items[idx - 1] : undefined;
  const next = idx >= 0 && idx < items.length - 1 ? items[idx + 1] : undefined;

  const primaryHint = item
    ? `${pasteOnEnter ? 'Paste' : 'Copy'} selected item`
    : 'Select an item';

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
        <kbd><CornerDownLeft size={14} aria-hidden /></kbd>
        <span>{primaryHint}</span>
      </div>
    </footer>
  );
}

import { useStore } from '../lib/store';

export function Footer() {
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const select = useStore((s) => s.select);
  const item = items.find((i) => i.id === selectedId);

  const idx = items.findIndex((i) => i.id === selectedId);
  const prev = idx > 0 ? items[idx - 1] : undefined;
  const next = idx >= 0 && idx < items.length - 1 ? items[idx + 1] : undefined;

  const appName = item?.source?.name ?? '—';

  return (
    <footer className="footer" aria-label="Footer">
      <div className="footer-nav">
        <button
          type="button"
          aria-label="Previous"
          className="icon-button"
          disabled={!prev}
          onClick={() => prev && select(prev.id)}
        >
          <svg viewBox="0 0 16 16" aria-hidden focusable="false">
            <path d="M10 3.5L5.5 8 10 12.5l-1 1L4 8l5-5.5 1 1Z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Next"
          className="icon-button"
          disabled={!next}
          onClick={() => next && select(next.id)}
        >
          <svg viewBox="0 0 16 16" aria-hidden focusable="false">
            <path d="M6 3.5L10.5 8 6 12.5l-1-1L11 8 5 2.5l1 1Z" fill="currentColor" />
          </svg>
        </button>
      </div>
      <div className="footer-spacer" />
      <div className="footer-paste">
        <kbd>Enter</kbd>
        <span>to paste to {appName}</span>
      </div>
    </footer>
  );
}

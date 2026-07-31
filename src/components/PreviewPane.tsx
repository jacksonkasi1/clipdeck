import { useEffect, useState } from 'react';

import { useStore } from '../lib/store';
import { api, fileSrc } from '../lib/tauri';
import type { ClipItem } from '../lib/types';

export function PreviewPane() {
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const item = items.find((i) => i.id === selectedId) ?? null;

  if (!item) {
    return <PreviewEmpty />;
  }
  return (
    <section className="preview-pane" aria-label="Preview">
      <PreviewToolbar item={item} />
      <PreviewBody item={item} />
    </section>
  );
}

function PreviewToolbar({ item }: { item: ClipItem }) {
  const setShowPreview = useStore((s) => s.setShowPreview);
  const showPreview = useStore((s) => s.showPreview);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const deleteItem = useStore((s) => s.deleteItem);

  return (
    <div className="preview-toolbar" role="toolbar" aria-label="Preview actions">
      <IconButton label="Copy" onClick={() => api.copyToClipboard(item.id, 'Original')}>
        <svg viewBox="0 0 16 16" aria-hidden focusable="false">
          <path
            d="M5 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H5Zm0 1.5h6a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z"
            fill="currentColor"
          />
        </svg>
      </IconButton>
      <IconButton label="Paste" onClick={() => api.pasteActive(item.id, 'Original')}>
        <svg viewBox="0 0 16 16" aria-hidden focusable="false">
          <path
            d="M5 2h6v2h2v10H3V4h2V2Zm1.5 1v.5h3V3h-3Zm-2 2v8h7V5h-7Z"
            fill="currentColor"
          />
        </svg>
      </IconButton>
      <IconButton
        label={item.favorite ? 'Unfavorite' : 'Favorite'}
        onClick={() => toggleFavorite(item.id)}
      >
        <svg viewBox="0 0 16 16" aria-hidden focusable="false">
          <path
            d="M8 1.5l1.94 4.36 4.78.42-3.61 3.16 1.06 4.6L8 11.7 3.83 14.04l1.06-4.6L1.28 6.28l4.78-.42L8 1.5Z"
            fill={item.favorite ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </IconButton>
      <IconButton label="Delete" onClick={() => deleteItem(item.id)}>
        <svg viewBox="0 0 16 16" aria-hidden focusable="false">
          <path
            d="M5.5 2.5V3h5v-.5A1.5 1.5 0 0 0 9 1H7a1.5 1.5 0 0 0-1.5 1.5ZM3 4h10v.5H3V4Zm1.5 1.5h7l-.5 8a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 5 13.5l-.5-8Z"
            fill="currentColor"
          />
        </svg>
      </IconButton>
      <div className="toolbar-spacer" />
      <IconButton
        label={showPreview ? 'Hide details' : 'Show details'}
        onClick={() => setShowPreview(!showPreview)}
      >
        <svg viewBox="0 0 16 16" aria-hidden focusable="false">
          <path
            d="M3 5h10v6H3V5Zm1 1v4h8V6H4Z"
            fill="currentColor"
          />
        </svg>
      </IconButton>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={() => onClick()}
    >
      {children}
    </button>
  );
}

function PreviewBody({ item }: { item: ClipItem }) {
  switch (item.kind) {
    case 'Image':
      return item.image ? (
        <div className="preview-image-wrap">
          <img className="preview-image" src={fileSrc(item.image.path)} alt="" />
        </div>
      ) : (
        <PreviewEmpty message="Image not available" />
      );
    case 'Color':
      return <ColorPreview hex={item.preview.trim()} />;
    case 'Files':
      return (
        <ul className="file-list">
          {item.files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      );
    default:
      return <TextPreview item={item} />;
  }
}

function TextPreview({ item }: { item: ClipItem }) {
  const [rich, setRich] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (item.hasHtml) {
      api
        .flavorsFor(item.id)
        .then((f) => {
          if (!cancelled && f.html) setRich(f.html);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [item.id, item.hasHtml]);

  if (rich) {
    return (
      <div
        className="preview-text preview-html"
        // The content originates from the user's own clipboard.
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: rich }}
      />
    );
  }
  return <pre className="preview-text">{item.content}</pre>;
}

function ColorPreview({ hex }: { hex: string }) {
  return (
    <div className="color-preview">
      <div className="color-preview-swatch" style={{ background: hex }} />
      <div className="color-preview-meta">
        <div className="color-preview-hex">{hex}</div>
        <div className="color-preview-rgb">{hexToRgbString(hex)}</div>
      </div>
    </div>
  );
}

function PreviewEmpty({ message = 'Select an entry to preview' }: { message?: string } = {}) {
  return (
    <div className="preview-empty">
      <p>{message}</p>
    </div>
  );
}

function hexToRgbString(hex: string): string {
  const body = hex.startsWith('#') ? hex.slice(1) : hex;
  if (body.length !== 6 && body.length !== 3) return '';
  const expand = (s: string) => (s.length === 1 ? s + s : s);
  const r = parseInt(expand(body.slice(0, body.length / 3)), 16);
  const g = parseInt(expand(body.slice(body.length / 3, (body.length * 2) / 3)), 16);
  const b = parseInt(expand(body.slice((body.length * 2) / 3)), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

// ** import types
import type { ClipItem } from '../lib/types';

// ** import lib
import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CircleMinus,
  ClipboardCopy,
  Copy,
  ExternalLink,
  File,
  FileImage,
  Folder,
  FolderOpen,
  Link2,
  LoaderCircle,
  Mail,
  PanelBottomClose,
  PanelBottomOpen,
  Pencil,
  Save,
  Star,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';

import { IconButton } from './IconButton';
import { useStore } from '../lib/store';
import { api, fileSrc } from '../lib/tauri';
import { getShortcutLabel } from '../lib/platform';

export function PreviewPane() {
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const editItem = useStore((s) => s.editItem);
  const item = items.find((entry) => entry.id === selectedId) ?? null;
  const [editing, setEditing] = useState(false);

  useEffect(() => setEditing(false), [selectedId]);
  useEffect(() => {
    const beginEditing = () => {
      if (item && !['image', 'files'].includes(item.kind)) setEditing(true);
    };
    window.addEventListener('clipdeck:edit-selected', beginEditing);
    return () => window.removeEventListener('clipdeck:edit-selected', beginEditing);
  }, [item]);

  return (
    <section className="preview-pane" aria-label="Preview">
      <PreviewToolbar item={item} onEdit={() => setEditing(true)} />
      {item ? (
        editing ? (
          <EditItem
            item={item}
            onCancel={() => setEditing(false)}
            onSave={async (content) => {
              await editItem(item.id, content);
              setEditing(false);
            }}
          />
        ) : (
          <PreviewBody item={item} onEdit={() => setEditing(true)} />
        )
      ) : (
        <PreviewEmpty />
      )}
    </section>
  );
}

function PreviewToolbar({ item, onEdit }: { item: ClipItem | null; onEdit: () => void }) {
  const showDetails = useStore((s) => s.showDetails);
  const setShowDetails = useStore((s) => s.setShowDetails);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const deleteItem = useStore((s) => s.deleteItem);
  const editable = item && ['text', 'link', 'email', 'color'].includes(item.kind);

  return (
    <div className="preview-toolbar" role="toolbar" aria-label="Item actions">
      <div className="toolbar-group">
        <IconButton
          label={`Copy to clipboard (${getShortcutLabel('copy')})`}
          disabled={!item}
          onClick={() => item && void api.copyToClipboard(item.id, 'original')}
        >
          <Copy size={18} aria-hidden />
        </IconButton>
        <IconButton
          label={`Paste to active application (${getShortcutLabel('paste')})`}
          disabled={!item}
          onClick={() => item && void api.pasteActive(item.id, 'original')}
        >
          <ClipboardCopy size={18} aria-hidden />
        </IconButton>
        {editable && (
          <IconButton label={`Edit item (${getShortcutLabel('edit')})`} onClick={onEdit}>
            <Pencil size={18} aria-hidden />
          </IconButton>
        )}
      </div>
      <div className="toolbar-spacer" />
      <div className="toolbar-group">
        <IconButton
          label={item?.favorite ? 'Remove from favorites' : 'Add to favorites'}
          active={item?.favorite ?? false}
          disabled={!item}
          onClick={() => item && void toggleFavorite(item.id)}
        >
          <Star size={19} fill={item?.favorite ? 'currentColor' : 'none'} aria-hidden />
        </IconButton>
        <IconButton
          label={showDetails ? 'Hide details' : 'Show details'}
          active={item ? showDetails : false}
          disabled={!item}
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails ? (
            <PanelBottomClose size={19} aria-hidden />
          ) : (
            <PanelBottomOpen size={19} aria-hidden />
          )}
        </IconButton>
        <IconButton
          label="Delete item"
          tone="danger"
          disabled={!item}
          onClick={() => item && void deleteItem(item.id)}
        >
          <Trash2 size={18} aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

function PreviewBody({ item, onEdit }: { item: ClipItem; onEdit: () => void }) {
  switch (item.kind) {
    case 'image':
      return <ImagePreview item={item} />;
    case 'color':
      return <ColorPreview value={item.content || item.preview.trim()} onEdit={onEdit} />;
    case 'files':
      return <FilePreview item={item} />;
    case 'link':
      return <LinkPreview item={item} onEdit={onEdit} />;
    case 'email':
      return <EmailPreview item={item} onEdit={onEdit} />;
    default:
      return <TextPreview item={item} onEdit={onEdit} />;
  }
}

function TextPreview({ item, onEdit }: { item: ClipItem; onEdit: () => void }) {
  const codeLike = /(^|\n)\s*(const|let|fn|use|import|SELECT|class|function)\b|[{};]\s*$/m.test(
    item.content,
  );
  return (
    <button
      type="button"
      className={`preview-scroll preview-text-wrap preview-edit-trigger ${codeLike ? 'is-code' : ''}`}
      onClick={onEdit}
      title="Edit item"
    >
      <pre className="preview-text">{item.content || item.preview}</pre>
    </button>
  );
}

function ImagePreview({ item }: { item: ClipItem }) {
  if (!item.image) {
    return <PreviewFailure title={item.preview} message="The image preview is unavailable." />;
  }
  return (
    <div className="preview-scroll preview-image-wrap">
      <div className="image-canvas">
        <img className="preview-image" src={fileSrc(item.image.path)} alt={item.preview} />
      </div>
      <div className="preview-caption">
        <FileImage size={16} aria-hidden />
        <span>{item.image.width} × {item.image.height} pixels</span>
      </div>
    </div>
  );
}

function FilePreview({ item }: { item: ClipItem }) {
  const assets = item.fileAssets.length
    ? item.fileAssets
    : item.files.map((path) => ({
        originalPath: path,
        storedPath: null,
        sizeBytes: 0,
        isDirectory: false,
        status: 'skipped' as const,
        message: 'Original path only',
      }));
  return (
    <div className="preview-scroll file-preview">
      {assets.map((asset) => (
        <article className="file-card" key={asset.originalPath}>
          <span className="file-card-icon">
            {asset.isDirectory
              ? <Folder size={28} strokeWidth={1.5} aria-hidden />
              : <File size={28} strokeWidth={1.5} aria-hidden />}
          </span>
          <div className="file-card-copy">
            <strong>{baseName(asset.originalPath)}</strong>
            <span>{asset.storedPath ?? asset.originalPath}</span>
            <small className={`snapshot-status is-${asset.status}`}>
              <SnapshotStatusIcon status={asset.status} />
              {snapshotLabel(asset.status, asset.message)}
            </small>
          </div>
          <IconButton
            label="Show in File Explorer"
            onClick={() => void api.revealItem(asset.storedPath ?? asset.originalPath)}
          >
            <FolderOpen size={17} aria-hidden />
          </IconButton>
        </article>
      ))}
    </div>
  );
}

function LinkPreview({ item, onEdit }: { item: ClipItem; onEdit: () => void }) {
  const url = item.content || item.preview;
  const domain = safeDomain(url);
  return (
    <div className="preview-scroll link-preview">
      <article className="link-card">
        <div className="link-hero">
          <span className="link-mark"><Link2 size={34} aria-hidden /></span>
          <span>{domain}</span>
        </div>
        <button type="button" className="link-card-copy preview-edit-trigger" onClick={onEdit}>
          <strong>{domain || 'Web link'}</strong>
          <span>{url}</span>
        </button>
      </article>
      <button type="button" className="secondary-button" onClick={() => void api.openUrl(url)}>
        <ExternalLink size={16} aria-hidden /> Open in browser
      </button>
    </div>
  );
}

function EmailPreview({ item, onEdit }: { item: ClipItem; onEdit: () => void }) {
  const address = item.content || item.preview;
  return (
    <div className="preview-scroll email-preview">
      <span className="email-mark"><Mail size={34} strokeWidth={1.5} aria-hidden /></span>
      <button type="button" className="editable-preview" onClick={onEdit} title="Edit email address">
        {address}
      </button>
      <span>Email address</span>
    </div>
  );
}

function ColorPreview({ value, onEdit }: { value: string; onEdit: () => void }) {
  const rgb = hexToRgb(value);
  return (
    <div className="preview-scroll color-preview">
      <div
        className="color-preview-swatch"
        style={{ backgroundColor: value }}
        role="img"
        aria-label={`Color preview ${value}`}
      />
      <button type="button" className="editable-preview" onClick={onEdit} title="Edit color value">
        {value}
      </button>
      <span>{rgb}</span>
    </div>
  );
}

function EditItem({
  item,
  onSave,
  onCancel,
}: {
  item: ClipItem;
  onSave: (content: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(item.content || item.preview);
  const [saving, setSaving] = useState(false);

  return (
    <form
      className="preview-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!value.trim() || saving) return;
        setSaving(true);
        void onSave(value).finally(() => setSaving(false));
      }}
    >
      <header>
        <div>
          <strong>Edit clipboard item</strong>
          <span>Changes are saved locally and become the new copy value.</span>
        </div>
        <IconButton label="Cancel editing" onClick={onCancel}>
          <X size={18} aria-hidden />
        </IconButton>
      </header>
      <textarea
        autoFocus
        aria-label="Clipboard item content"
        spellCheck
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <footer>
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary-button" disabled={!value.trim() || saving}>
          <Save size={16} aria-hidden /> {saving ? 'Saving…' : 'Save item'}
        </button>
      </footer>
    </form>
  );
}

function SnapshotStatusIcon({ status }: { status: 'pending' | 'ready' | 'skipped' | 'failed' }) {
  if (status === 'pending') return <LoaderCircle size={13} className="spin" aria-hidden />;
  if (status === 'ready') return <CheckCircle2 size={13} aria-hidden />;
  if (status === 'skipped') return <CircleMinus size={13} aria-hidden />;
  return <TriangleAlert size={13} aria-hidden />;
}

function snapshotLabel(status: 'pending' | 'ready' | 'skipped' | 'failed', message: string | null) {
  if (status === 'pending') return 'Saving a managed snapshot…';
  if (status === 'ready') return 'Saved in Clipdeck storage';
  return message ?? (status === 'failed' ? 'Snapshot failed' : 'Snapshot skipped');
}

function PreviewEmpty() {
  return (
    <div className="preview-empty">
      <span className="preview-empty-icon"><ClipboardCopy size={26} aria-hidden /></span>
      <strong>Select an item to preview</strong>
      <span>Use ↑ and ↓ to move through your clipboard history.</span>
    </div>
  );
}

function PreviewFailure({ title, message }: { title: string; message: string }) {
  return (
    <div className="preview-empty preview-failure">
      <span className="preview-empty-icon"><FileImage size={26} aria-hidden /></span>
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function safeDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value;
  }
}

function hexToRgb(value: string): string {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value);
  if (!match?.[1]) return value;
  const body = match[1].length === 3
    ? match[1].split('').map((part) => part + part).join('')
    : match[1];
  const number = Number.parseInt(body, 16);
  return `rgb(${number >> 16}, ${(number >> 8) & 255}, ${number & 255})`;
}

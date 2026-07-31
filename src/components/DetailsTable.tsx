// ** import lib
import { AppWindow } from 'lucide-react';

import { formatBytes } from '../lib/formatting';
import { useStore } from '../lib/store';

const KIND_LABEL: Record<string, string> = {
  text: 'Plain text',
  link: 'Link',
  email: 'Email',
  color: 'Color',
  image: 'Image',
  files: 'File(s)',
};

export function DetailsTable() {
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const item = items.find((i) => i.id === selectedId);

  if (!item) return null;

  const app = item.source?.name ?? 'Unknown';
  const kind = KIND_LABEL[item.kind] ?? item.kind;
  const size = formatBytes(item.sizeBytes);

  return (
    <section className="details-panel" aria-label="Item details">
      <dl>
        <Row
          label="Application"
          value={<span className="source-value"><AppWindow size={15} aria-hidden />{app}</span>}
        />
        <Row label="Type" value={kind} />
        <Row label="Number of copies" value={String(item.copyCount)} />
        <Row label="First copy time" value={formatDate(item.firstCopiedAt)} />
        <Row label="Last copy time" value={formatDate(item.lastCopiedAt)} />
        {item.kind === 'image' && item.image && (
          <Row
            label="Dimensions"
            value={`${item.image.width} × ${item.image.height} px`}
          />
        )}
        {item.sizeBytes > 0 && <Row label="Size" value={size} />}
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="metadata-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatDate(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

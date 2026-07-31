import { useStore } from '../lib/store';

const KIND_LABEL: Record<string, string> = {
  Text: 'Plain text',
  Link: 'Link',
  Email: 'Email',
  Color: 'Color',
  Image: 'Image',
  Files: 'File(s)',
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
    <section className="details" aria-label="Details">
      <dl>
        <Row label="Application" value={app} />
        <Row label="Type" value={kind} />
        <Row label="Number of copies" value={String(item.copyCount)} />
        <Row label="First copy time" value={formatDate(item.firstCopiedAt)} />
        <Row label="Last copy time" value={formatDate(item.lastCopiedAt)} />
        {item.kind === 'Image' && item.image && (
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="details-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatDate(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

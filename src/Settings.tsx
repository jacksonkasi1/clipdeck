// ** import types
import type { ReactNode } from 'react';
import type { Backdrop, ItemKind, Settings as SettingsType, ThemeMode } from './lib/types';

// ** import utils
import { formatBytes } from './lib/formatting';
import { shortcutFromKeyEvent } from './lib/global-shortcut';

// ** import lib
import { useEffect, useState } from 'react';
import {
  Database,
  FileImage,
  Files,
  FolderOpen,
  HardDrive,
  Keyboard,
  Link2,
  Mail,
  Monitor,
  Palette,
  Save,
  Settings2,
  Star,
  Trash2,
  Type,
} from 'lucide-react';

import { useStore } from './lib/store';
import { api } from './lib/tauri';
import { getPlatform } from './lib/platform';
import { APP_SHORTCUTS, shortcutKeys } from './lib/shortcuts';
import { applyTheme } from './lib/theme';

const HISTORY_KINDS = [
  { key: 'text', kind: 'text', label: 'Text', icon: Type },
  { key: 'images', kind: 'image', label: 'Images', icon: FileImage },
  { key: 'files', kind: 'files', label: 'Files', icon: Files },
  { key: 'links', kind: 'link', label: 'Links', icon: Link2 },
  { key: 'colors', kind: 'color', label: 'Colors', icon: Palette },
  { key: 'emails', kind: 'email', label: 'Emails', icon: Mail },
] as const;

export default function Settings() {
  const settings = useStore((state) => state.settings);
  const saveSettings = useStore((state) => state.saveSettings);
  const appearance = useStore((state) => state.appearance);
  const counts = useStore((state) => state.counts);
  const clearHistory = useStore((state) => state.clearHistory);
  const clearCategory = useStore((state) => state.clearCategory);
  const changeStorageLocation = useStore((state) => state.changeStorageLocation);
  const [local, setLocal] = useState<SettingsType | null>(settings);
  const [saved, setSaved] = useState(false);
  const [storageBusy, setStorageBusy] = useState(false);

  useEffect(() => {
    if (settings && !local) setLocal(settings);
  }, [settings, local]);

  useEffect(() => {
    applyTheme(local?.theme ?? 'system', appearance);
  }, [local?.theme, appearance]);

  if (!local) return <SettingsLoading />;

  const update = <Key extends keyof SettingsType>(key: Key, value: SettingsType[Key]) => {
    setSaved(false);
    setLocal({ ...local, [key]: value });
  };

  const persist = async () => {
    await saveSettings(local);
    setSaved(true);
  };

  const chooseStorage = async () => {
    const selected = await api.chooseStorageFolder();
    if (typeof selected !== 'string') return;
    const approved = await api.confirm(
      'Clipdeck will copy and verify managed content before switching locations. Original files are never moved or deleted.',
      'Change storage location',
    );
    if (!approved) return;
    setStorageBusy(true);
    try {
      const next = await changeStorageLocation(selected);
      setLocal(next);
      setSaved(true);
    } finally {
      setStorageBusy(false);
    }
  };

  const removeCategory = async (kind: ItemKind, label: string, count: number) => {
    if (count === 0) return;
    const approved = await api.confirm(
      `Delete ${count} non-favorite ${label.toLowerCase()} item${count === 1 ? '' : 's'}? Favorites will stay.`,
      `Clear ${label}`,
    );
    if (approved) await clearCategory(kind);
  };

  const removeHistory = async (includeFavorites: boolean) => {
    const approved = await api.confirm(
      includeFavorites
        ? 'Delete every history item, including favorites? This cannot be undone.'
        : 'Clear all non-favorite history items? Favorites will stay pinned.',
      includeFavorites ? 'Delete all history' : 'Clear history',
    );
    if (approved) await clearHistory(includeFavorites);
  };

  return (
    <div className="settings-shell">
      <header className="settings-header">
        <span className="settings-app-icon"><Settings2 size={21} aria-hidden /></span>
        <div>
          <h1>Clipdeck settings</h1>
          <p>Appearance, capture, storage, and history controls</p>
        </div>
      </header>

      <div className="settings-scroll">
        <Section title="Appearance" description="Match Windows or choose a fixed theme." icon={<Monitor size={18} />}>
          <Row label="Theme" description="System is recommended and follows Windows automatically.">
            <Segmented<ThemeMode>
              value={local.theme}
              onChange={(value) => update('theme', value)}
              options={[
                { value: 'system', label: 'System' },
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
            />
          </Row>
          <Row label="Window material" description="Use a native Windows backdrop when supported.">
            <Segmented<Backdrop>
              value={local.backdrop}
              onChange={(value) => update('backdrop', value)}
              options={[
                { value: 'mica', label: 'Mica' },
                { value: 'acrylic', label: 'Acrylic' },
                { value: 'solid', label: 'Solid' },
              ]}
            />
          </Row>
          <Row label="Show preview by default" description="Keep the history compact until you open the preview pane.">
            <Toggle checked={local.showPreview} onChange={(value) => update('showPreview', value)} />
          </Row>
        </Section>

        <Section title="Capture" description="Choose what Clipdeck remembers locally." icon={<Database size={18} />}>
          <Row label="Capture images" description="Save image bytes and fast thumbnails in Clipdeck storage.">
            <Toggle checked={local.captureImages} onChange={(value) => update('captureImages', value)} />
          </Row>
          <Row label="Capture files and folders" description="Keep durable local snapshots without blocking clipboard capture.">
            <Toggle checked={local.captureFiles} onChange={(value) => update('captureFiles', value)} />
          </Row>
          <Row label="Store file snapshots" description="Copy files into managed storage so history still works if the original changes.">
            <Toggle checked={local.storeFileSnapshots} onChange={(value) => update('storeFileSnapshots', value)} />
          </Row>
          <Row label="Snapshot limit" description="Maximum stored size for one copied file or folder group.">
            <NumberInput
              value={local.maxSnapshotSizeMb}
              min={1}
              max={10_240}
              step={64}
              suffix="MB"
              onChange={(value) => update('maxSnapshotSizeMb', value)}
            />
          </Row>
          <Row label="Maximum history size" description="Favorites are not removed by normal retention cleanup.">
            <NumberInput
              value={local.maxItems}
              min={100}
              max={100_000}
              step={100}
              onChange={(value) => update('maxItems', value)}
            />
          </Row>
          <Row label="Auto-delete after" description="Use 0 days to keep non-favorite entries indefinitely.">
            <NumberInput
              value={local.retentionDays}
              min={0}
              max={365}
              step={1}
              suffix="days"
              onChange={(value) => update('retentionDays', value)}
            />
          </Row>
          <Row label="Paste on Enter" description="Paste the selected item into the previously active app.">
            <Toggle checked={local.pasteOnEnter} onChange={(value) => update('pasteOnEnter', value)} />
          </Row>
          <Row label="Launch at login" description="Start minimized and monitor the clipboard after sign-in.">
            <Toggle checked={local.launchAtLogin} onChange={(value) => update('launchAtLogin', value)} />
          </Row>
        </Section>

        <Section title="History and storage" description="Review usage and remove only what you choose." icon={<Database size={18} />}>
          <Row
            label="Managed storage location"
            description="Changing it copies, verifies, switches, then removes only old Clipdeck-managed copies."
          >
            <button
              type="button"
              className="storage-location-button"
              disabled={storageBusy}
              onClick={() => void chooseStorage()}
            >
              <FolderOpen size={16} aria-hidden />
              <span>{storageBusy ? 'Moving…' : (local.storagePath ?? 'Windows app data (default)')}</span>
            </button>
          </Row>
          <div className="history-summary">
            <Metric label="All items" value={counts.total} icon={<Database size={17} />} />
            <Metric label="Favorites" value={counts.favorites} icon={<Star size={17} />} />
            <Metric label="Stored data" value={formatBytes(counts.storageBytes)} icon={<HardDrive size={17} />} />
          </div>
          <div className="kind-count-grid" aria-label="Clipboard items by type">
            {HISTORY_KINDS.map(({ key, kind, label, icon: KindGlyph }) => (
              <button
                type="button"
                className="kind-count"
                key={key}
                title={`Clear non-favorite ${label.toLowerCase()} items`}
                onClick={() => void removeCategory(kind, label, counts[key])}
              >
                <KindGlyph size={16} strokeWidth={1.7} aria-hidden />
                <span>{label}</span>
                <strong>{counts[key]}</strong>
                <Trash2 className="kind-clear-icon" size={14} aria-hidden />
              </button>
            ))}
          </div>
          <div className="history-actions">
            <button type="button" className="secondary-button" onClick={() => void removeHistory(false)}>
              <Trash2 size={16} aria-hidden /> Clear non-favorites
            </button>
            <button type="button" className="danger-button" onClick={() => void removeHistory(true)}>
              <Trash2 size={16} aria-hidden /> Delete all history
            </button>
          </div>
        </Section>

        <Section
          title="Keyboard shortcuts"
          description={`${getPlatform() === 'macos' ? 'macOS' : 'Windows'} key labels are used in this build.`}
          icon={<Keyboard size={18} />}
        >
          <Row label="Open Clipdeck" description="Click the field, then press the global shortcut you want to use.">
            <ShortcutRecorder value={local.hotkey} onChange={(value) => update('hotkey', value)} />
          </Row>
          <div className="shortcut-reference" aria-label="Keyboard shortcut reference">
            {APP_SHORTCUTS.map((shortcut) => (
              <div className="shortcut-reference-row" key={shortcut.id}>
                <div>
                  <strong>{shortcut.label}</strong>
                  <span>{shortcut.description}</span>
                </div>
                <span className="shortcut-keys">
                  {shortcutKeys(shortcut).map((key) => <kbd key={key}>{key}</kbd>)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <footer className="settings-footer">
        <span className={saved ? 'save-status is-visible' : 'save-status'} aria-live="polite">
          Settings saved
        </span>
        <button type="button" className="primary-button" onClick={() => void persist()}>
          <Save size={16} aria-hidden /> Save changes
        </button>
      </footer>
    </div>
  );
}

function SettingsLoading() {
  return (
    <div className="settings-loading" role="status">
      Loading settings…
    </div>
  );
}

function Section({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <header className="settings-section-header">
        <span>{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function Row({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: ReactNode; icon: ReactNode }) {
  return (
    <div className="history-metric">
      <span className="history-metric-icon">{icon}</span>
      <div><strong>{value}</strong><span>{label}</span></div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

function Segmented<Value extends string>({
  value,
  onChange,
  options,
}: {
  value: Value;
  onChange: (value: Value) => void;
  options: { value: Value; label: string }[];
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? 'is-active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function NumberInput({
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="number-field">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
      {suffix && <span>{suffix}</span>}
    </label>
  );
}

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const keys = value.split('+').filter(Boolean);
  return (
    <button
      type="button"
      className="shortcut-recorder"
      title="Click, then press a shortcut"
      onKeyDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.currentTarget.blur();
          return;
        }
        const shortcut = shortcutFromKeyEvent(
          event,
          getPlatform() === 'macos' ? 'Super' : 'Win',
        );
        if (shortcut) onChange(shortcut);
      }}
    >
      <span className="shortcut-keys">
        {keys.map((key) => <kbd key={key}>{key}</kbd>)}
      </span>
    </button>
  );
}

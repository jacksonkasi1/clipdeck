import { useEffect, useState } from 'react';

import { useStore } from './lib/store';
import type { Backdrop, Settings as SettingsType, ThemeMode } from './lib/types';

export default function Settings() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const appearance = useStore((s) => s.appearance);
  const [local, setLocal] = useState<SettingsType | null>(settings);

  useEffect(() => {
    if (settings && !local) setLocal(settings);
  }, [settings, local]);

  useEffect(() => {
    document.documentElement.dataset.theme =
      local?.theme === 'Dark' || (local?.theme === 'System' && (appearance?.dark ?? false))
        ? 'dark'
        : 'light';
  }, [local?.theme, appearance?.dark]);

  if (!local) return null;

  const update = <K extends keyof SettingsType>(key: K, value: SettingsType[K]) =>
    setLocal({ ...local, [key]: value });

  const persist = async () => {
    await saveSettings(local);
  };

  return (
    <div className="settings-shell">
      <header className="settings-header">
        <h1>Clipdeck settings</h1>
      </header>

      <Section title="Appearance">
        <Row label="Theme">
          <Segmented<ThemeMode>
            value={local.theme}
            onChange={(v) => update('theme', v)}
            options={[
              { value: 'System', label: 'System' },
              { value: 'Light', label: 'Light' },
              { value: 'Dark', label: 'Dark' },
            ]}
          />
        </Row>
        <Row label="Backdrop">
          <Segmented<Backdrop>
            value={local.backdrop}
            onChange={(v) => update('backdrop', v)}
            options={[
              { value: 'Acrylic', label: 'Acrylic' },
              { value: 'Mica', label: 'Mica' },
              { value: 'Solid', label: 'Solid' },
            ]}
          />
        </Row>
        <Row label="Show preview pane">
          <Toggle
            checked={local.showPreview}
            onChange={(v) => update('showPreview', v)}
          />
        </Row>
      </Section>

      <Section title="Capture">
        <Row label="Capture images">
          <Toggle
            checked={local.captureImages}
            onChange={(v) => update('captureImages', v)}
          />
        </Row>
        <Row label="Capture files">
          <Toggle
            checked={local.captureFiles}
            onChange={(v) => update('captureFiles', v)}
          />
        </Row>
        <Row label="Maximum history size">
          <NumberInput
            value={local.maxItems}
            min={100}
            max={100_000}
            step={100}
            onChange={(v) => update('maxItems', v)}
          />
        </Row>
        <Row label="Auto-delete after (days, 0 = never)">
          <NumberInput
            value={local.retentionDays}
            min={0}
            max={365}
            step={1}
            onChange={(v) => update('retentionDays', v)}
          />
        </Row>
        <Row label="Paste on Enter">
          <Toggle
            checked={local.pasteOnEnter}
            onChange={(v) => update('pasteOnEnter', v)}
          />
        </Row>
      </Section>

      <Section title="Hotkey">
        <Row label="Show window">
          <input
            className="text-input"
            value={local.hotkey}
            onChange={(e) => update('hotkey', e.target.value)}
            placeholder="Ctrl+Shift+V"
          />
        </Row>
        <Row label="Launch at login">
          <Toggle
            checked={local.launchAtLogin}
            onChange={(v) => update('launchAtLogin', v)}
          />
        </Row>
      </Section>

      <div className="settings-footer">
        <button type="button" className="primary-button" onClick={() => void persist()}>
          Save changes
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">{label}</div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={`segmented-option ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
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
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      className="text-input"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
      }}
    />
  );
}

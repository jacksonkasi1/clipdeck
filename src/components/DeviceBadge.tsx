// ** import types
import type { DeviceIdentity, PlatformKind, SyncStatus } from '../lib/types';

// ** import lib
import { Apple, Monitor, Smartphone, TabletSmartphone, Terminal, Wifi, WifiOff } from 'lucide-react';

/**
 * The full device chip, used by the details pane and the sync settings list.
 *
 * The clipboard list no longer renders this: a badge with a dot, a platform
 * glyph, a name and a connectivity icon is far too much information for a row
 * that exists to be scanned. Rows show a single sync dot instead.
 */
export function DeviceBadge({
  device,
  status,
}: {
  device: DeviceIdentity;
  status: SyncStatus;
}) {
  const PlatformIcon = platformIcon(device.platform);
  const online = status !== 'offline';

  return (
    <span
      className={`device-badge is-${status}`}
      title={`${device.name} (${platformLabel(device.platform)}, ${status})`}
    >
      <span className="device-dot" style={{ backgroundColor: device.color }} />
      <PlatformIcon size={14} strokeWidth={1.8} aria-hidden />
      <span>{device.name}</span>
      {online ? <Wifi size={13} aria-hidden /> : <WifiOff size={13} aria-hidden />}
    </span>
  );
}

function platformIcon(platform: PlatformKind) {
  if (platform === 'macos' || platform === 'ios') return Apple;
  if (platform === 'android') return Smartphone;
  if (platform === 'linux') return Terminal;
  if (platform === 'unknown') return TabletSmartphone;
  return Monitor;
}

function platformLabel(platform: PlatformKind): string {
  if (platform === 'macos') return 'macOS';
  if (platform === 'ios') return 'iOS';
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

// ** import types
import type { DeviceIdentity, PlatformKind, SyncStatus } from '../lib/types';

// ** import lib
import { Apple, Monitor, Smartphone, TabletSmartphone, Terminal, Wifi, WifiOff } from 'lucide-react';

export function DeviceBadge({
  device,
  status,
  compact = false,
}: {
  device: DeviceIdentity;
  status: SyncStatus;
  compact?: boolean;
}) {
  const PlatformIcon = platformIcon(device.platform);
  const online = status !== 'offline';

  return (
    <span
      className={`device-badge ${compact ? 'is-compact' : ''} is-${status}`}
      title={`${device.name} (${platformLabel(device.platform)}, ${status})`}
    >
      <span className="device-dot" style={{ backgroundColor: device.color }} />
      <PlatformIcon size={compact ? 12 : 14} strokeWidth={1.8} aria-hidden />
      {!compact && <span>{device.name}</span>}
      {online ? <Wifi size={compact ? 11 : 13} aria-hidden /> : <WifiOff size={compact ? 11 : 13} aria-hidden />}
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

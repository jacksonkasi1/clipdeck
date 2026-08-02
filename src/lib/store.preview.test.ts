/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from './types';

const apiMock = vi.hoisted(() => ({
  setPreviewVisible: vi.fn(),
  saveSettings: vi.fn(),
  syncState: vi.fn(),
}));

vi.mock('./tauri', () => ({
  api: apiMock,
  on: vi.fn(),
}));

vi.mock('./toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}));

import { useStore } from './store';

const settings: Settings = {
  settingsVersion: 3,
  hotkey: 'Ctrl+Shift+V',
  fullWindowHotkey: 'Ctrl+Alt+Shift+V',
  maxItems: 10_000,
  retentionDays: 0,
  captureImages: true,
  captureFiles: true,
  storeFileSnapshots: true,
  maxSnapshotSizeMb: 512,
  fileFilterMode: 'exclude',
  fileIncludeExtensions: ['.txt', '.pdf'],
  fileExcludeExtensions: ['.exe'],
  imageFormat: 'original',
  imageCompression: 'normal',
  imageQuality: 80,
  storagePath: null,
  ignoredApps: [],
  backdrop: 'acrylic',
  theme: 'system',
  pasteOnEnter: true,
  launchAtLogin: false,
  showPreview: false,
  quickPreviewExpanded: false,
  syncEnabled: false,
  syncDeviceId: 'local',
  syncDeviceName: 'This device',
  syncDeviceColor: '#28b7e8',
  syncPairingCode: '123456',
};

describe('preview preference', () => {
  beforeEach(() => {
    apiMock.setPreviewVisible.mockReset().mockResolvedValue(true);
    apiMock.saveSettings.mockReset().mockImplementation(async (next: Settings) => next);
    apiMock.syncState.mockReset().mockResolvedValue(null);
    useStore.setState({
      mode: 'full',
      settings,
      showPreview: false,
      sync: null,
    });
  });

  it('persists the full-window preview preference', async () => {
    await useStore.getState().setShowPreview(true);

    expect(apiMock.setPreviewVisible).toHaveBeenCalledWith(true);
    expect(apiMock.saveSettings).toHaveBeenCalledWith({ ...settings, showPreview: true });
    expect(useStore.getState().showPreview).toBe(true);
    expect(useStore.getState().settings?.showPreview).toBe(true);
  });

  it('rolls the optimistic state back when native apply fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    apiMock.setPreviewVisible.mockRejectedValueOnce(new Error('native failure'));

    await useStore.getState().setShowPreview(true);

    expect(useStore.getState().showPreview).toBe(false);
    expect(apiMock.saveSettings).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

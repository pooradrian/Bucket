jest.mock('react-native-nitro-sqlite', () => ({ open: jest.fn() }));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: {},
  saveDocuments: jest.fn(),
  isKnownType: jest.fn(),
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
  ACCESSIBLE: {},
}));

jest.mock('../src/Database', () => ({
  ...jest.requireActual('../src/Database'),
  setKV: jest.fn(),
}));

import { DeviceEventEmitter, NativeModules } from 'react-native';
import {
  runHeadless,
  startUsbDebugBridge,
  toastText,
} from '../src/UsbDebugBridge';
import { DEFAULT_APP_SETTINGS, useAppStore } from '../src/store';

beforeEach(() => {
  useAppStore.setState({ appSettings: { ...DEFAULT_APP_SETTINGS } });
});

describe('runHeadless', () => {
  it('returns command output without the echoed input line', async () => {
    const r = await runHeadless('settings fontSizeBody');
    expect(r).toEqual({ ok: true, text: 'fontSizeBody = 15' });
  });

  it('changes settings live through settings.set', async () => {
    const r = await runHeadless('settings.set fontSizeBody 21');
    expect(r).toEqual({ ok: true, text: 'fontSizeBody: 15 -> 21' });
    expect(useAppStore.getState().appSettings.fontSizeBody).toBe(21);
  });

  it('reports errors as not ok', async () => {
    const r = await runHeadless('settings.set fontSizeBody big');
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/^! fontSizeBody takes a number/);
  });
});

describe('toastText', () => {
  it('summarizes with the first output line and truncates', () => {
    expect(
      toastText('settings.set x 1', { ok: true, text: 'x: 0 -> 1\nmore' }),
    ).toBe('USB ✓ settings.set x 1: x: 0 -> 1');
    expect(toastText('help', { ok: true, text: 'a'.repeat(300) }).length).toBe(
      120,
    );
  });
});

describe('startUsbDebugBridge', () => {
  it('keeps a single listener when started again (Fast Refresh)', async () => {
    const native = { start: jest.fn(), reply: jest.fn() };
    (NativeModules as Record<string, unknown>).UsbDebugModule = native;
    startUsbDebugBridge();
    // Fast Refresh re-executes the module and the fresh copy starts again
    // (react-native itself is shared). Call it outside isolateModules so RN's
    // lazy getters resolve in the shared registry, as on device.
    const rn = require('react-native');
    let startFresh: () => void = () => {};
    jest.isolateModules(() => {
      jest.doMock('react-native', () => rn);
      startFresh = require('../src/UsbDebugBridge').startUsbDebugBridge;
    });
    startFresh();
    DeviceEventEmitter.emit('UsbDebugCommand', {
      id: 1,
      cmd: 'settings fontSizeBody',
    });
    // Let every registered listener finish before counting replies.
    for (let i = 0; i < 50 && native.reply.mock.calls.length === 0; i++) {
      await new Promise<void>(r => setTimeout(() => r(), 10));
    }
    await new Promise<void>(r => setTimeout(() => r(), 100));
    expect(native.reply).toHaveBeenCalledTimes(1);
    expect(native.reply).toHaveBeenCalledWith(1, true, 'fontSizeBody = 15');
  });
});

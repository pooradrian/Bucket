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

import { runHeadless, toastText } from '../src/UsbDebugBridge';
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

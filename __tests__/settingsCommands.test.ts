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

import { applySettingValue } from '../src/debugger/settingsCommands';
import { DEFAULT_APP_SETTINGS } from '../src/store';

const base = { ...DEFAULT_APP_SETTINGS };

function ok(key: Parameters<typeof applySettingValue>[1], value: string) {
  const r = applySettingValue(base, key, value);
  if ('error' in r) throw new Error(r.error);
  return r.next;
}

describe('applySettingValue', () => {
  it('sets numbers, booleans, colors and enums with their real types', () => {
    expect(ok('fontSizeBody', '22').fontSizeBody).toBe(22);
    expect(ok('debugLogging', 'true').debugLogging).toBe(true);
    expect(ok('accentColor', '#ff0000').accentColor).toBe('#ff0000');
    expect(ok('textBoxMode', 'scroll').textBoxMode).toBe('scroll');
  });

  it('leaves every other setting untouched', () => {
    const next = ok('bubbleMaxWidth', '90');
    expect({ ...next, bubbleMaxWidth: base.bubbleMaxWidth }).toEqual(base);
  });

  it('resets to the default with "default"', () => {
    const current = { ...base, cardRadius: 3 };
    const r = applySettingValue(current, 'cardRadius', 'default');
    expect('next' in r && r.next.cardRadius).toBe(base.cardRadius);
  });

  it('rejects values of the wrong shape', () => {
    expect(applySettingValue(base, 'fontSizeBody', 'big')).toHaveProperty(
      'error',
    );
    expect(applySettingValue(base, 'fontSizeBody', '')).toHaveProperty('error');
    expect(applySettingValue(base, 'showRag', 'yes')).toHaveProperty('error');
    expect(applySettingValue(base, 'textBoxMode', 'wobbly')).toHaveProperty(
      'error',
    );
  });
});

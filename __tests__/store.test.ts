jest.mock('react-native-nitro-sqlite', () => ({open: jest.fn()}));
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

import {parseSavedSettings, getThemePreset, DEFAULT_APP_SETTINGS} from '../src/store';

describe('parseSavedSettings', () => {
  test('returns defaults for null/undefined/non-object input', () => {
    expect(parseSavedSettings(null)).toEqual(DEFAULT_APP_SETTINGS);
    expect(parseSavedSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS);
    expect(parseSavedSettings('not-an-object')).toEqual(DEFAULT_APP_SETTINGS);
  });

  test('coerces numeric settings from strings or numbers', () => {
    const s = parseSavedSettings({cardRadius: '24', fontSizeBody: 20});
    expect(s.cardRadius).toBe(24);
    expect(s.fontSizeBody).toBe(20);
  });

  test('falls back to the default when a numeric value is NaN', () => {
    const s = parseSavedSettings({cardRadius: 'not-a-number'});
    expect(s.cardRadius).toBe(DEFAULT_APP_SETTINGS.cardRadius);
  });

  test('coerces booleans from bool or "true" string', () => {
    expect(parseSavedSettings({showCharacterIcons: true}).showCharacterIcons).toBe(true);
    expect(parseSavedSettings({showCharacterIcons: 'true'}).showCharacterIcons).toBe(true);
    expect(parseSavedSettings({showCharacterIcons: false}).showCharacterIcons).toBe(false);
    expect(parseSavedSettings({showCharacterIcons: 'no'}).showCharacterIcons).toBe(false);
  });

  test('themeMode maps to light only for "light", dark otherwise', () => {
    expect(parseSavedSettings({themeMode: 'light'}).themeMode).toBe('light');
    expect(parseSavedSettings({themeMode: 'dark'}).themeMode).toBe('dark');
    expect(parseSavedSettings({themeMode: 'purple'}).themeMode).toBe('dark');
  });

  test('keeps string color keys and ignores non-string values', () => {
    const s = parseSavedSettings({bgPrimary: '#abc', accentColor: 123});
    expect(s.bgPrimary).toBe('#abc');
    expect(s.accentColor).toBe(DEFAULT_APP_SETTINGS.accentColor);
  });

  test('merges over defaults and drops unknown keys', () => {
    const s = parseSavedSettings({bgPrimary: '#000', bogusKey: 'x'});
    expect(s.bgPrimary).toBe('#000');
    expect((s as unknown as Record<string, unknown>).bogusKey).toBeUndefined();
    expect(s.cardRadius).toBe(DEFAULT_APP_SETTINGS.cardRadius);
  });
});

describe('getThemePreset', () => {
  test('dark preset uses a black background', () => {
    expect(getThemePreset('dark').bgPrimary).toBe('#000000');
  });
  test('light preset uses an off-white background', () => {
    expect(getThemePreset('light').bgPrimary).toBe('#F5F5F5');
  });
});

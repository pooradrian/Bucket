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

import {
  serializeTheme,
  parseTheme,
  encodeThemeURL,
  decodeThemeURL,
  applyThemeToSettings,
} from '../src/themeShare';
import {AppSettings, DEFAULT_APP_SETTINGS} from '../src/store';

const customSettings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  bgPrimary: '#1a2b3c',
  accentColor: '#ff00ff',
  userBubbleBg: '#abcdef',
  dynamicIcon: true,
};

describe('serializeTheme / parseTheme', () => {
  it('round-trips through serialize -> parse', () => {
    const json = serializeTheme(customSettings, 'Neon');
    const parsed = parseTheme(JSON.parse(json));
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('Neon');
    expect(parsed!.preset.bgPrimary).toBe('#1a2b3c');
    expect(parsed!.preset.accentColor).toBe('#ff00ff');
    expect(parsed!.preset.dynamicIcon).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(parseTheme(null)).toBeNull();
    expect(parseTheme('nope')).toBeNull();
    expect(parseTheme(42)).toBeNull();
  });

  it('rejects presets missing color keys', () => {
    expect(parseTheme({v: 1, preset: {bgPrimary: '#000'}})).toBeNull();
  });

  it('rejects presets with wrong color types', () => {
    expect(parseTheme({v: 1, preset: {...customSettings, accentColor: 123}})).toBeNull();
  });

  it('rejects missing version field', () => {
    expect(parseTheme({preset: customSettings})).toBeNull();
  });
});

describe('encodeThemeURL / decodeThemeURL', () => {
  it('round-trips through URL encode -> decode', () => {
    const url = encodeThemeURL(customSettings, 'Neon');
    expect(url.startsWith('bucket://theme?t=')).toBe(true);
    const decoded = decodeThemeURL(url);
    expect(decoded).not.toBeNull();
    expect(decoded!.name).toBe('Neon');
    expect(decoded!.preset.accentColor).toBe('#ff00ff');
  });

  it('ignores surrounding whitespace and extra text', () => {
    const url = encodeThemeURL(customSettings);
    const wrapped = `Check out my theme: ${url} !`;
    expect(decodeThemeURL(wrapped)).not.toBeNull();
  });

  it('returns null for non-theme URLs', () => {
    expect(decodeThemeURL('https://example.com')).toBeNull();
    expect(decodeThemeURL('')).toBeNull();
    expect(decodeThemeURL('bucket://other?t=abc')).toBeNull();
  });

  it('returns null for corrupt payloads', () => {
    expect(decodeThemeURL('bucket://theme?t=!!!not-base64!!!')).toBeNull();
  });
});

describe('applyThemeToSettings', () => {
  it('overrides only theme preset fields', () => {
    const decoded = decodeThemeURL(encodeThemeURL(customSettings))!;
    const result = applyThemeToSettings(DEFAULT_APP_SETTINGS, decoded);
    expect(result.bgPrimary).toBe('#1a2b3c');
    expect(result.accentColor).toBe('#ff00ff');
    expect(result.dynamicIcon).toBe(true);
    expect(result.cardRadius).toBe(DEFAULT_APP_SETTINGS.cardRadius);
    expect(result.themeMode).toBe(DEFAULT_APP_SETTINGS.themeMode);
  });
});

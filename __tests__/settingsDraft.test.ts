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

import {toDraft, SETTINGS_KEYS, CUSTOMIZATION_KEYS, NUMERIC_KEYS} from '../src/settingsDraft';
import {AppSettings, DEFAULT_APP_SETTINGS} from '../src/store';

describe('toDraft', () => {
  it('stringifies every SETTINGS_KEYS field', () => {
    const draft = toDraft(DEFAULT_APP_SETTINGS);
    for (const k of SETTINGS_KEYS) {
      expect(typeof draft[k]).toBe('string');
    }
  });

  it('preserves themeMode as a non-string union', () => {
    const draft = toDraft({...DEFAULT_APP_SETTINGS, themeMode: 'light'});
    expect(draft.themeMode).toBe('light');
  });

  it('round-trips numeric values through String()', () => {
    const s: AppSettings = {...DEFAULT_APP_SETTINGS, cardRadius: 24, fontSizeBody: 18};
    const draft = toDraft(s);
    expect(draft.cardRadius).toBe('24');
    expect(draft.fontSizeBody).toBe('18');
  });
});

describe('key sets', () => {
  it('CUSTOMIZATION_KEYS excludes toggles', () => {
    expect(CUSTOMIZATION_KEYS).not.toContain('showCharacterIcons');
    expect(CUSTOMIZATION_KEYS).not.toContain('dynamicIcon');
  });

  it('NUMERIC_KEYS are a subset of SETTINGS_KEYS', () => {
    for (const k of NUMERIC_KEYS) {
      expect(SETTINGS_KEYS).toContain(k);
    }
  });
});

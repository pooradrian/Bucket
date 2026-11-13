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

import {
  toDraft,
  SETTINGS_KEYS,
  COLOR_KEYS,
  SIZE_KEYS,
  FONT_KEYS,
  NUMERIC_KEYS,
  fromDraft,
} from '../src/settingsDraft';
import { AppSettings, DEFAULT_APP_SETTINGS } from '../src/store';

describe('toDraft', () => {
  it('stringifies every SETTINGS_KEYS field', () => {
    const draft = toDraft(DEFAULT_APP_SETTINGS);
    for (const k of SETTINGS_KEYS) {
      expect(typeof draft[k]).toBe('string');
    }
  });

  it('preserves themeMode as a non-string union', () => {
    const draft = toDraft({ ...DEFAULT_APP_SETTINGS, themeMode: 'light' });
    expect(draft.themeMode).toBe('light');
  });

  it('round-trips numeric values through String()', () => {
    const s: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      cardRadius: 24,
      fontSizeBody: 18,
    };
    const draft = toDraft(s);
    expect(draft.cardRadius).toBe('24');
    expect(draft.fontSizeBody).toBe('18');
  });
});

describe('key sets', () => {
  it('customization key sets exclude toggles', () => {
    for (const keys of [COLOR_KEYS, SIZE_KEYS, FONT_KEYS]) {
      expect(keys).not.toContain('showCharacterIcons');
      expect(keys).not.toContain('showThinking');
      expect(keys).not.toContain('dynamicIcon');
    }
  });

  it('carries showThinking through the draft', () => {
    expect(SETTINGS_KEYS).toContain('showThinking');
    expect(
      toDraft({ ...DEFAULT_APP_SETTINGS, showThinking: false }).showThinking,
    ).toBe('false');
  });

  it('NUMERIC_KEYS are a subset of SETTINGS_KEYS', () => {
    for (const k of NUMERIC_KEYS) {
      expect(SETTINGS_KEYS).toContain(k);
    }
  });
});

describe('fromDraft', () => {
  it('round-trips toDraft without changing any value or type', () => {
    const s: AppSettings = { ...DEFAULT_APP_SETTINGS, debugLogging: true };
    expect(fromDraft(toDraft(s), s, DEFAULT_APP_SETTINGS)).toEqual(s);
  });

  it('turns every boolean draft back into a real boolean', () => {
    const s: AppSettings = { ...DEFAULT_APP_SETTINGS, debugLogging: false };
    const out = fromDraft(toDraft(s), s, DEFAULT_APP_SETTINGS);
    expect(out.debugLogging).toBe(false);
    for (const [k, v] of Object.entries(DEFAULT_APP_SETTINGS)) {
      if (typeof v === 'boolean') {
        expect(typeof (out as unknown as Record<string, unknown>)[k]).toBe(
          'boolean',
        );
      }
    }
  });

  it('uses the default for an emptied number field, not 0', () => {
    const current = { ...DEFAULT_APP_SETTINGS, cardRadius: 5 };
    const draft = { ...toDraft(current), cardRadius: '' };
    expect(fromDraft(draft, current, DEFAULT_APP_SETTINGS).cardRadius).toBe(
      DEFAULT_APP_SETTINGS.cardRadius,
    );
  });

  it('keeps the current value for an unparseable number', () => {
    const current = { ...DEFAULT_APP_SETTINGS, fontSizeBody: 18 };
    const draft = { ...toDraft(current), fontSizeBody: 'abc' };
    expect(fromDraft(draft, current, DEFAULT_APP_SETTINGS).fontSizeBody).toBe(
      18,
    );
  });

  it('applies an explicit 0', () => {
    const draft = { ...toDraft(DEFAULT_APP_SETTINGS), cardRadius: '0' };
    expect(
      fromDraft(draft, DEFAULT_APP_SETTINGS, DEFAULT_APP_SETTINGS).cardRadius,
    ).toBe(0);
  });
  it('clamps numbers to their range', () => {
    const draft = {
      ...toDraft(DEFAULT_APP_SETTINGS),
      sendBtnSize: '500',
      fontSizeBody: '2',
    };
    const out = fromDraft(draft, DEFAULT_APP_SETTINGS, DEFAULT_APP_SETTINGS);
    expect(out.sendBtnSize).toBe(96);
    expect(out.fontSizeBody).toBe(8);
  });
});

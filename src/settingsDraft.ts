import { AppSettings } from './store';

export type Settings = Omit<Record<keyof AppSettings, string>, 'themeMode'> & {
  themeMode: 'dark' | 'light';
};

export const SETTINGS_KEYS: Exclude<keyof Settings, 'themeMode'>[] = [
  'bgPrimary',
  'bgSecondary',
  'bgPill',
  'borderPrimary',
  'textPrimary',
  'textSecondary',
  'textMuted',
  'cardRadius',
  'pillRadius',
  'bubbleRadius',
  'inputRadius',
  'bubbleMaxWidth',
  'fontSizeBody',
  'fontSizeHeader',
  'fontSizeTab',
  'bottomBarPad',
  'sideBtnSize',
  'sendBtnSize',
  'accentColor',
  'userBubbleBg',
  'dangerColor',
  'showCharacterIcons',
  'showGroupCharNames',
  'showThinking',
  'showRag',
  'showContextUsage',
  'showContextPercent',
  'dynamicIcon',
  'forceItalic',
  'debugLogging',
  'notificationMode',
  'notificationSound',
  'carouselAnimMs',
  'messageEditMode',
  'textBoxMode',
];

export function toDraft(s: AppSettings): Settings {
  const draft = {} as Settings;
  for (const k of SETTINGS_KEYS) {
    draft[k] = String(s[k]);
  }
  draft.themeMode = s.themeMode;
  return draft;
}

/**
 * Converts edited draft strings back into typed settings. Each field is
 * coerced by the type it has in `current`, so every boolean (including ones
 * added later) becomes a real boolean instead of the string "false" — which is
 * truthy. An empty number field (shown with the default as placeholder)
 * means the default; an unparseable one keeps the current value.
 */
export function fromDraft(
  draft: Settings,
  current: AppSettings,
  defaults: AppSettings,
): AppSettings {
  const out = { ...current } as unknown as Record<string, unknown>;
  const cur = current as unknown as Record<string, unknown>;
  const def = defaults as unknown as Record<string, unknown>;
  for (const k of Object.keys(draft) as (keyof Settings)[]) {
    const raw = draft[k];
    const prev = cur[k];
    if (typeof prev === 'boolean') {
      out[k] = raw === 'true';
    } else if (typeof prev === 'number') {
      const n = Number(raw);
      if (raw.trim() === '') {
        out[k] = def[k];
      } else if (Number.isFinite(n)) {
        out[k] = n;
      }
    } else {
      out[k] = raw;
    }
  }
  return out as unknown as AppSettings;
}

export const LABELS: Record<Exclude<keyof Settings, 'themeMode'>, string> = {
  bgPrimary: 'Background (primary)',
  bgSecondary: 'Background (secondary)',
  bgPill: 'Tab pill color',
  borderPrimary: 'Border color',
  textPrimary: 'Text (primary)',
  textSecondary: 'Text (secondary)',
  textMuted: 'Text (muted)',
  cardRadius: 'Card border radius',
  pillRadius: 'Pill border radius',
  bubbleRadius: 'Bubble border radius',
  bubbleMaxWidth: 'Message max width %',
  fontSizeBody: 'Body font size',
  fontSizeHeader: 'Header font size',
  fontSizeTab: 'Tab font size',
  bottomBarPad: 'Chat input gap above keyboard',
  sideBtnSize: 'Side button size',
  inputRadius: 'Input border radius',
  sendBtnSize: 'Send button size',
  accentColor: 'Accent color',
  dangerColor: 'Danger color (delete buttons)',
  userBubbleBg: 'User bubble color',
  showCharacterIcons: 'Show character icons',
  showGroupCharNames: 'Group chat selector',
  showThinking: 'Show thinking',
  showRag: 'Show RAG details',
  showContextUsage: 'Show context usage ring',
  showContextPercent: 'Show context percentage',
  dynamicIcon: 'Match icon to theme',
  forceItalic: 'Force italic (font fallback)',
  debugLogging: 'Activity logging',
  notificationMode: 'Notification on completion',
  notificationSound: 'Notification sound',
  carouselAnimMs: 'Carousel animation (ms)',
  messageEditMode: 'Message editing',
  textBoxMode: 'Text boxes',
};

export const COLOR_KEYS: Exclude<keyof Settings, 'themeMode'>[] = [
  'bgPrimary',
  'bgSecondary',
  'bgPill',
  'borderPrimary',
  'textPrimary',
  'textSecondary',
  'textMuted',
  'accentColor',
  'userBubbleBg',
  'dangerColor',
];

export const SIZE_KEYS: Exclude<keyof Settings, 'themeMode'>[] = [
  'cardRadius',
  'pillRadius',
  'bubbleRadius',
  'inputRadius',
  'bubbleMaxWidth',
  'bottomBarPad',
  'sideBtnSize',
  'sendBtnSize',
];

export const FONT_KEYS: Exclude<keyof Settings, 'themeMode'>[] = [
  'fontSizeBody',
  'fontSizeHeader',
  'fontSizeTab',
];

export const NUMERIC_KEYS: Exclude<
  keyof Settings,
  | 'themeMode'
  | 'showCharacterIcons'
  | 'showGroupCharNames'
  | 'showThinking'
  | 'showRag'
  | 'showContextUsage'
  | 'showContextPercent'
  | 'forceItalic'
  | 'debugLogging'
  | 'notificationSound'
  | 'messageEditMode'
  | 'textBoxMode'
>[] = [
  'cardRadius',
  'pillRadius',
  'bubbleRadius',
  'inputRadius',
  'bubbleMaxWidth',
  'fontSizeBody',
  'fontSizeHeader',
  'fontSizeTab',
  'bottomBarPad',
  'sideBtnSize',
  'sendBtnSize',
  'carouselAnimMs',
];

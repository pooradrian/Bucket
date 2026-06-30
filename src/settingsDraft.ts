import {AppSettings} from './store';

export type Settings = Omit<Record<keyof AppSettings, string>, 'themeMode'> & {themeMode: 'dark' | 'light'};

export const SETTINGS_KEYS: Exclude<keyof Settings, 'themeMode'>[] = [
  'bgPrimary', 'bgSecondary', 'bgPill', 'borderPrimary',
  'textPrimary', 'textSecondary', 'textMuted',
  'cardRadius', 'pillRadius', 'bubbleRadius', 'inputRadius',
  'chatMaxWidth', 'fontSizeBody', 'fontSizeHeader', 'fontSizeTab',
  'bottomBarPad', 'sideBtnSize', 'sendBtnSize',
  'accentColor', 'userBubbleBg', 'showCharacterIcons', 'dynamicIcon',
];

export function toDraft(s: AppSettings): Settings {
  const draft = {} as Settings;
  for (const k of SETTINGS_KEYS) {
    draft[k] = String(s[k]);
  }
  draft.themeMode = s.themeMode;
  return draft;
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
  chatMaxWidth: 'Chat max width %',
  fontSizeBody: 'Body font size',
  fontSizeHeader: 'Header font size',
  fontSizeTab: 'Tab font size',
  bottomBarPad: 'Bottom bar padding',
  sideBtnSize: 'Side button size',
  inputRadius: 'Input border radius',
  sendBtnSize: 'Send button size',
  accentColor: 'Accent color',
  userBubbleBg: 'User bubble color',
  showCharacterIcons: 'Show character icons',
  dynamicIcon: 'Match icon to theme',
};

export const CUSTOMIZATION_KEYS: Exclude<keyof Settings, 'themeMode'>[] = [
  'bgPrimary', 'bgSecondary', 'bgPill', 'borderPrimary',
  'textPrimary', 'textSecondary', 'textMuted',
  'cardRadius', 'pillRadius', 'bubbleRadius', 'inputRadius',
  'chatMaxWidth', 'fontSizeBody', 'fontSizeHeader', 'fontSizeTab',
  'bottomBarPad', 'sideBtnSize', 'sendBtnSize',
  'accentColor', 'userBubbleBg',
];

export const NUMERIC_KEYS: Exclude<keyof Settings, 'themeMode' | 'showCharacterIcons'>[] = [
  'cardRadius', 'pillRadius', 'bubbleRadius', 'inputRadius',
  'chatMaxWidth', 'fontSizeBody', 'fontSizeHeader', 'fontSizeTab',
  'bottomBarPad', 'sideBtnSize', 'sendBtnSize',
];

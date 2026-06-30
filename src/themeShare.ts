import {AppSettings, ThemePreset} from './store';

const THEME_URL_SCHEME = 'bucket://theme?t=';
const THEME_VERSION = 1;

const THEME_COLOR_KEYS: (keyof ThemePreset)[] = [
  'bgPrimary', 'bgSecondary', 'bgPill', 'borderPrimary',
  'textPrimary', 'textSecondary', 'textMuted',
  'accentColor', 'userBubbleBg',
];

export interface SharedTheme {
  v: number;
  name?: string;
  preset: ThemePreset;
}

function isThemePreset(value: unknown): value is ThemePreset {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;
  for (const key of THEME_COLOR_KEYS) {
    if (typeof obj[key] !== 'string') {
      return false;
    }
  }
  if (typeof obj.dynamicIcon !== 'boolean') {
    return false;
  }
  return true;
}

export function serializeTheme(settings: AppSettings, name?: string): string {
  const preset: ThemePreset = {
    bgPrimary: settings.bgPrimary,
    bgSecondary: settings.bgSecondary,
    bgPill: settings.bgPill,
    borderPrimary: settings.borderPrimary,
    textPrimary: settings.textPrimary,
    textSecondary: settings.textSecondary,
    textMuted: settings.textMuted,
    accentColor: settings.accentColor,
    userBubbleBg: settings.userBubbleBg,
    dynamicIcon: settings.dynamicIcon,
  };
  const shared: SharedTheme = {v: THEME_VERSION, preset};
  if (name) {
    shared.name = name;
  }
  return JSON.stringify(shared);
}

export function parseTheme(raw: unknown): SharedTheme | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.v !== 'number') {
    return null;
  }
  if (obj.name !== undefined && typeof obj.name !== 'string') {
    return null;
  }
  if (!isThemePreset(obj.preset)) {
    return null;
  }
  return {v: obj.v, name: obj.name as string | undefined, preset: obj.preset};
}

function base64UrlEncode(str: string): string {
  const utf8 = unescape(encodeURIComponent(str));
  const base64 = btoa(utf8);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(new RegExp('=+$'), '');
}

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const utf8 = atob(padded);
  return decodeURIComponent(escape(utf8));
}

export function encodeThemeURL(settings: AppSettings, name?: string): string {
  return THEME_URL_SCHEME + base64UrlEncode(serializeTheme(settings, name));
}

export function decodeThemeURL(url: string): SharedTheme | null {
  if (typeof url !== 'string') {
    return null;
  }
  const trimmed = url.trim();
  const idx = trimmed.indexOf(THEME_URL_SCHEME);
  if (idx === -1) {
    return null;
  }
  let payload = trimmed.slice(idx + THEME_URL_SCHEME.length);
  const ws = payload.search(/\s/);
  if (ws !== -1) {
    payload = payload.slice(0, ws);
  }
  if (!payload) {
    return null;
  }
  try {
    const json = base64UrlDecode(payload);
    return parseTheme(JSON.parse(json));
  } catch {
    return null;
  }
}

export function applyThemeToSettings(settings: AppSettings, theme: SharedTheme): AppSettings {
  return {
    ...settings,
    ...theme.preset,
  };
}

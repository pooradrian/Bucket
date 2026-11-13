import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  getThemePreset,
  parseSavedSettings,
  useAppStore,
} from '../store';
import { SETTINGS_KEYS, Settings, fromDraft, toDraft } from '../settingsDraft';
import { CommandHandler } from './types';

const ALL_KEYS: (keyof Settings)[] = ['themeMode', ...SETTINGS_KEYS];

export const SETTINGS_HELP = [
  'Settings Commands:',
  '  settings [filter]                 List settings (key = value), optionally filtered',
  '  settings.set <key> <value>        Change a setting live (same rules as the UI)',
  '  settings.set <key> default        Reset a setting to its default',
  '',
  '  Keys are case-insensitive. Booleans take true/false; empty numbers are rejected.',
  "  themeMode dark|light also applies that preset's colors, like the Theme screen.",
].join('\n');

function resolveKey(raw: string | undefined): keyof Settings | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return ALL_KEYS.find(k => k.toLowerCase() === lower) ?? null;
}

function defaultsFor(mode: AppSettings['themeMode']): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, ...getThemePreset(mode) };
}

/**
 * Applies `value` to `key` the same way the settings screen does, then
 * normalizes through parseSavedSettings so enums and types stay valid.
 * Returns an error instead when the value is rejected.
 */
export function applySettingValue(
  current: AppSettings,
  key: keyof Settings,
  value: string,
): { next: AppSettings } | { error: string } {
  const defaults = defaultsFor(current.themeMode);
  const raw = value.toLowerCase() === 'default' ? String(defaults[key]) : value;
  const prev = current[key];
  if (typeof prev === 'boolean' && raw !== 'true' && raw !== 'false') {
    return { error: `${key} takes true or false` };
  }
  if (typeof prev === 'number' && !Number.isFinite(Number(raw || 'x'))) {
    return { error: `${key} takes a number` };
  }
  const draft = { ...toDraft(current), [key]: raw } as Settings;
  const next = parseSavedSettings(fromDraft(draft, current, defaults));
  // parseSavedSettings resets an unknown enum value (e.g. textBoxMode) to its
  // default, so a changed string means the value was not accepted.
  if (typeof prev === 'string' && String(next[key]) !== raw) {
    return { error: `invalid value for ${key}: ${value}` };
  }
  return { next };
}

export const settingsCommand: CommandHandler = (rest, env, io) => {
  const s = useAppStore.getState().appSettings ?? env.appSettings;
  const filter = rest[0]?.toLowerCase();
  const keys = filter
    ? ALL_KEYS.filter(k => k.toLowerCase().includes(filter))
    : ALL_KEYS;
  if (keys.length === 0) {
    io.log('error', `No setting matches "${rest[0]}"`);
    return;
  }
  const width = Math.max(...keys.map(k => k.length));
  io.log(
    'output',
    keys.map(k => `${k.padEnd(width)} = ${String(s[k])}`).join('\n'),
  );
};

export const settingsSetCommand: CommandHandler = (rest, _env, io) => {
  const key = resolveKey(rest[0]);
  const value = rest.slice(1).join(' ');
  if (!key || rest.length < 2) {
    io.log(
      'error',
      rest[0] && !key
        ? `Unknown setting "${rest[0]}" (run "settings" for the list)`
        : 'Usage: settings.set <key> <value>',
    );
    return;
  }
  const store = useAppStore.getState();
  const current = store.appSettings;

  if (key === 'themeMode') {
    const mode = value.toLowerCase() === 'default' ? 'dark' : value;
    if (mode !== 'dark' && mode !== 'light') {
      io.log('error', 'themeMode takes dark or light');
      return;
    }
    store.applyThemeMode(mode);
    io.log('output', `themeMode: ${current.themeMode} -> ${mode}`);
    return;
  }

  const result = applySettingValue(current, key, value);
  if ('error' in result) {
    io.log('error', result.error);
    return;
  }
  store.setAppSettings(result.next);
  io.log(
    'output',
    `${key}: ${String(current[key])} -> ${String(result.next[key])}`,
  );
};

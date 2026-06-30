import {create} from 'zustand';
import {Character} from './CharacterEditor';
import {LorebookState, loadAllLorebooks as loadAllLorebooksFromStorage} from './RAGHandler';
import {getKV, setKV, getAllCharactersFromDB, saveCharacterToDB, deleteCharacterFromDB, getAllGroupChatsFromDB, saveGroupChatToDB, deleteGroupChatFromDB} from './Database';

export interface GroupChat {
  id: string;
  name: string;
  description: string;
  icon?: string;
  characterIds: string[];
}

export interface ThemePreset {
  bgPrimary: string;
  bgSecondary: string;
  bgPill: string;
  borderPrimary: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentColor: string;
  userBubbleBg: string;
  dynamicIcon: boolean;
}

export interface AppSettings extends ThemePreset {
  cardRadius: number;
  pillRadius: number;
  bubbleRadius: number;
  chatMaxWidth: number;
  fontSizeBody: number;
  fontSizeHeader: number;
  fontSizeTab: number;
  bottomBarPad: number;
  sideBtnSize: number;
  inputRadius: number;
  sendBtnSize: number;
  showCharacterIcons: boolean;
  forceItalic: boolean;
  themeMode: 'dark' | 'light';
}

const SETTINGS_KEY = 'settings';
const LOREBOOKS_KEY = 'lorebooks';

const DARK_THEME: ThemePreset = {
  bgPrimary: '#000000',
  bgSecondary: '#111111',
  bgPill: '#111111',
  borderPrimary: '#333333',
  textPrimary: '#FFFFFF',
  textSecondary: '#AAAAAA',
  textMuted: '#888888',
  accentColor: '#FFFFFF',
  userBubbleBg: '#1a1a1a',
  dynamicIcon: false,
};

const LIGHT_THEME: ThemePreset = {
  bgPrimary: '#F5F5F5',
  bgSecondary: '#FFFFFF',
  bgPill: '#E8E8E8',
  borderPrimary: '#D0D0D0',
  textPrimary: '#111111',
  textSecondary: '#555555',
  textMuted: '#999999',
  accentColor: '#333333',
  userBubbleBg: '#DCF8C6',
  dynamicIcon: false,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  ...DARK_THEME,
  cardRadius: 12,
  pillRadius: 50,
  bubbleRadius: 16,
  chatMaxWidth: 78,
  fontSizeBody: 15,
  fontSizeHeader: 17,
  fontSizeTab: 15,
  bottomBarPad: 30,
  sideBtnSize: 44,
  inputRadius: 12,
  sendBtnSize: 38,
  showCharacterIcons: true,
  forceItalic: false,
  themeMode: 'dark',
  dynamicIcon: false,
};

interface AppStore {
  appSettings: AppSettings;
  setAppSettings: (settings: AppSettings) => void;
  loadSettings: () => Promise<void>;
  applyThemeMode: (mode: 'dark' | 'light') => void;

  characters: Character[];
  charactersLoading: boolean;
  loadCharacters: () => Promise<void>;
  saveCharacter: (char: Character) => Promise<void>;
  deleteCharacter: (id: string) => void;

  groupChats: GroupChat[];
  groupChatsLoading: boolean;
  loadGroupChats: () => Promise<void>;
  saveGroupChat: (group: GroupChat) => Promise<void>;
  deleteGroupChat: (id: string) => void;

  lorebooks: LorebookState[];
  setLorebooks: (lorebooks: LorebookState[]) => void;
  loadLorebooks: () => Promise<void>;

  promptConfigVersion: number;
  bumpPromptConfigVersion: () => void;

  showSysStats: boolean;
  toggleSysStats: () => void;
}

export function getThemePreset(mode: 'dark' | 'light'): ThemePreset {
  return mode === 'dark' ? DARK_THEME : LIGHT_THEME;
}

const NUMERIC_SETTING_KEYS = [
  'cardRadius', 'pillRadius', 'bubbleRadius', 'chatMaxWidth',
  'fontSizeBody', 'fontSizeHeader', 'fontSizeTab',
  'bottomBarPad', 'sideBtnSize', 'inputRadius', 'sendBtnSize',
] as const;

const THEME_COLOR_KEYS = [
  'bgPrimary', 'bgSecondary', 'bgPill', 'borderPrimary',
  'textPrimary', 'textSecondary', 'textMuted',
  'accentColor', 'userBubbleBg',
] as const;

export function parseSavedSettings(raw: unknown): AppSettings {
  const result: AppSettings = {...DEFAULT_APP_SETTINGS};
  if (!raw || typeof raw !== 'object') {
    return result;
  }
  const saved = raw as Record<string, unknown>;

  for (const key of NUMERIC_SETTING_KEYS) {
    if (key in saved) {
      const n = Number(saved[key]);
      result[key] = Number.isNaN(n) ? DEFAULT_APP_SETTINGS[key] : n;
    }
  }

  result.showCharacterIcons = saved.showCharacterIcons === true || saved.showCharacterIcons === 'true';
  result.forceItalic = saved.forceItalic === true || saved.forceItalic === 'true';
  result.dynamicIcon = saved.dynamicIcon === true || saved.dynamicIcon === 'true';
  result.themeMode = saved.themeMode === 'light' ? 'light' : 'dark';

  for (const key of THEME_COLOR_KEYS) {
    if (typeof saved[key] === 'string') {
      result[key] = saved[key];
    }
  }

  return result;
}

export const useAppStore = create<AppStore>((set, get) => ({
  appSettings: DEFAULT_APP_SETTINGS,
  setAppSettings: (settings) => {
    set({appSettings: settings});
    setKV(SETTINGS_KEY, JSON.stringify(settings));
  },
  loadSettings: async () => {
    try {
      const stored = getKV(SETTINGS_KEY);
      if (stored) {
        set({appSettings: parseSavedSettings(JSON.parse(stored))});
      }
    } catch (e) {
      console.warn('Failed to load settings:', e);
    }
  },
  applyThemeMode: (mode) => {
    const {appSettings} = get();
    const preset = getThemePreset(mode);
    const updated: AppSettings = {
      ...appSettings,
      ...preset,
      themeMode: mode,
    };
    set({appSettings: updated});
    setKV(SETTINGS_KEY, JSON.stringify(updated));
  },

  characters: [],
  charactersLoading: true,
  loadCharacters: async () => {
    try {
      set({charactersLoading: true});
      const chars = await getAllCharactersFromDB();
      set({characters: chars.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        initialMessage: c.initial_message,
        writingStyle: c.writing_style,
        personality: c.personality,
        scenario: c.scenario,
        exampleMessages: c.example_messages || undefined,
        lorebookIds: c.lorebook_id ? c.lorebook_id.split(',').filter(Boolean) : [],
        icon: c.icon || undefined,
      })), charactersLoading: false});
    } catch (e) {
      console.warn('Failed to load characters:', e);
      set({charactersLoading: false});
    }
  },
  saveCharacter: async (char) => {
    const {characters} = get();
    const exists = characters.findIndex(c => c.id === char.id);
    const updated = exists !== -1
      ? characters.map((c, i) => (i === exists ? char : c))
      : [...characters, char];
    try {
      await saveCharacterToDB({
        id: char.id,
        name: char.name,
        description: char.description,
        initial_message: char.initialMessage,
        writing_style: char.writingStyle,
        personality: char.personality,
        scenario: char.scenario,
        example_messages: char.exampleMessages || '',
        icon: char.icon || '',
        lorebook_id: (char.lorebookIds || []).join(','),
      });
      set({characters: updated});
    } catch (e) {
      console.warn('Failed to save character:', e);
    }
  },
  deleteCharacter: (id) => {
    try {
      deleteCharacterFromDB(id);
      set({characters: get().characters.filter(c => c.id !== id)});
    } catch (e) {
      console.warn('Failed to delete character:', e);
    }
  },

  groupChats: [],
  groupChatsLoading: true,
  loadGroupChats: async () => {
    try {
      set({groupChatsLoading: true});
      const rows = await getAllGroupChatsFromDB();
      set({groupChats: rows.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        icon: r.icon || undefined,
        characterIds: r.characterIds,
      })), groupChatsLoading: false});
    } catch (e) {
      console.warn('Failed to load group chats:', e);
      set({groupChatsLoading: false});
    }
  },
  saveGroupChat: async (group) => {
    const {groupChats} = get();
    const exists = groupChats.findIndex(g => g.id === group.id);
    const updated = exists !== -1
      ? groupChats.map((g, i) => (i === exists ? group : g))
      : [...groupChats, group];
    try {
      await saveGroupChatToDB({
        id: group.id,
        name: group.name,
        description: group.description,
        icon: group.icon || '',
        characterIds: group.characterIds,
      });
      set({groupChats: updated});
    } catch (e) {
      console.warn('Failed to save group chat:', e);
    }
  },
  deleteGroupChat: (id) => {
    try {
      deleteGroupChatFromDB(id);
      set({groupChats: get().groupChats.filter(g => g.id !== id)});
    } catch (e) {
      console.warn('Failed to delete group chat:', e);
    }
  },

  lorebooks: [],
  setLorebooks: (lorebooks) => {
    set({lorebooks});
    setKV(LOREBOOKS_KEY, JSON.stringify(lorebooks));
  },
  loadLorebooks: async () => {
    try {
      const loaded = await loadAllLorebooksFromStorage();
      set({lorebooks: loaded});
    } catch (e) {
      console.warn('Failed to load lorebooks:', e);
    }
  },

  promptConfigVersion: 0,
  bumpPromptConfigVersion: () => set(s => ({promptConfigVersion: s.promptConfigVersion + 1})),

  showSysStats: false,
  toggleSysStats: () => set(s => ({showSysStats: !s.showSysStats})),
}));

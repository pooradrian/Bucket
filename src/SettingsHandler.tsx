import {useEffect, useState, useCallback, useRef, useMemo} from 'react';
import {AppState, ScrollView, Text, TouchableOpacity, View} from 'react-native';
import {
  PromptConfig,
  DEFAULT_PROMPT_CONFIG,
  loadPromptConfig,
  savePromptConfig,
} from './PromptHandler';
import ImportExportHandler from './ImportExportHandler';
import {useAppStore, DEFAULT_APP_SETTINGS, getThemePreset, AppSettings} from './store';
import {Settings, toDraft, NUMERIC_KEYS} from './settingsDraft';
import {useTheme} from './ThemeContext';
import CustomizationView from './settings/CustomizationView';
import PromptView from './settings/PromptView';
import PersonasView from './settings/PersonasView';
import LorebooksView from './settings/LorebooksView';
import ProvidersView from './settings/ProvidersView';
import NotificationsView from './settings/NotificationsView';
import DeveloperView from './settings/DeveloperView';

type SettingsView =
  | 'main'
  | 'customization'
  | 'systemPrompt'
  | 'personas'
  | 'lorebooks'
  | 'providers'
  | 'importExport'
  | 'notifications'
  | 'developer';

const VIEW_TITLES: Record<Exclude<SettingsView, 'main'>, string> = {
  customization: 'Customization',
  systemPrompt: 'Prompt & Context',
  personas: 'Personas',
  lorebooks: 'Lorebooks & RAG',
  providers: 'Providers',
  importExport: 'Import / Export',
  notifications: 'Notifications',
  developer: 'Developer',
};

const MENU_ITEMS: {
  view: Exclude<SettingsView, 'main'>;
  title: string;
  description: string;
}[] = [
  {
    view: 'customization',
    title: 'Customization',
    description: 'Colors, fonts, sizes, and display options',
  },
  {
    view: 'systemPrompt',
    title: 'Prompt & Context',
    description: 'System prompt, history cutoff, and summarization',
  },
  {
    view: 'personas',
    title: 'Personas',
    description: 'User persona profiles for the AI',
  },
  {
    view: 'lorebooks',
    title: 'Lorebooks & RAG',
    description: 'Import lorebooks and configure retrieval',
  },
  {
    view: 'providers',
    title: 'Providers',
    description: 'API providers, model, and temperature',
  },
  {
    view: 'importExport',
    title: 'Import / Export',
    description: 'Backup and transfer characters',
  },
  {
    view: 'notifications',
    title: 'Notifications',
    description: 'Chat completion alerts',
  },
  {
    view: 'developer',
    title: 'Developer',
    description: 'Activity logging and debugger',
  },
];

interface SettingsHandlerProps {
  onApply?: (settings: AppSettings) => void;
  onOpenDebugger?: () => void;
  bottomInset: number;
}

export default function SettingsHandler({
  onApply,
  onOpenDebugger,
  bottomInset,
}: SettingsHandlerProps) {
  const st = useTheme();
  const appSettings = useAppStore(sto => sto.appSettings);
  const promptConfigVersion = useAppStore(sto => sto.promptConfigVersion);
  const [settingsView, setSettingsView] = useState<SettingsView>('main');

  const [values, setValues] = useState<Settings>(() => toDraft(appSettings));
  const [promptValues, setPromptValues] = useState<PromptConfig>(
    DEFAULT_PROMPT_CONFIG,
  );
  const [promptSaved, setPromptSaved] = useState<PromptConfig>(
    DEFAULT_PROMPT_CONFIG,
  );
  const [promptLoaded, setPromptLoaded] = useState(false);
  const promptSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<PromptConfig | null>(null);
  const mountedRef = useRef(false);

  const defaults = useMemo(() => {
    const mode = values.themeMode;
    return toDraft({
      ...DEFAULT_APP_SETTINGS,
      ...getThemePreset(mode),
    } as AppSettings);
  }, [values.themeMode]);

  useEffect(() => {
    const draft = toDraft(appSettings);
    setValues(draft);
    mountedRef.current = true;
  }, [appSettings]);

  useEffect(() => {
    loadPromptConfig()
      .then(cfg => {
        setPromptValues(cfg);
        setPromptSaved(cfg);
        setPromptLoaded(true);
      })
      .catch(e => console.warn('Failed to load prompt config:', e));
  }, [promptConfigVersion]);

  useEffect(() => {
    if (!mountedRef.current) return;
    if (JSON.stringify(promptValues) === JSON.stringify(promptSaved)) {
      pendingSaveRef.current = null;
      return;
    }
    pendingSaveRef.current = promptValues;
    if (promptSaveTimerRef.current) clearTimeout(promptSaveTimerRef.current);
    promptSaveTimerRef.current = setTimeout(async () => {
      const cfg = pendingSaveRef.current;
      if (!cfg) return;
      pendingSaveRef.current = null;
      try {
        await savePromptConfig(cfg);
      } catch (e) {
        console.warn('Failed to save prompt config:', e);
      }
      setPromptSaved(cfg);
    }, 500);
    return () => {
      if (promptSaveTimerRef.current) clearTimeout(promptSaveTimerRef.current);
    };
  }, [promptValues, promptSaved]);

  useEffect(
    () => () => {
      if (promptSaveTimerRef.current) clearTimeout(promptSaveTimerRef.current);
      const cfg = pendingSaveRef.current;
      if (cfg) {
        pendingSaveRef.current = null;
        savePromptConfig(cfg).catch(e =>
          console.warn('Failed to save prompt config:', e),
        );
      }
    },
    [],
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'background' && state !== 'inactive') return;
      if (promptSaveTimerRef.current) clearTimeout(promptSaveTimerRef.current);
      const cfg = pendingSaveRef.current;
      if (cfg) {
        pendingSaveRef.current = null;
        savePromptConfig(cfg).catch(e =>
          console.warn('Failed to save prompt config:', e),
        );
      }
    });
    return () => sub.remove();
  }, []);

  const applyThemeSettings = useCallback(
    (draft: Settings) => {
      const converted: Record<string, unknown> = {...draft};
      for (const k of NUMERIC_KEYS) {
        converted[k] = Number(converted[k]);
        if (isNaN(converted[k] as number)) {
          converted[k] = (
            DEFAULT_APP_SETTINGS as unknown as Record<string, unknown>
          )[k];
        }
      }
      converted.showCharacterIcons = draft.showCharacterIcons === 'true';
      converted.forceItalic = draft.forceItalic === 'true';
      converted.dynamicIcon = draft.dynamicIcon === 'true';
      onApply?.(converted as unknown as AppSettings);
    },
    [onApply],
  );

  const handleChange = useCallback(
    (key: keyof Settings, text: string) => {
      setValues(prev => {
        const next = {...prev, [key]: text};
        applyThemeSettings(next);
        return next;
      });
    },
    [applyThemeSettings],
  );

  return (
    <View style={st.settingsContainer}>
      <View style={st.settingsHeader}>
        {settingsView !== 'main' && (
          <TouchableOpacity
            onPress={() => setSettingsView('main')}
            style={st.settingsBackBtn}
          >
            <Text style={st.settingsBackBtnText}>{'‹ Back'}</Text>
          </TouchableOpacity>
        )}
        <Text style={st.settingsHeaderName}>
          {settingsView === 'main' ? 'Settings' : VIEW_TITLES[settingsView]}
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={[
          st.settingsContent,
          {paddingBottom: bottomInset + 60},
        ]}
      >
        {settingsView === 'main' ? (
          <>
            {MENU_ITEMS.map(item => (
              <TouchableOpacity
                key={item.view}
                style={[st.card, {marginBottom: 10}]}
                onPress={() => setSettingsView(item.view)}
              >
                <Text style={st.cardTitle}>{item.title}</Text>
                <Text style={st.cardDescription}>{item.description}</Text>
              </TouchableOpacity>
            ))}
          </>
        ) : settingsView === 'customization' ? (
          <CustomizationView
            values={values}
            defaults={defaults}
            handleChange={handleChange}
          />
        ) : settingsView === 'systemPrompt' ? (
          <PromptView
            promptValues={promptValues}
            setPromptValues={setPromptValues}
            accent={values.accentColor}
          />
        ) : settingsView === 'personas' ? (
          <PersonasView
            values={values}
            promptValues={promptValues}
            setPromptValues={setPromptValues}
            promptLoaded={promptLoaded}
          />
        ) : settingsView === 'lorebooks' ? (
          <LorebooksView
            promptValues={promptValues}
            setPromptValues={setPromptValues}
          />
        ) : settingsView === 'providers' ? (
          <ProvidersView
            promptValues={promptValues}
            setPromptValues={setPromptValues}
          />
        ) : settingsView === 'importExport' ? (
          <ImportExportHandler bottomInset={bottomInset} />
        ) : settingsView === 'notifications' ? (
          <NotificationsView accent={values.accentColor} />
        ) : (
          <DeveloperView accent={values.accentColor} onOpenDebugger={onOpenDebugger} />
        )}
      </ScrollView>
    </View>
  );
}

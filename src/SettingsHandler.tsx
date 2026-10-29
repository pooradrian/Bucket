import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  PromptConfig,
  DEFAULT_PROMPT_CONFIG,
  loadPromptConfig,
  savePromptConfig,
} from './PromptHandler';
import ImportExportHandler from './ImportExportHandler';
import {
  useAppStore,
  DEFAULT_APP_SETTINGS,
  getThemePreset,
  AppSettings,
} from './store';
import { Settings, toDraft, NUMERIC_KEYS } from './settingsDraft';
import { useTheme } from './ThemeContext';
import CustomizationView, {
  CustomizationSection,
} from './settings/CustomizationView';
import PromptView, { PromptSection } from './settings/PromptView';
import PersonasView from './settings/PersonasView';
import LorebooksView, { LorebooksSection } from './settings/LorebooksView';
import ProvidersView, { ProvidersSection } from './settings/ProvidersView';
import NotificationsView from './settings/NotificationsView';
import DeveloperView from './settings/DeveloperView';

type SettingsView =
  | 'main'
  | 'customization'
  | 'customizationTheme'
  | 'customizationColors'
  | 'customizationSizes'
  | 'customizationFonts'
  | 'customizationDisplay'
  | 'prompt'
  | 'promptPresets'
  | 'promptSystem'
  | 'promptPlaceholders'
  | 'promptHistory'
  | 'promptDisplacement'
  | 'personas'
  | 'lorebooks'
  | 'lorebooksList'
  | 'lorebooksRag'
  | 'providers'
  | 'providersList'
  | 'providersModel'
  | 'importExport'
  | 'notifications'
  | 'developer';

const VIEW_TITLES: Record<SettingsView, string> = {
  main: 'Settings',
  customization: 'Customization',
  customizationTheme: 'Theme',
  customizationColors: 'Colors',
  customizationSizes: 'Sizes & Spacing',
  customizationFonts: 'Fonts',
  customizationDisplay: 'Display',
  prompt: 'Prompt & Context',
  promptPresets: 'Model Presets',
  promptSystem: 'System Prompt',
  promptPlaceholders: 'Placeholders',
  promptHistory: 'History & Summarization',
  promptDisplacement: 'Word Displacement',
  personas: 'Personas',
  lorebooks: 'Lorebooks & RAG',
  lorebooksList: 'Lorebooks',
  lorebooksRag: 'RAG Settings',
  providers: 'Providers',
  providersList: 'API Providers',
  providersModel: 'Model & Sampling',
  importExport: 'Import / Export',
  notifications: 'Notifications',
  developer: 'Developer',
};

interface MenuItem {
  view: SettingsView;
  title: string;
  description: string;
}

const MENU_ITEMS: Partial<Record<SettingsView, MenuItem[]>> = {
  main: [
    {
      view: 'customization',
      title: 'Customization',
      description: 'Theme, colors, sizes, and display',
    },
    {
      view: 'prompt',
      title: 'Prompt & Context',
      description: 'System prompt, history, and summarization',
    },
    {
      view: 'personas',
      title: 'Personas',
      description: 'User persona profiles for the AI',
    },
    {
      view: 'lorebooks',
      title: 'Lorebooks & RAG',
      description: 'Lorebooks and retrieval settings',
    },
    {
      view: 'providers',
      title: 'Providers',
      description: 'API providers, model, and sampling',
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
  ],
  customization: [
    {
      view: 'customizationTheme',
      title: 'Theme',
      description: 'Dark/light mode, app icon, and sharing',
    },
    {
      view: 'customizationColors',
      title: 'Colors',
      description: 'Backgrounds, text, accents, and bubbles',
    },
    {
      view: 'customizationSizes',
      title: 'Sizes & Spacing',
      description: 'Corner radii, buttons, and widths',
    },
    {
      view: 'customizationFonts',
      title: 'Fonts',
      description: 'Body, header, and tab text sizes',
    },
    {
      view: 'customizationDisplay',
      title: 'Display',
      description: 'Icons, thinking, italics, and carousel',
    },
  ],
  prompt: [
    {
      view: 'promptPresets',
      title: 'Model Presets',
      description: 'Per-model instructions and sampling',
    },
    {
      view: 'promptSystem',
      title: 'System Prompt',
      description: 'Prefix, suffix, and quick characters',
    },
    {
      view: 'promptPlaceholders',
      title: 'Placeholders',
      description: 'Every value you can insert',
    },
    {
      view: 'promptHistory',
      title: 'History & Summarization',
      description: 'Context cutoff and summary limits',
    },
    {
      view: 'promptDisplacement',
      title: 'Word Displacement',
      description: 'Rewrite rules applied to replies',
    },
  ],
  lorebooks: [
    {
      view: 'lorebooksList',
      title: 'Lorebooks',
      description: 'Create, import, and edit lorebooks',
    },
    {
      view: 'lorebooksRag',
      title: 'RAG Settings',
      description: 'Embedding model and retrieval limits',
    },
  ],
  providers: [
    {
      view: 'providersList',
      title: 'API Providers',
      description: 'Endpoints and API keys',
    },
    {
      view: 'providersModel',
      title: 'Model & Sampling',
      description: 'Model, temperature, and request body',
    },
  ],
};

const CUSTOMIZATION_SECTIONS: Partial<
  Record<SettingsView, CustomizationSection>
> = {
  customizationTheme: 'theme',
  customizationColors: 'colors',
  customizationSizes: 'sizes',
  customizationFonts: 'fonts',
  customizationDisplay: 'display',
};

const PROMPT_SECTIONS: Partial<Record<SettingsView, PromptSection>> = {
  promptPresets: 'presets',
  promptSystem: 'system',
  promptPlaceholders: 'placeholders',
  promptHistory: 'history',
  promptDisplacement: 'displacement',
};

const LOREBOOK_SECTIONS: Partial<Record<SettingsView, LorebooksSection>> = {
  lorebooksList: 'lorebooks',
  lorebooksRag: 'rag',
};

const PROVIDER_SECTIONS: Partial<Record<SettingsView, ProvidersSection>> = {
  providersList: 'providers',
  providersModel: 'model',
};

interface SettingsHandlerProps {
  onApply?: (settings: AppSettings) => void;
  onOpenDebugger?: () => void;
  onClose: () => void;
  bottomInset: number;
}

export default function SettingsHandler({
  onApply,
  onOpenDebugger,
  onClose,
  bottomInset,
}: SettingsHandlerProps) {
  const st = useTheme();
  const appSettings = useAppStore(sto => sto.appSettings);
  const promptConfigVersion = useAppStore(sto => sto.promptConfigVersion);
  const [viewStack, setViewStack] = useState<SettingsView[]>(['main']);
  const settingsView = viewStack[viewStack.length - 1];

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

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (viewStack.length <= 1) return false;
      setViewStack(prev => prev.slice(0, -1));
      return true;
    });
    return () => sub.remove();
  }, [viewStack.length]);

  const applyThemeSettings = useCallback(
    (draft: Settings) => {
      const converted: Record<string, unknown> = { ...draft };
      for (const k of NUMERIC_KEYS) {
        converted[k] = Number(converted[k]);
        if (isNaN(converted[k] as number)) {
          converted[k] = (
            DEFAULT_APP_SETTINGS as unknown as Record<string, unknown>
          )[k];
        }
      }
      converted.showCharacterIcons = draft.showCharacterIcons === 'true';
      converted.showThinking = draft.showThinking === 'true';
      converted.showRag = draft.showRag === 'true';
      converted.forceItalic = draft.forceItalic === 'true';
      converted.dynamicIcon = draft.dynamicIcon === 'true';
      onApply?.(converted as unknown as AppSettings);
    },
    [onApply],
  );

  const handleChange = useCallback(
    (key: keyof Settings, text: string) => {
      setValues(prev => {
        const next = { ...prev, [key]: text };
        applyThemeSettings(next);
        return next;
      });
    },
    [applyThemeSettings],
  );

  const navigateTo = useCallback((view: SettingsView) => {
    setViewStack(prev => [...prev, view]);
  }, []);

  const goBack = useCallback(() => {
    setViewStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const renderView = () => {
    const customizationSection = CUSTOMIZATION_SECTIONS[settingsView];
    if (customizationSection) {
      return (
        <CustomizationView
          section={customizationSection}
          values={values}
          defaults={defaults}
          handleChange={handleChange}
        />
      );
    }

    const promptSection = PROMPT_SECTIONS[settingsView];
    if (promptSection) {
      return (
        <PromptView
          section={promptSection}
          promptValues={promptValues}
          setPromptValues={setPromptValues}
          accent={values.accentColor}
        />
      );
    }

    const lorebooksSection = LOREBOOK_SECTIONS[settingsView];
    if (lorebooksSection) {
      return (
        <LorebooksView
          section={lorebooksSection}
          promptValues={promptValues}
          setPromptValues={setPromptValues}
          accent={values.accentColor}
        />
      );
    }

    const providersSection = PROVIDER_SECTIONS[settingsView];
    if (providersSection) {
      return (
        <ProvidersView
          section={providersSection}
          promptValues={promptValues}
          setPromptValues={setPromptValues}
        />
      );
    }

    switch (settingsView) {
      case 'personas':
        return (
          <PersonasView
            values={values}
            promptValues={promptValues}
            setPromptValues={setPromptValues}
            promptLoaded={promptLoaded}
          />
        );
      case 'importExport':
        return <ImportExportHandler bottomInset={bottomInset} />;
      case 'notifications':
        return <NotificationsView accent={values.accentColor} />;
      case 'developer':
        return (
          <DeveloperView
            accent={values.accentColor}
            onOpenDebugger={onOpenDebugger}
          />
        );
      default:
        return null;
    }
  };

  const menuItems = MENU_ITEMS[settingsView];

  return (
    <View style={st.settingsContainer}>
      <View style={st.settingsHeader}>
        <TouchableOpacity
          onPress={settingsView === 'main' ? onClose : goBack}
          style={st.settingsBackBtn}
        >
          <Text style={st.settingsBackBtnText}>{'‹ Back'}</Text>
        </TouchableOpacity>
        <Text style={st.settingsHeaderName}>{VIEW_TITLES[settingsView]}</Text>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={[
            st.settingsContent,
            { paddingBottom: bottomInset + 60 },
          ]}
        >
          {menuItems
            ? menuItems.map(item => (
                <TouchableOpacity
                  key={item.view}
                  style={[st.card, { marginBottom: 10 }]}
                  onPress={() => navigateTo(item.view)}
                >
                  <Text style={st.cardTitle}>{item.title}</Text>
                  <Text style={st.cardDescription}>{item.description}</Text>
                </TouchableOpacity>
              ))
            : renderView()}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

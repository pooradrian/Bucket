import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Alert,
  AppState,
  NativeSyntheticEvent,
  ScrollView,
  Share,
  Text,
  TextInput,
  TextInputContentSizeChangeEventData,
  TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  Persona,
  PromptConfig,
  DEFAULT_PROMPT_CONFIG,
  PLACEHOLDERS,
  loadPromptConfig,
  savePromptConfig,
  addPersona,
  updatePersona,
  deletePersona,
  activatePersona,
} from './PromptHandler';
import { loadLorebook, addLorebook, removeLorebook } from './RAGHandler';
import { getActiveProviderId } from './SecureStore';
import ProvidersHandler from './ProvidersHandler';
import ImportExportHandler from './ImportExportHandler';
import {
  useAppStore,
  AppSettings,
  DEFAULT_APP_SETTINGS,
  getThemePreset,
} from './store';
import { logEvent } from './EventLogger';
import { setIcon } from './IconModule';
import { useTheme } from './ThemeContext';
import {playNotificationSound} from './NotificationModule';
import {pick, types, keepLocalCopy} from '@react-native-documents/picker';
import {
  Settings,
  toDraft,
  LABELS,
  CUSTOMIZATION_KEYS,
  NUMERIC_KEYS,
} from './settingsDraft';
import {
  encodeThemeURL,
  decodeThemeURL,
  applyThemeToSettings,
} from './themeShare';

interface SettingsHandlerProps {
  onApply?: (settings: AppSettings) => void;
  onOpenDebugger?: () => void;
  bottomInset: number;
}

function AutoGrowTextInput({
  style,
  minHeight = 120,
  ...rest
}: TextInputProps & { minHeight?: number }) {
  const [height, setHeight] = useState(minHeight);
  return (
    <TextInput
      {...rest}
      multiline
      textAlignVertical="top"
      style={[style, { height }]}
      onContentSizeChange={(
        e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>,
      ) => setHeight(Math.max(minHeight, e.nativeEvent.contentSize.height))}
    />
  );
}

export default function SettingsHandler({
  onApply,
  onOpenDebugger,
  bottomInset,
}: SettingsHandlerProps) {
  const st = useTheme();
  const lorebooks = useAppStore(sto => sto.lorebooks);
  const setLorebooks = useAppStore(sto => sto.setLorebooks);
  const appSettings = useAppStore(sto => sto.appSettings);
  const setAppSettings = useAppStore(sto => sto.setAppSettings);
  const toggleDebugLogging = useAppStore(sto => sto.toggleDebugLogging);
  const applyThemeMode = useAppStore(sto => sto.applyThemeMode);
  const promptConfigVersion = useAppStore(sto => sto.promptConfigVersion);
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
  const [settingsView, setSettingsView] = useState<SettingsView>('main');

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
  const [values, setValues] = useState<Settings>(() => toDraft(appSettings));
  const [promptValues, setPromptValues] = useState<PromptConfig>(
    DEFAULT_PROMPT_CONFIG,
  );
  const [promptSaved, setPromptSaved] = useState<PromptConfig>(
    DEFAULT_PROMPT_CONFIG,
  );
  const [promptLoaded, setPromptLoaded] = useState(false);
  const [lorebookLoading, setLorebookLoading] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState('');
  const [editingPersonaIdx, setEditingPersonaIdx] = useState<number | null>(
    null,
  );
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
    loadPromptConfig().then(cfg => {
      setPromptValues(cfg);
      setPromptSaved(cfg);
      setPromptLoaded(true);
    });
    setActiveProviderId(getActiveProviderId() || '');
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
      await savePromptConfig(cfg);
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
        savePromptConfig(cfg);
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
        savePromptConfig(cfg);
      }
    });
    return () => sub.remove();
  }, []);

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
      converted.forceItalic = draft.forceItalic === 'true';
      converted.dynamicIcon = draft.dynamicIcon === 'true';
      onApply?.(converted as unknown as AppSettings);
    },
    [onApply],
  );

  const handleChange = (key: keyof Settings, text: string) => {
    setValues(prev => {
      const next = { ...prev, [key]: text };
      applyThemeSettings(next);
      return next;
    });
  };

  const handleReset = (key: keyof Settings) => {
    setValues(prev => {
      const next = { ...prev, [key]: defaults[key] };
      applyThemeSettings(next);
      return next;
    });
  };

  const handleShareTheme = useCallback(async () => {
    const url = encodeThemeURL(appSettings);
    Clipboard.setString(url);
    logEvent('theme_shared', {});
    try {
      await Share.share({ message: url });
    } catch {
      Alert.alert('Theme copied', 'Share URL copied to clipboard.');
    }
  }, [appSettings]);

  const handleImportTheme = useCallback(async () => {
    try {
      const clip = await Clipboard.getString();
      const theme = decodeThemeURL(clip);
      if (!theme) {
        Alert.alert(
          'Import theme',
          'No valid Bucket theme URL found on the clipboard. Copy a shared theme URL first.',
        );
        return;
      }
      const updated = applyThemeToSettings(appSettings, theme);
      setAppSettings(updated);
      setValues(toDraft(updated));
      if (updated.dynamicIcon) {
        setIcon(updated.themeMode);
      }
      logEvent('theme_imported', { themeName: theme.name || '' });
      Alert.alert(
        'Theme imported',
        theme.name ? `Applied "${theme.name}".` : 'Theme applied.',
      );
    } catch (e) {
      console.warn('Failed to import theme:', e);
      Alert.alert(
        'Import theme',
        'Could not read a valid theme from the clipboard.',
      );
    }
  }, [appSettings, setAppSettings]);

  const handleLoadLorebook = useCallback(async () => {
    setLorebookLoading(true);
    try {
      const loaded = await loadLorebook();
      if (loaded) {
        const updated = await addLorebook(loaded);
        setLorebooks(updated);
        logEvent('lorebook_imported', {
          entryCount: loaded.entries.length,
          fileNameLen: loaded.fileName.length,
        });
      }
    } catch (e) {
      console.warn('Failed to load lorebook:', e);
    } finally {
      setLorebookLoading(false);
    }
  }, [setLorebooks]);

  const handleRemoveLorebook = useCallback(
    async (id: string) => {
      const lb = lorebooks.find(l => l.id === id);
      const updated = await removeLorebook(id);
      setLorebooks(updated);
      if (lb) {
        logEvent('lorebook_removed', {
          entryCount: lb.entryCount,
          fileNameLen: lb.fileName.length,
        });
      }
    },
    [setLorebooks, lorebooks],
  );

  const handlePickSound = useCallback(async () => {
    try {
      const result = await pick({
        type: [types.audio],
      });
      if (!result || result.length === 0) return;
      const file = result[0];
      if (file.hasRequestedType === false) {
        Alert.alert('Sound Error', 'Please choose an audio file.');
        return;
      }
      const ext = file.name?.match(/\.(\w+)$/)?.[1]?.toLowerCase() || 'm4a';
      const copies = await keepLocalCopy({
        files: [{ uri: file.uri, fileName: `notification_sound.${ext}` }],
        destination: 'documentDirectory',
      });
      const copy = copies[0];
      if (copy.status !== 'success' || !copy.localUri) {
        Alert.alert('Sound Error', 'Could not copy the chosen file.');
        return;
      }
      const updated: AppSettings = {
        ...appSettings,
        notificationSound: copy.localUri,
      };
      setAppSettings(updated);
      playNotificationSound(copy.localUri);
    } catch (e: unknown) {
      if (
        e &&
        typeof e === 'object' &&
        'code' in e &&
        (e as { code: string }).code === 'OPERATION_CANCELED'
      ) {
        return;
      }
      Alert.alert('Sound Error', 'Could not use that file as a notification sound.');
    }
  }, [appSettings, setAppSettings]);

  const handleResetSound = useCallback(() => {
    setAppSettings({ ...appSettings, notificationSound: '' });
  }, [appSettings, setAppSettings]);

  const currentSoundName = useMemo(() => {
    if (!appSettings.notificationSound) return 'System default';
    const name = appSettings.notificationSound.split('/').pop() || '';
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  }, [appSettings.notificationSound]);

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
          { paddingBottom: bottomInset + 60 },
        ]}
      >
        {settingsView === 'main' ? (
          <>
            {MENU_ITEMS.map(item => (
              <TouchableOpacity
                key={item.view}
                style={[st.card, { marginBottom: 10 }]}
                onPress={() => setSettingsView(item.view)}
              >
                <Text style={st.cardTitle}>{item.title}</Text>
                <Text style={st.cardDescription}>{item.description}</Text>
              </TouchableOpacity>
            ))}
          </>
        ) : settingsView === 'customization' ? (
          <>
            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>Theme</Text>
            </View>

            <View style={st.settingsField}>
              <View style={st.settingsToggleRow}>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    appSettings.themeMode === 'dark' && {
                      backgroundColor: appSettings.accentColor,
                    },
                  ]}
                  onPress={() => {
                    applyThemeMode('dark');
                    if (appSettings.dynamicIcon) {
                      setIcon('dark');
                    }
                  }}
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      appSettings.themeMode === 'dark' &&
                        st.settingsToggleTextActive,
                    ]}
                  >
                    Dark
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    appSettings.themeMode === 'light' && {
                      backgroundColor: appSettings.accentColor,
                    },
                  ]}
                  onPress={() => {
                    applyThemeMode('light');
                    if (appSettings.dynamicIcon) {
                      setIcon('light');
                    }
                  }}
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      appSettings.themeMode === 'light' &&
                        st.settingsToggleTextActive,
                    ]}
                  >
                    Light
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Match icon to theme</Text>
              <View style={st.settingsToggleRow}>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    values.dynamicIcon === 'true' && {
                      backgroundColor: values.accentColor,
                    },
                  ]}
                  onPress={() => {
                    const next =
                      values.dynamicIcon === 'true' ? 'false' : 'true';
                    handleChange('dynamicIcon', next);
                    if (next === 'true') {
                      setIcon(values.themeMode);
                    }
                  }}
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      values.dynamicIcon === 'true' &&
                        st.settingsToggleTextActive,
                    ]}
                  >
                    {values.dynamicIcon === 'true' ? 'On' : 'Off'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>Colors</Text>
            </View>

            {CUSTOMIZATION_KEYS.map(key => (
              <View key={key} style={st.settingsField}>
                <Text style={st.settingsLabel}>{LABELS[key]}</Text>
                <TextInput
                  style={st.settingsInput}
                  value={values[key]}
                  onChangeText={text => handleChange(key, text)}
                  placeholder={defaults[key]}
                  placeholderTextColor={st.textMuted.color}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity onPress={() => handleReset(key)}>
                  <Text style={st.settingsDefaultText}>
                    default value: {defaults[key]}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}

            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>Display</Text>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Show character icons</Text>
              <View style={st.settingsToggleRow}>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    values.showCharacterIcons === 'true' && {
                      backgroundColor: values.accentColor,
                    },
                  ]}
                  onPress={() =>
                    handleChange(
                      'showCharacterIcons',
                      values.showCharacterIcons === 'true' ? 'false' : 'true',
                    )
                  }
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      values.showCharacterIcons === 'true' &&
                        st.settingsToggleTextActive,
                    ]}
                  >
                    {values.showCharacterIcons === 'true' ? 'On' : 'Off'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>{LABELS.showGroupCharNames}</Text>
              <Text
                style={{
                  fontSize: 12,
                  color: st.textMuted.color,
                  marginBottom: 8,
                }}
              >
                How group members appear in the chat selector bar.
              </Text>
              <View style={st.settingsToggleRow}>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    appSettings.showGroupCharNames === 'avatar' && {
                      backgroundColor: values.accentColor,
                    },
                  ]}
                  onPress={() => {
                    const updated: AppSettings = {
                      ...appSettings,
                      showGroupCharNames: 'avatar',
                    };
                    setAppSettings(updated);
                  }}
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      appSettings.showGroupCharNames === 'avatar' &&
                        st.settingsToggleTextActive,
                    ]}
                  >
                    Avatar
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    appSettings.showGroupCharNames === 'both' && {
                      backgroundColor: values.accentColor,
                    },
                  ]}
                  onPress={() => {
                    const updated: AppSettings = {
                      ...appSettings,
                      showGroupCharNames: 'both',
                    };
                    setAppSettings(updated);
                  }}
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      appSettings.showGroupCharNames === 'both' &&
                        st.settingsToggleTextActive,
                    ]}
                  >
                    Both
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    appSettings.showGroupCharNames === 'name' && {
                      backgroundColor: values.accentColor,
                    },
                  ]}
                  onPress={() => {
                    const updated: AppSettings = {
                      ...appSettings,
                      showGroupCharNames: 'name',
                    };
                    setAppSettings(updated);
                  }}
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      appSettings.showGroupCharNames === 'name' &&
                        st.settingsToggleTextActive,
                    ]}
                  >
                    Name
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>{LABELS.forceItalic}</Text>
              <Text
                style={{
                  fontSize: 12,
                  color: st.textMuted.color,
                  marginBottom: 8,
                }}
              >
                Skews *italic* text geometrically for fonts without an italic
                face.
              </Text>
              <View style={st.settingsToggleRow}>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    values.forceItalic === 'true' && {
                      backgroundColor: values.accentColor,
                    },
                  ]}
                  onPress={() =>
                    handleChange(
                      'forceItalic',
                      values.forceItalic === 'true' ? 'false' : 'true',
                    )
                  }
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      values.forceItalic === 'true' &&
                        st.settingsToggleTextActive,
                    ]}
                  >
                    {values.forceItalic === 'true' ? 'On' : 'Off'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>Carousel</Text>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>
                {LABELS.carouselAnimMs}
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: st.textMuted.color,
                  marginBottom: 8,
                }}
              >
                How long the message studio carousel takes to appear.
              </Text>
              <TextInput
                style={st.settingsInput}
                value={values.carouselAnimMs}
                onChangeText={text => handleChange('carouselAnimMs', text)}
                placeholder={defaults.carouselAnimMs}
                placeholderTextColor={st.textMuted.color}
                keyboardType="numeric"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={() => handleReset('carouselAnimMs')}>
                <Text style={st.settingsDefaultText}>
                  default value: {defaults.carouselAnimMs}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>Share</Text>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Shareable theme</Text>
              <Text
                style={{
                  fontSize: 12,
                  color: st.textMuted.color,
                  marginBottom: 8,
                }}
              >
                Encode the current colors into a URL you can send to someone
                else.
              </Text>
              <View style={st.settingsToggleRow}>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    { backgroundColor: appSettings.accentColor },
                  ]}
                  onPress={handleShareTheme}
                >
                  <Text
                    style={[st.settingsToggleText, st.settingsToggleTextActive]}
                  >
                    Share
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={st.settingsToggleButton}
                  onPress={handleImportTheme}
                >
                  <Text style={st.settingsToggleText}>
                    Import from clipboard
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        ) : settingsView === 'systemPrompt' ? (
          <>
            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>System Prompt</Text>
            </View>
            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>
                Prefix (start of system message)
              </Text>
              <AutoGrowTextInput
                style={st.settingsInput}
                value={promptValues.prefix}
                onChangeText={text =>
                  setPromptValues(prev => ({ ...prev, prefix: text }))
                }
                placeholder={DEFAULT_PROMPT_CONFIG.prefix}
                placeholderTextColor={st.textMuted.color}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() =>
                  setPromptValues(prev => ({
                    ...prev,
                    prefix: DEFAULT_PROMPT_CONFIG.prefix,
                  }))
                }
              >
                <Text style={st.settingsDefaultText}>reset to default</Text>
              </TouchableOpacity>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>
                Suffix (end of system message)
              </Text>
              <AutoGrowTextInput
                style={st.settingsInput}
                value={promptValues.suffix}
                onChangeText={text =>
                  setPromptValues(prev => ({ ...prev, suffix: text }))
                }
                placeholder={DEFAULT_PROMPT_CONFIG.suffix}
                placeholderTextColor={st.textMuted.color}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() =>
                  setPromptValues(prev => ({
                    ...prev,
                    suffix: DEFAULT_PROMPT_CONFIG.suffix,
                  }))
                }
              >
                <Text style={st.settingsDefaultText}>reset to default</Text>
              </TouchableOpacity>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Available Placeholders</Text>
              <View style={st.settingsPlaceholderList}>
                {PLACEHOLDERS.map(p => (
                  <View key={p.key} style={st.settingsPlaceholderRow}>
                    <Text style={st.settingsPlaceholderKey}>{p.key}</Text>
                    <Text style={st.settingsPlaceholderDesc}>
                      {p.description}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>History Cutoff</Text>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Cutoff Mode</Text>
              <View style={st.settingsToggleRow}>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    promptValues.historyCutoffMode === 'messages' && {
                      backgroundColor: values.accentColor,
                    },
                  ]}
                  onPress={() =>
                    setPromptValues(prev => ({
                      ...prev,
                      historyCutoffMode: 'messages',
                    }))
                  }
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      promptValues.historyCutoffMode === 'messages' &&
                        st.settingsToggleTextActive,
                    ]}
                  >
                    Messages
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    promptValues.historyCutoffMode === 'tokens' && {
                      backgroundColor: values.accentColor,
                    },
                  ]}
                  onPress={() =>
                    setPromptValues(prev => ({
                      ...prev,
                      historyCutoffMode: 'tokens',
                    }))
                  }
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      promptValues.historyCutoffMode === 'tokens' &&
                        st.settingsToggleTextActive,
                    ]}
                  >
                    Tokens
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>
                {promptValues.historyCutoffMode === 'messages'
                  ? 'Max Messages'
                  : 'Max Estimated Tokens'}
              </Text>
              <TextInput
                style={st.settingsInput}
                value={promptValues.historyCutoffAmount}
                onChangeText={text =>
                  setPromptValues(prev => ({
                    ...prev,
                    historyCutoffAmount: text,
                  }))
                }
                placeholder={DEFAULT_PROMPT_CONFIG.historyCutoffAmount}
                placeholderTextColor={st.textMuted.color}
                keyboardType="numeric"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>
                Chat Summarization
              </Text>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Enable Summarization</Text>
              <View style={st.settingsToggleRow}>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    promptValues.summarizationEnabled && {
                      backgroundColor: values.accentColor,
                    },
                  ]}
                  onPress={() =>
                    setPromptValues(prev => ({
                      ...prev,
                      summarizationEnabled: !prev.summarizationEnabled,
                    }))
                  }
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      promptValues.summarizationEnabled &&
                        st.settingsToggleTextActive,
                    ]}
                  >
                    {promptValues.summarizationEnabled ? 'On' : 'Off'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {promptValues.summarizationEnabled && (
              <>
                <View style={st.settingsField}>
                  <Text style={st.settingsLabel}>Token Threshold</Text>
                  <TextInput
                    style={st.settingsInput}
                    value={promptValues.summarizationTokenThreshold}
                    onChangeText={text =>
                      setPromptValues(prev => ({
                        ...prev,
                        summarizationTokenThreshold: text,
                      }))
                    }
                    placeholder={
                      DEFAULT_PROMPT_CONFIG.summarizationTokenThreshold
                    }
                    placeholderTextColor={st.textMuted.color}
                    keyboardType="numeric"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                <View style={st.settingsField}>
                  <Text style={st.settingsLabel}>Max Summaries</Text>
                  <TextInput
                    style={st.settingsInput}
                    value={promptValues.summarizationMaxSummaries}
                    onChangeText={text =>
                      setPromptValues(prev => ({
                        ...prev,
                        summarizationMaxSummaries: text,
                      }))
                    }
                    placeholder={
                      DEFAULT_PROMPT_CONFIG.summarizationMaxSummaries
                    }
                    placeholderTextColor={st.textMuted.color}
                    keyboardType="numeric"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                <View style={st.settingsField}>
                  <Text style={st.settingsLabel}>Summarization Model</Text>
                  <TextInput
                    style={st.settingsInput}
                    value={promptValues.summarizationModel}
                    onChangeText={text =>
                      setPromptValues(prev => ({
                        ...prev,
                        summarizationModel: text,
                      }))
                    }
                    placeholder={
                      DEFAULT_PROMPT_CONFIG.summarizationModel ||
                      'Uses main model'
                    }
                    placeholderTextColor={st.textMuted.color}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </>
            )}
          </>
        ) : settingsView === 'personas' ? (
          <>
            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>User Personas</Text>
              <Text style={st.settingsDefaultText}>
                Create persona profiles to quickly switch your user description.
              </Text>

              {(promptValues.personas ?? []).map((persona, idx) => {
                const isActive = promptValues.activePersonaId === persona.id;
                const isEditing = editingPersonaIdx === idx;
                return (
                  <View key={persona.id} style={{ marginBottom: 10 }}>
                    <TouchableOpacity
                      style={[
                        st.settingsToggleButton,
                        {
                          backgroundColor: isActive
                            ? values.accentColor
                            : 'transparent',
                          padding: 14,
                          alignItems: 'flex-start',
                        },
                      ]}
                      onPress={() => {
                        if (isEditing) {
                          setEditingPersonaIdx(null);
                          return;
                        }
                        setEditingPersonaIdx(idx);
                      }}
                    >
                      <Text
                        style={[
                          st.settingsToggleText,
                          {
                            color: isActive
                              ? values.bgPrimary
                              : values.accentColor,
                            fontWeight: '600',
                          },
                        ]}
                      >
                        {persona.name}
                      </Text>
                      {!isEditing && (
                        <Text
                          style={{
                            color: isActive
                              ? values.bgSecondary
                              : st.textMuted.color,
                            fontSize: 12,
                            marginTop: 2,
                          }}
                          numberOfLines={1}
                        >
                          {persona.description || '(no description)'}
                        </Text>
                      )}
                    </TouchableOpacity>

                    {isEditing && (
                      <View
                        style={{
                          borderWidth: 1,
                          borderColor: values.accentColor,
                          borderRadius: Number(values.cardRadius) || 8,
                          padding: 12,
                          marginTop: 4,
                        }}
                      >
                        <TextInput
                          style={[
                            st.settingsInput,
                            {
                              marginBottom: 8,
                              borderColor: 'transparent',
                              padding: 8,
                            },
                          ]}
                          value={persona.name}
                          onChangeText={text => {
                            setPromptValues(prev =>
                              updatePersona(prev, idx, { name: text }),
                            );
                          }}
                          placeholder="Persona name"
                          placeholderTextColor={st.textMuted.color}
                        />
                        <TextInput
                          style={[
                            st.settingsInput,
                            st.settingsInputMultiline,
                            {
                              borderColor: 'transparent',
                              padding: 8,
                              minHeight: 80,
                            },
                          ]}
                          value={persona.description}
                          onChangeText={text => {
                            setPromptValues(prev =>
                              updatePersona(prev, idx, { description: text }),
                            );
                          }}
                          placeholder="Describe yourself for the AI"
                          placeholderTextColor={st.textMuted.color}
                          multiline
                          blurOnSubmit={false}
                          returnKeyType="default"
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        <View
                          style={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            marginTop: 4,
                          }}
                        >
                          <TouchableOpacity
                            onPress={() => {
                              Alert.alert(
                                'Delete persona',
                                `Delete "${persona.name}"?`,
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  {
                                    text: 'Delete',
                                    style: 'destructive',
                                    onPress: () => {
                                      setPromptValues(prev =>
                                        deletePersona(prev, idx),
                                      );
                                      setEditingPersonaIdx(null);
                                    },
                                  },
                                ],
                              );
                            }}
                          >
                            <Text style={{ color: '#cc3333', fontSize: 13 }}>
                              Delete
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              setPromptValues(prev =>
                                activatePersona(prev, idx),
                              );
                              setEditingPersonaIdx(null);
                            }}
                          >
                            <Text
                              style={{
                                color: values.accentColor,
                                fontSize: 13,
                                fontWeight: '600',
                              }}
                            >
                              {isActive ? 'Active' : 'Use this persona'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}

              <TouchableOpacity
                onPress={() => {
                  const id =
                    Date.now().toString(36) +
                    Math.random().toString(36).slice(2, 6);
                  const newPersona: Persona = {
                    id,
                    name: 'New Persona',
                    description: '',
                  };
                  setPromptValues(prev => addPersona(prev, newPersona));
                  setEditingPersonaIdx((promptValues.personas ?? []).length);
                }}
                disabled={!promptLoaded}
                style={[
                  st.settingsToggleButton,
                  { borderStyle: 'dashed', marginTop: 4 },
                ]}
              >
                <Text style={st.settingsToggleText}>
                  {promptLoaded ? '+ Add Persona' : 'Loading personas...'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        ) : settingsView === 'lorebooks' ? (
          <>
            <TouchableOpacity
              style={st.card}
              onPress={handleLoadLorebook}
              disabled={lorebookLoading}
            >
              <Text style={st.cardTitle}>
                {lorebookLoading ? 'Loading...' : 'Import Lorebook'}
              </Text>
              <Text style={st.cardDescription}>
                Import a .txt file (one fact per line)
              </Text>
            </TouchableOpacity>

            {lorebooks.map(lorebook => (
              <View key={lorebook.id} style={st.settingsLorebookItem}>
                <View style={st.settingsLorebookItemInfo}>
                  <Text style={st.settingsLorebookItemName}>
                    {lorebook.fileName}
                  </Text>
                  <Text style={st.settingsLorebookItemCount}>
                    {lorebook.entryCount} entries
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleRemoveLorebook(lorebook.id)}
                  style={st.settingsLorebookRemoveBtn}
                >
                  <Text style={st.settingsLorebookRemoveBtnText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}

            {lorebooks.length === 0 && (
              <Text style={st.settingsLorebookEmptyText}>
                No lorebooks imported yet.
              </Text>
            )}

            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>RAG Settings</Text>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>
                RAG Model (leave blank to use main model)
              </Text>
              <TextInput
                style={st.settingsInput}
                value={promptValues.ragModel}
                onChangeText={text =>
                  setPromptValues(prev => ({ ...prev, ragModel: text }))
                }
                placeholder="e.g. gpt-4o-mini"
                placeholderTextColor={st.textMuted.color}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>
                Max entries sent to RAG model
              </Text>
              <TextInput
                style={st.settingsInput}
                value={promptValues.ragMaxEntriesToSend}
                onChangeText={text =>
                  setPromptValues(prev => ({
                    ...prev,
                    ragMaxEntriesToSend: text,
                  }))
                }
                placeholder="50"
                placeholderTextColor={st.textMuted.color}
                keyboardType="numeric"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Max relevant facts returned</Text>
              <TextInput
                style={st.settingsInput}
                value={promptValues.ragMaxResults}
                onChangeText={text =>
                  setPromptValues(prev => ({ ...prev, ragMaxResults: text }))
                }
                placeholder="5"
                placeholderTextColor={st.textMuted.color}
                keyboardType="numeric"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </>
        ) : settingsView === 'providers' ? (
          <>
            <ProvidersHandler
              activeProviderId={activeProviderId}
              onSelect={id => {
                setActiveProviderId(id);
                setPromptValues(prev => ({ ...prev, providerId: id }));
              }}
            />

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Model</Text>
              <TextInput
                style={st.settingsInput}
                value={promptValues.model}
                onChangeText={text =>
                  setPromptValues(prev => ({ ...prev, model: text }))
                }
                placeholder={DEFAULT_PROMPT_CONFIG.model}
                placeholderTextColor={st.textMuted.color}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Temperature</Text>
              <TextInput
                style={st.settingsInput}
                value={promptValues.temperature}
                onChangeText={text =>
                  setPromptValues(prev => ({ ...prev, temperature: text }))
                }
                placeholder={DEFAULT_PROMPT_CONFIG.temperature}
                placeholderTextColor={st.textMuted.color}
                keyboardType="decimal-pad"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </>
        ) : settingsView === 'importExport' ? (
          <>
            <ImportExportHandler bottomInset={bottomInset} />
          </>
        ) : settingsView === 'notifications' ? (
          <>
            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Chat completion alert</Text>
              <Text
                style={{
                  fontSize: 12,
                  color: st.textMuted.color,
                  marginBottom: 8,
                }}
              >
                Notify when a message finishes generating.
              </Text>
              <View style={st.settingsToggleRow}>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    appSettings.notificationMode === 'off' && {
                      backgroundColor: values.accentColor,
                    },
                  ]}
                  onPress={() => {
                    const updated: AppSettings = {
                      ...appSettings,
                      notificationMode: 'off',
                    };
                    setAppSettings(updated);
                  }}
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      appSettings.notificationMode === 'off' &&
                        st.settingsToggleTextActive,
                    ]}
                  >
                    Off
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    appSettings.notificationMode === 'vibrate' && {
                      backgroundColor: values.accentColor,
                    },
                  ]}
                  onPress={() => {
                    const updated: AppSettings = {
                      ...appSettings,
                      notificationMode: 'vibrate',
                    };
                    setAppSettings(updated);
                  }}
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      appSettings.notificationMode === 'vibrate' &&
                        st.settingsToggleTextActive,
                    ]}
                  >
                    Vibrate
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    appSettings.notificationMode === 'sound' && {
                      backgroundColor: values.accentColor,
                    },
                  ]}
                  onPress={() => {
                    const updated: AppSettings = {
                      ...appSettings,
                      notificationMode: 'sound',
                    };
                    setAppSettings(updated);
                  }}
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      appSettings.notificationMode === 'sound' &&
                        st.settingsToggleTextActive,
                    ]}
                  >
                    Sound
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    appSettings.notificationMode === 'both' && {
                      backgroundColor: values.accentColor,
                    },
                  ]}
                  onPress={() => {
                    const updated: AppSettings = {
                      ...appSettings,
                      notificationMode: 'both',
                    };
                    setAppSettings(updated);
                  }}
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      appSettings.notificationMode === 'both' &&
                        st.settingsToggleTextActive,
                    ]}
                  >
                    Both
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>
                {LABELS.notificationSound}
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: st.textMuted.color,
                  marginBottom: 8,
                }}
              >
                Sound played when a message finishes generating.
              </Text>
              <Text style={st.settingsDefaultText}>
                Current: {currentSoundName}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <TouchableOpacity
                  style={st.settingsToggleButton}
                  onPress={handlePickSound}
                >
                  <Text style={st.settingsToggleText}>
                    Choose sound file...
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    { flex: 0 },
                    !appSettings.notificationSound && { opacity: 0.4 },
                  ]}
                  onPress={() =>
                    playNotificationSound(
                      appSettings.notificationSound || null,
                    )
                  }
                  disabled={!appSettings.notificationSound}
                >
                  <Text style={st.settingsToggleText}>Test</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    { flex: 0 },
                    !appSettings.notificationSound && { opacity: 0.4 },
                  ]}
                  onPress={handleResetSound}
                  disabled={!appSettings.notificationSound}
                >
                  <Text style={st.settingsToggleText}>Default</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        ) : (
          <>
            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Activity logging</Text>
              <Text
                style={{
                  fontSize: 12,
                  color: st.textMuted.color,
                  marginBottom: 8,
                }}
              >
                Logs user actions (no personal data). View in the debugger with
                the 'activity' command.
              </Text>
              <View style={st.settingsToggleRow}>
                <TouchableOpacity
                  style={[
                    st.settingsToggleButton,
                    appSettings.debugLogging && {
                      backgroundColor: values.accentColor,
                    },
                  ]}
                  onPress={() => toggleDebugLogging()}
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      appSettings.debugLogging && st.settingsToggleTextActive,
                    ]}
                  >
                    {appSettings.debugLogging ? 'On' : 'Off'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity style={st.card} onPress={onOpenDebugger}>
              <Text style={st.cardTitle}>Open Debugger</Text>
              <Text style={st.cardDescription}>
                CLI for testing prompts, API calls, and storage
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

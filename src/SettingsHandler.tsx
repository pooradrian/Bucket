import {useEffect, useState, useCallback, useRef, useMemo} from 'react';
import {Alert, ScrollView, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {
  Persona,
  PromptConfig,
  DEFAULT_PROMPT_CONFIG,
  PLACEHOLDERS,
  loadPromptConfig,
  savePromptConfig,
} from './PromptHandler';
import {loadLorebook, addLorebook, removeLorebook} from './RAGHandler';
import {getActiveProviderId} from './SecureStore';
import ProvidersHandler from './ProvidersHandler';
import ImportExportHandler from './ImportExportHandler';
import {useAppStore, AppSettings, DEFAULT_APP_SETTINGS, getThemePreset} from './store';
import {setIcon} from './IconModule';
import {useTheme} from './ThemeContext';

type Settings = Omit<Record<keyof AppSettings, string>, 'themeMode'> & {themeMode: 'dark' | 'light'};
const SETTINGS_KEYS: Exclude<keyof Settings, 'themeMode'>[] = [
  'bgPrimary', 'bgSecondary', 'bgPill', 'borderPrimary',
  'textPrimary', 'textSecondary', 'textMuted',
  'cardRadius', 'pillRadius', 'bubbleRadius', 'inputRadius',
  'chatMaxWidth', 'fontSizeBody', 'fontSizeHeader', 'fontSizeTab',
  'bottomBarPad', 'sideBtnSize', 'sendBtnSize',
  'accentColor', 'userBubbleBg', 'showCharacterIcons', 'dynamicIcon',
];

function toDraft(s: AppSettings): Settings {
  const draft = {} as Settings;
  for (const k of SETTINGS_KEYS) {
    draft[k] = String(s[k]);
  }
  draft.themeMode = s.themeMode;
  return draft;
}

const LABELS: Record<Exclude<keyof Settings, 'themeMode'>, string> = {
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

const CUSTOMIZATION_KEYS: Exclude<keyof Settings, 'themeMode'>[] = [
  'bgPrimary', 'bgSecondary', 'bgPill', 'borderPrimary',
  'textPrimary', 'textSecondary', 'textMuted',
  'cardRadius', 'pillRadius', 'bubbleRadius', 'inputRadius',
  'chatMaxWidth', 'fontSizeBody', 'fontSizeHeader', 'fontSizeTab',
  'bottomBarPad', 'sideBtnSize', 'sendBtnSize',
  'accentColor', 'userBubbleBg',
];


interface SettingsHandlerProps {
  onApply?: (settings: AppSettings) => void;
  onOpenDebugger?: () => void;
  bottomInset: number;
}

const NUMERIC_KEYS: Exclude<keyof Settings, 'themeMode' | 'showCharacterIcons'>[] = [
  'cardRadius', 'pillRadius', 'bubbleRadius', 'inputRadius',
  'chatMaxWidth', 'fontSizeBody', 'fontSizeHeader', 'fontSizeTab',
  'bottomBarPad', 'sideBtnSize', 'sendBtnSize',
];

export default function SettingsHandler({onApply, onOpenDebugger, bottomInset}: SettingsHandlerProps) {
  const st = useTheme();
  const lorebooks = useAppStore(sto => sto.lorebooks);
  const setLorebooks = useAppStore(sto => sto.setLorebooks);
  const appSettings = useAppStore(sto => sto.appSettings);
  const applyThemeMode = useAppStore(sto => sto.applyThemeMode);
  const [settingsView, setSettingsView] = useState<'main' | 'customization'>('main');
  const [values, setValues] = useState<Settings>(() => toDraft(appSettings));
  const [promptValues, setPromptValues] = useState<PromptConfig>(DEFAULT_PROMPT_CONFIG);
  const [promptSaved, setPromptSaved] = useState<PromptConfig>(DEFAULT_PROMPT_CONFIG);
  const [lorebookLoading, setLorebookLoading] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState('');
  const [editingPersonaIdx, setEditingPersonaIdx] = useState<number | null>(null);
  const promptSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  const defaults = useMemo(() => {
    const mode = values.themeMode;
    return toDraft({...DEFAULT_APP_SETTINGS, ...getThemePreset(mode)} as AppSettings);
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
    });
    setActiveProviderId(getActiveProviderId() || '');
  }, []);

  useEffect(() => {
    if (!mountedRef.current) return;
    if (JSON.stringify(promptValues) === JSON.stringify(promptSaved)) return;
    if (promptSaveTimerRef.current) clearTimeout(promptSaveTimerRef.current);
    promptSaveTimerRef.current = setTimeout(async () => {
      await savePromptConfig(promptValues);
      setPromptSaved(promptValues);
    }, 500);
    return () => { if (promptSaveTimerRef.current) clearTimeout(promptSaveTimerRef.current); };
  }, [promptValues, promptSaved]);

  const applyThemeSettings = useCallback((draft: Settings) => {
    const converted: Record<string, unknown> = {...draft};
    for (const k of NUMERIC_KEYS) {
      converted[k] = Number(converted[k]);
      if (isNaN(converted[k] as number)) {
        converted[k] = (DEFAULT_APP_SETTINGS as unknown as Record<string, unknown>)[k];
      }
    }
    converted.showCharacterIcons = draft.showCharacterIcons === 'true';
    converted.dynamicIcon = draft.dynamicIcon === 'true';
    onApply?.(converted as unknown as AppSettings);
  }, [onApply]);

  const handleChange = (key: keyof Settings, text: string) => {
    setValues(prev => {
      const next = {...prev, [key]: text};
      applyThemeSettings(next);
      return next;
    });
  };

  const handleReset = (key: keyof Settings) => {
    setValues(prev => {
      const next = {...prev, [key]: defaults[key]};
      applyThemeSettings(next);
      return next;
    });
  };

  const handleLoadLorebook = useCallback(async () => {
    setLorebookLoading(true);
    try {
      const loaded = await loadLorebook();
      if (loaded) {
        const updated = await addLorebook(loaded);
        setLorebooks(updated);
      }
    } catch (e) {
      console.warn('Failed to load lorebook:', e);
    } finally {
      setLorebookLoading(false);
    }
  }, [setLorebooks]);

  const handleRemoveLorebook = useCallback(async (id: string) => {
    const updated = await removeLorebook(id);
    setLorebooks(updated);
  }, [setLorebooks]);

  return (
    <View style={st.settingsContainer}>
      <View style={st.settingsHeader}>
        {settingsView === 'customization' && (
          <TouchableOpacity onPress={() => setSettingsView('main')} style={st.settingsBackBtn}>
            <Text style={st.settingsBackBtnText}>{'‹ Back'}</Text>
          </TouchableOpacity>
        )}
        <Text style={st.settingsHeaderName}>
          {settingsView === 'customization' ? 'Customization' : 'Settings'}
        </Text>
      </View>
      <ScrollView contentContainerStyle={[st.settingsContent, {paddingBottom: bottomInset + 60}]}>
        {settingsView === 'customization' ? (
          <>
            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>Theme</Text>
            </View>

            <View style={st.settingsField}>
              <View style={st.settingsToggleRow}>
                <TouchableOpacity
                  style={[st.settingsToggleButton, appSettings.themeMode === 'dark' && {backgroundColor: appSettings.accentColor}]}
                  onPress={() => {
                    applyThemeMode('dark');
                    if (appSettings.dynamicIcon) { setIcon('dark'); }
                  }}>
                  <Text style={[st.settingsToggleText, appSettings.themeMode === 'dark' && st.settingsToggleTextActive]}>
                    Dark
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.settingsToggleButton, appSettings.themeMode === 'light' && {backgroundColor: appSettings.accentColor}]}
                  onPress={() => {
                    applyThemeMode('light');
                    if (appSettings.dynamicIcon) { setIcon('light'); }
                  }}>
                  <Text style={[st.settingsToggleText, appSettings.themeMode === 'light' && st.settingsToggleTextActive]}>
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
                    const next = values.dynamicIcon === 'true' ? 'false' : 'true';
                    handleChange('dynamicIcon', next);
                    if (next === 'true') {
                      setIcon(values.themeMode);
                    }
                  }}>
                  <Text
                    style={[
                      st.settingsToggleText,
                      values.dynamicIcon === 'true' && st.settingsToggleTextActive,
                    ]}>
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
                  <Text style={st.settingsDefaultText}>default value: {defaults[key]}</Text>
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
                    handleChange('showCharacterIcons', values.showCharacterIcons === 'true' ? 'false' : 'true')
                  }>
                  <Text
                    style={[
                      st.settingsToggleText,
                      values.showCharacterIcons === 'true' && st.settingsToggleTextActive,
                    ]}>
                    {values.showCharacterIcons === 'true' ? 'On' : 'Off'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={st.card}
              onPress={() => setSettingsView('customization')}>
              <Text style={st.cardTitle}>
                Customization
              </Text>
              <Text style={st.cardDescription}>
                Colors, fonts, sizes, and display options
              </Text>
            </TouchableOpacity>

            {/* Prompt Settings */}
            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>System Prompt</Text>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Prefix (start of system message)</Text>
              <TextInput
                style={[st.settingsInput, st.settingsInputMultiline]}
                value={promptValues.prefix}
                onChangeText={text => setPromptValues(prev => ({...prev, prefix: text}))}
                placeholder={DEFAULT_PROMPT_CONFIG.prefix}
                placeholderTextColor={st.textMuted.color}
                multiline
                textAlignVertical="top"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() => setPromptValues(prev => ({...prev, prefix: DEFAULT_PROMPT_CONFIG.prefix}))}>
                <Text style={st.settingsDefaultText}>reset to default</Text>
              </TouchableOpacity>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Suffix (end of system message)</Text>
              <TextInput
                style={[st.settingsInput, st.settingsInputMultiline]}
                value={promptValues.suffix}
                onChangeText={text => setPromptValues(prev => ({...prev, suffix: text}))}
                placeholder={DEFAULT_PROMPT_CONFIG.suffix}
                placeholderTextColor={st.textMuted.color}
                multiline
                textAlignVertical="top"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() => setPromptValues(prev => ({...prev, suffix: DEFAULT_PROMPT_CONFIG.suffix}))}>
                <Text style={st.settingsDefaultText}>reset to default</Text>
              </TouchableOpacity>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>User Personas</Text>
              <Text style={st.settingsDefaultText}>
                Create persona profiles to quickly switch your user description.
              </Text>

              {(promptValues.personas ?? []).map((persona, idx) => {
                const isActive = promptValues.activePersonaId === persona.id;
                const isEditing = editingPersonaIdx === idx;
                return (
                  <View key={persona.id} style={{marginBottom: 10}}>
                    <TouchableOpacity
                      style={[
                        st.settingsToggleButton,
                        {
                          backgroundColor: isActive ? values.accentColor : 'transparent',
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
                      }}>
                      <Text style={[
                        st.settingsToggleText,
                        {color: isActive ? values.bgPrimary : values.accentColor, fontWeight: '600'},
                      ]}>
                        {persona.name}
                      </Text>
                      {!isEditing && (
                        <Text style={{
                          color: isActive ? values.bgSecondary : st.textMuted.color,
                          fontSize: 12,
                          marginTop: 2,
                        }} numberOfLines={1}>
                          {persona.description || '(no description)'}
                        </Text>
                      )}
                    </TouchableOpacity>

                    {isEditing && (
                      <View style={{
                        borderWidth: 1,
                        borderColor: values.accentColor,
                        borderRadius: Number(values.cardRadius) || 8,
                        padding: 12,
                        marginTop: 4,
                      }}>
                        <TextInput
                          style={[st.settingsInput, {marginBottom: 8, borderColor: 'transparent', padding: 8}]}
                          value={persona.name}
                          onChangeText={text => {
                            const personas = [...(promptValues.personas ?? [])];
                            personas[idx] = {...personas[idx], name: text};
                            setPromptValues(prev => ({...prev, personas}));
                          }}
                          placeholder="Persona name"
                          placeholderTextColor={st.textMuted.color}
                        />
                        <TextInput
                          style={[st.settingsInput, st.settingsInputMultiline, {borderColor: 'transparent', padding: 8, minHeight: 80}]}
                          value={persona.description}
                          onChangeText={text => {
                            const personas = [...(promptValues.personas ?? [])];
                            personas[idx] = {...personas[idx], description: text};
                            setPromptValues(prev => ({...prev, personas}));
                          }}
                          placeholder="Describe yourself for the AI"
                          placeholderTextColor={st.textMuted.color}
                          multiline
                          blurOnSubmit={false}
                          returnKeyType="default"
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 4}}>
                          <TouchableOpacity
                            onPress={() => {
                              Alert.alert('Delete persona', `Delete "${persona.name}"?`, [
                                {text: 'Cancel', style: 'cancel'},
                                {
                                  text: 'Delete', style: 'destructive',
                                  onPress: () => {
                                    const personas = promptValues.personas.filter((_, i) => i !== idx);
                                    const activePersonaId = promptValues.activePersonaId === persona.id
                                      ? null : promptValues.activePersonaId;
                                    setPromptValues(prev => ({
                                      ...prev, personas, activePersonaId,
                                      userDescription: activePersonaId
                                        ? prev.userDescription
                                        : (personas[0]?.description ?? ''),
                                    }));
                                    setEditingPersonaIdx(null);
                                  },
                                },
                              ]);
                            }}>
                            <Text style={{color: '#cc3333', fontSize: 13}}>Delete</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              setPromptValues(prev => ({
                                ...prev,
                                activePersonaId: persona.id,
                                userDescription: persona.description,
                              }));
                              setEditingPersonaIdx(null);
                            }}>
                            <Text style={{color: values.accentColor, fontSize: 13, fontWeight: '600'}}>
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
                  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                  const newPersona: Persona = {id, name: 'New Persona', description: ''};
                  const personas = [...(promptValues.personas ?? []), newPersona];
                  setPromptValues(prev => ({...prev, personas}));
                  setEditingPersonaIdx(personas.length - 1);
                }}
                style={[st.settingsToggleButton, {borderStyle: 'dashed', marginTop: 4}]}>
                <Text style={st.settingsToggleText}>+ Add Persona</Text>
              </TouchableOpacity>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Available Placeholders</Text>
              <View style={st.settingsPlaceholderList}>
                {PLACEHOLDERS.map(p => (
                  <View key={p.key} style={st.settingsPlaceholderRow}>
                    <Text style={st.settingsPlaceholderKey}>{p.key}</Text>
                    <Text style={st.settingsPlaceholderDesc}>{p.description}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* History Cutoff */}
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
                    setPromptValues(prev => ({...prev, historyCutoffMode: 'messages'}))
                  }>
                  <Text
                    style={[
                      st.settingsToggleText,
                      promptValues.historyCutoffMode === 'messages' && st.settingsToggleTextActive,
                    ]}>
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
                    setPromptValues(prev => ({...prev, historyCutoffMode: 'tokens'}))
                  }>
                  <Text
                    style={[
                      st.settingsToggleText,
                      promptValues.historyCutoffMode === 'tokens' && st.settingsToggleTextActive,
                    ]}>
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
                onChangeText={text => setPromptValues(prev => ({...prev, historyCutoffAmount: text}))}
                placeholder={DEFAULT_PROMPT_CONFIG.historyCutoffAmount}
                placeholderTextColor={st.textMuted.color}
                keyboardType="numeric"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Chat Summarization */}
            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>Chat Summarization</Text>
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
                    setPromptValues(prev => ({...prev, summarizationEnabled: !prev.summarizationEnabled}))
                  }>
                  <Text
                    style={[
                      st.settingsToggleText,
                      promptValues.summarizationEnabled && st.settingsToggleTextActive,
                    ]}>
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
                    onChangeText={text => setPromptValues(prev => ({...prev, summarizationTokenThreshold: text}))}
                    placeholder={DEFAULT_PROMPT_CONFIG.summarizationTokenThreshold}
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
                    onChangeText={text => setPromptValues(prev => ({...prev, summarizationMaxSummaries: text}))}
                    placeholder={DEFAULT_PROMPT_CONFIG.summarizationMaxSummaries}
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
                    onChangeText={text => setPromptValues(prev => ({...prev, summarizationModel: text}))}
                    placeholder={DEFAULT_PROMPT_CONFIG.summarizationModel || 'Uses main model'}
                    placeholderTextColor={st.textMuted.color}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </>
            )}

            {/* Lorebook / RAG */}
            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>Lorebooks</Text>
            </View>

            <TouchableOpacity
              style={st.card}
              onPress={handleLoadLorebook}
              disabled={lorebookLoading}>
              <Text style={st.cardTitle}>
                {lorebookLoading ? 'Loading...' : 'Import Lorebook'}
              </Text>
              <Text style={st.cardDescription}>
                Import a .txt file (one fact per line)
              </Text>
            </TouchableOpacity>

            {lorebooks.map(lorebook => (
              <View
                key={lorebook.id}
                style={st.settingsLorebookItem}>
                <View style={st.settingsLorebookItemInfo}>
                  <Text style={st.settingsLorebookItemName}>
                    {lorebook.fileName}
                  </Text>
                  <Text style={st.settingsLorebookItemCount}>
                    {lorebook.entries.length} entries
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleRemoveLorebook(lorebook.id)}
                  style={st.settingsLorebookRemoveBtn}>
                  <Text style={st.settingsLorebookRemoveBtnText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}

            {lorebooks.length === 0 && (
              <Text style={st.settingsLorebookEmptyText}>
                No lorebooks imported yet.
              </Text>
            )}

            {/* RAG Settings */}
            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>RAG Settings</Text>
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>RAG Model (leave blank to use main model)</Text>
              <TextInput
                style={st.settingsInput}
                value={promptValues.ragModel}
                onChangeText={text => setPromptValues(prev => ({...prev, ragModel: text}))}
                placeholder="e.g. gpt-4o-mini"
                placeholderTextColor={st.textMuted.color}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Max entries sent to RAG model</Text>
              <TextInput
                style={st.settingsInput}
                value={promptValues.ragMaxEntriesToSend}
                onChangeText={text => setPromptValues(prev => ({...prev, ragMaxEntriesToSend: text}))}
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
                onChangeText={text => setPromptValues(prev => ({...prev, ragMaxResults: text}))}
                placeholder="5"
                placeholderTextColor={st.textMuted.color}
                keyboardType="numeric"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Providers */}
            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>Providers</Text>
            </View>

            <ProvidersHandler
              activeProviderId={activeProviderId}
              onSelect={(id) => {
                setActiveProviderId(id);
                setPromptValues(prev => ({...prev, providerId: id}));
              }}
            />

            <View style={st.settingsField}>
              <Text style={st.settingsLabel}>Model</Text>
              <TextInput
                style={st.settingsInput}
                value={promptValues.model}
                onChangeText={text => setPromptValues(prev => ({...prev, model: text}))}
                placeholder={DEFAULT_PROMPT_CONFIG.model}
                placeholderTextColor={st.textMuted.color}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Import / Export */}
            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>Import / Export</Text>
            </View>

            <ImportExportHandler bottomInset={bottomInset} />

            {/* Debugger */}
            <View style={st.settingsSectionHeader}>
              <Text style={st.settingsSectionHeaderText}>Developer</Text>
            </View>

            <TouchableOpacity
              style={st.card}
              onPress={onOpenDebugger}>
              <Text style={st.cardTitle}>
                Open Debugger
              </Text>
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

import {getKV, setKV} from './Database';
import {Character} from './CharacterEditor';
import {getCustomField} from './CustomFields';
import {ChatMessage} from './useChat';
import {LorebookState, RAGConfig, retrieveRelevantLorebook, buildRAGInjection} from './RAGHandler';
import {getActiveProviderId, getProviderKey, getProviders} from './SecureStore';
import {getAIResponse, RawRequest} from './Endpoint';
import {encodingForModel} from 'js-tiktoken';

const PROMPT_CONFIG_KEY = 'promptConfig';

export interface ChatMessageObject {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TimingMetrics {
  promptBuildMs: number;
  ttfbMs: number;
  bodyReadMs: number;
  totalMs: number;
}

export interface Persona {
  id: string;
  name: string;
  description: string;
}

export interface ModelPreset {
  id: string;
  model: string;
  prefix: string;
  suffix: string;
  temperature: string;
}

export interface PromptConfig {
  prefix: string;
  suffix: string;
  quickCharacterPrompt: string;
  userDescription: string;
  personas: Persona[];
  activePersonaId: string | null;
  modelPresets: ModelPreset[];
  activeModelPresetId: string | null;
  historyCutoffMode: 'tokens' | 'messages';
  historyCutoffAmount: string;
  providerId: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  temperature: string;
  ragModel: string;
  ragEnabled: boolean;
  ragMaxEntriesToSend: string;
  ragMaxResults: string;
  summarizationEnabled: boolean;
  summarizationTokenThreshold: string;
  summarizationMaxSummaries: string;
  summarizationModel: string;
  wordDisplacements: string;
  extraBody: string;
}

export const DEFAULT_QUICK_CHARACTER_PROMPT = `You are roleplaying as $QUICKCHARNAME$.

Write this reply as $QUICKCHARNAME$ and nobody else:
- $QUICKCHARNAME$ is a quick character of $CHARNAME$, the base character described below. The base character is context only, never write as them.
- Do not imitate, continue or switch to any other character's voice, no matter who spoke earlier in the conversation.
- Do not write dialogue, actions or thoughts for the user.
- Stay in $QUICKCHARNAME$'s personality and voice from the first word to the last.

$USRDESC$

$QUICKCHARBLOCK$

$CHARBLOCK$`;

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  prefix: `You are a roleplay companion.
$USRDESC$
$GROUPINSTRUCTION$

$CHARBLOCK$

$LOREBOOK$`,
  suffix: 'Now write the next message as $QUICKCHARNAME$.',
  quickCharacterPrompt: DEFAULT_QUICK_CHARACTER_PROMPT,
  userDescription: '',
  personas: [],
  activePersonaId: null,
  modelPresets: [],
  activeModelPresetId: null,
  historyCutoffMode: 'messages',
  historyCutoffAmount: '20',
  providerId: '',
  apiUrl: '',
  apiKey: '',
  model: 'gpt-4o',
  temperature: '1',
  ragModel: '',
  ragEnabled: false,
  ragMaxEntriesToSend: '50',
  ragMaxResults: '5',
  summarizationEnabled: false,
  summarizationTokenThreshold: '4000',
  summarizationMaxSummaries: '3',
  summarizationModel: '',
  wordDisplacements: '',
  extraBody: '',
};

export interface Placeholder {
  group: string;
  key: string;
  description: string;
}

export const PLACEHOLDERS: Placeholder[] = [
  {group: 'Base character', key: '$CHARNAME$', description: 'Base character name'},
  {group: 'Base character', key: '$CHARDESC$', description: 'Base character description'},
  {group: 'Base character', key: '$CHARPERSONALITY$', description: 'Base character personality traits'},
  {group: 'Base character', key: '$CHARWRITINGSTYLE$', description: 'Base character writing style'},
  {group: 'Base character', key: '$CHARSCENARIO$', description: 'Base character scenario / setting'},
  {group: 'Base character', key: '$CHAREXAMPLES$', description: 'Base character example messages'},
  {group: 'Base character', key: '$CHARBLOCK$', description: 'Every base character field above as one block. In a group chat, every group member'},
  {group: 'Quick character', key: '$QUICKCHARNAME$', description: 'Quick character name. Same as $CHARNAME$ when no quick character is selected'},
  {group: 'Quick character', key: '$QUICKCHARDESC$', description: 'Quick character description. Same as $CHARDESC$ when no quick character is selected'},
  {group: 'Quick character', key: '$QUICKCHARPERSONALITY$', description: 'Quick character personality traits. Same as $CHARPERSONALITY$ when no quick character is selected'},
  {group: 'Quick character', key: '$QUICKCHARBLOCK$', description: 'Quick character name, description and personality as one block. Empty when no quick character is selected'},
  {group: 'Conversation', key: '$USRDESC$', description: 'Your active persona / user description. Empty when you have none'},
  {group: 'Conversation', key: '$LOREBOOK$', description: 'RAG-retrieved lorebook entries for this message. Empty when RAG is off or finds nothing'},
  {group: 'Conversation', key: '$GROUPINSTRUCTION$', description: 'Who is speaking in a group chat and who to write as. Empty outside group chats'},
  {group: 'Old names, still supported', key: '$PERSONALITY$', description: 'Same as $CHARPERSONALITY$'},
  {group: 'Old names, still supported', key: '$WRITINGSTYLE$', description: 'Same as $CHARWRITINGSTYLE$'},
  {group: 'Old names, still supported', key: '$SCENARIO$', description: 'Same as $CHARSCENARIO$'},
  {group: 'Old names, still supported', key: '$EXAMPLES$', description: 'Same as $CHAREXAMPLES$'},
];

export interface QuickCharacterFields {
  id: string;
  name: string;
  description: string;
  personality: string;
}

export async function resolveProvider(config: PromptConfig): Promise<PromptConfig> {
  const providerId = config.providerId || getActiveProviderId();
  if (!providerId) {
    return {...config, apiUrl: '', apiKey: ''};
  }
  const providers = getProviders();
  const provider = providers.find(p => p.id === providerId);
  if (!provider) {
    return {...config, apiUrl: '', apiKey: ''};
  }
  const apiKey = await getProviderKey(providerId);
  return {...config, providerId, apiUrl: provider.url, apiKey: apiKey || ''};
}

const PROMPT_MIGRATED_KEY = 'promptConfigMigrated';

const LEGACY_PREFIX = 'You are a roleplay companion.';

const LEGACY_SUFFIX = 'Now write the next message as the assistant.';

const PREVIOUS_QUICK_CHARACTER_PROMPT = `You are roleplaying as $QUICKCHARNAME$.

Write this reply as $QUICKCHARNAME$ and nobody else:
- $QUICKCHARNAME$ is a persona of $CHARNAME$, the base character described below. The base character is context only, never write as them.
- Do not imitate, continue or switch to any other character's voice, no matter who spoke earlier in the conversation.
- Do not write dialogue, actions or thoughts for the user.
- Stay in $QUICKCHARNAME$'s personality and voice from the first word to the last.

$USRDESC$

$QUICKCHARBLOCK$

$CHARBLOCK$`;

const LEGACY_QUICK_CHARACTER_PROMPT = `You are roleplaying as $CHARNAME$.

Write this reply as $CHARNAME$ and nobody else:
- $CHARNAME$ is a persona of the base character described below. The base character is context only, never write as them.
- Do not imitate, continue or switch to any other character's voice, no matter who spoke earlier in the conversation.
- Do not write dialogue, actions or thoughts for the user.
- Stay in $CHARNAME$'s personality and voice from the first word to the last.`;

function migratePromptConfig(config: PromptConfig): boolean {
  let changed = false;
  if (config.suffix === LEGACY_SUFFIX) {
    config.suffix = DEFAULT_PROMPT_CONFIG.suffix;
    changed = true;
  }
  if (config.quickCharacterPrompt === PREVIOUS_QUICK_CHARACTER_PROMPT) {
    config.quickCharacterPrompt = DEFAULT_QUICK_CHARACTER_PROMPT;
    changed = true;
  }
  if (config.prefix === LEGACY_PREFIX) {
    config.prefix = DEFAULT_PROMPT_CONFIG.prefix;
    changed = true;
  }
  const qc = config.quickCharacterPrompt;
  const corrupted = [
    '- $QUICKCHARNAME$ is a persona of $QUICKCHARNAME$',
    '- $QUICKCHARNAME$ is a quick character of $QUICKCHARNAME$',
  ];
  let repaired = false;
  if (typeof qc === 'string' && corrupted.some(c => qc.includes(c))) {
    config.quickCharacterPrompt = qc
      .split('- $QUICKCHARNAME$ is a persona of $QUICKCHARNAME$,')
      .join('- $QUICKCHARNAME$ is a quick character of $CHARNAME$,')
      .split('- $QUICKCHARNAME$ is a quick character of $QUICKCHARNAME$,')
      .join('- $QUICKCHARNAME$ is a quick character of $CHARNAME$,');
    changed = true;
    repaired = true;
  }
  if (getKV(PROMPT_MIGRATED_KEY)) return changed;
  setKV(PROMPT_MIGRATED_KEY, '1');
  if (typeof qc === 'string' && !repaired) {
    const migrated =
      qc === LEGACY_QUICK_CHARACTER_PROMPT
        ? DEFAULT_QUICK_CHARACTER_PROMPT
        : qc.includes('$QUICKCHAR')
          ? qc
          : qc
              .split('$CHARNAME$').join('$QUICKCHARNAME$')
              .split('$PERSONALITY$').join('$QUICKCHARPERSONALITY$');
    if (migrated !== qc) {
      config.quickCharacterPrompt = migrated;
      changed = true;
    }
  }
  return changed;
}

export async function loadPromptConfig(): Promise<PromptConfig> {
  try {
    const stored = getKV(PROMPT_CONFIG_KEY);
    if (stored) {
      const config: PromptConfig = {...DEFAULT_PROMPT_CONFIG, ...JSON.parse(stored)};
      const migrated = migratePromptConfig(config);
      const withProvider = await resolveProvider(config);
      if (migrated) await savePromptConfig(withProvider);
      return withProvider;
    }
  } catch (e) {
    console.warn('Failed to load prompt config:', e);
  }
  const defaults = {...DEFAULT_PROMPT_CONFIG};
  const activeId = getActiveProviderId();
  if (activeId) {
    defaults.providerId = activeId;
    return resolveProvider(defaults);
  }
  return defaults;
}

export async function savePromptConfig(config: PromptConfig): Promise<void> {
  try {
    const toStore = Object.fromEntries(
      Object.entries(config).filter(([k]) => k !== 'apiUrl' && k !== 'apiKey'),
    );
    setKV(PROMPT_CONFIG_KEY, JSON.stringify(toStore));
  } catch (e) {
    console.warn('Failed to save prompt config:', e);
  }
}

export function addPersona(config: PromptConfig, persona: Persona): PromptConfig {
  return {...config, personas: [...(config.personas ?? []), persona]};
}

export function updatePersona(
  config: PromptConfig,
  idx: number,
  patch: Partial<Pick<Persona, 'name' | 'description'>>,
): PromptConfig {
  const personas = [...(config.personas ?? [])];
  if (personas[idx]) {
    personas[idx] = {...personas[idx], ...patch};
  }
  return {...config, personas};
}

export function deletePersona(config: PromptConfig, idx: number): PromptConfig {
  const personas = (config.personas ?? []).filter((_, i) => i !== idx);
  const deleted = config.personas?.[idx];
  const activePersonaId =
    deleted && config.activePersonaId === deleted.id ? null : config.activePersonaId;
  return {
    ...config,
    personas,
    activePersonaId,
    userDescription: activePersonaId ? config.userDescription : (personas[0]?.description ?? ''),
  };
}

export function activatePersona(config: PromptConfig, idx: number): PromptConfig {
  const persona = config.personas?.[idx];
  if (!persona) return config;
  return {...config, activePersonaId: persona.id, userDescription: persona.description};
}

export function addModelPreset(config: PromptConfig, preset: ModelPreset): PromptConfig {
  return {...config, modelPresets: [...(config.modelPresets ?? []), preset]};
}

export function updateModelPreset(
  config: PromptConfig,
  idx: number,
  patch: Partial<Pick<ModelPreset, 'model' | 'prefix' | 'suffix' | 'temperature'>>,
): PromptConfig {
  const modelPresets = [...(config.modelPresets ?? [])];
  if (!modelPresets[idx]) return config;
  modelPresets[idx] = {...modelPresets[idx], ...patch};
  const next = {...config, modelPresets};
  if (modelPresets[idx].id === config.activeModelPresetId) {
    next.model = modelPresets[idx].model;
    next.prefix = modelPresets[idx].prefix;
    next.suffix = modelPresets[idx].suffix;
    next.temperature = modelPresets[idx].temperature;
  }
  return next;
}

export function deleteModelPreset(config: PromptConfig, idx: number): PromptConfig {
  const modelPresets = (config.modelPresets ?? []).filter((_, i) => i !== idx);
  const deleted = config.modelPresets?.[idx];
  return {
    ...config,
    modelPresets,
    activeModelPresetId:
      deleted && config.activeModelPresetId === deleted.id ? null : config.activeModelPresetId,
  };
}

export function applyModelPreset(config: PromptConfig, idx: number): PromptConfig {
  const preset = config.modelPresets?.[idx];
  if (!preset) return config;
  return {
    ...config,
    model: preset.model,
    prefix: preset.prefix,
    suffix: preset.suffix,
    temperature: preset.temperature,
    activeModelPresetId: preset.id,
  };
}

export function applyModelField(config: PromptConfig, model: string): PromptConfig {
  const preset = (config.modelPresets ?? []).find(p => p.model === model);
  if (!preset) return {...config, model, activeModelPresetId: null};
  return {
    ...config,
    model,
    prefix: preset.prefix,
    suffix: preset.suffix,
    temperature: preset.temperature,
    activeModelPresetId: preset.id,
  };
}

export function detachModelPreset(
  config: PromptConfig,
  patch: Partial<Pick<PromptConfig, 'prefix' | 'suffix' | 'temperature'>>,
): PromptConfig {
  return {...config, ...patch, activeModelPresetId: null};
}

let cachedEncoder: ReturnType<typeof encodingForModel> | null = null;

function getEncoder() {
  if (!cachedEncoder) {
    cachedEncoder = encodingForModel('gpt-4o');
  }
  return cachedEncoder;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  if (text.length > 2000) return Math.ceil(text.length / 4);
  try {
    return getEncoder().encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

function buildCharBlock(character: Character, nameLabel: string = 'Name'): string {
  const parts: string[] = [];
  parts.push(`${nameLabel}: ${character.name}`);
  if (character.description) parts.push(`Description: ${character.description}`);
  if (character.personality) parts.push(`Personality: ${character.personality}`);
  const writingStyle = getCustomField(character, 'writingStyle');
  if (writingStyle) parts.push(`Writing style: ${writingStyle}`);
  if (character.scenario) parts.push(`Scenario: ${character.scenario}`);
  if (character.exampleMessages) parts.push(`Example messages:\n${character.exampleMessages}`);
  return parts.join('\n');
}

function buildQuickCharBlock(qc: QuickCharacterFields): string {
  const asCharacter: Character = {
    id: qc.id,
    name: qc.name,
    description: qc.description,
    personality: qc.personality,
    scenario: '',
    initialMessage: '',
    exampleMessages: '',
    customFields: [],
    lorebookIds: [],
  };
  return buildCharBlock(asCharacter, 'Quick character');
}

function resolveUserDescription(character: Character, config: PromptConfig): string {
  if (character.personaId) {
    const persona = (config.personas ?? []).find(p => p.id === character.personaId);
    if (persona) {
      return persona.name
        ? `User: ${persona.name}\n${persona.description}`
        : `User description: ${persona.description}`;
    }
  }
  return config.userDescription ? `User description: ${config.userDescription}` : '';
}

interface PromptExtras {
  qc?: QuickCharacterFields;
  charBlock?: string;
  groupInstruction?: string;
  lorebook?: string;
}

function resolvePlaceholders(
  template: string,
  character: Character,
  userDescription: string,
  extras: PromptExtras = {},
): string {
  const base = {
    name: character.name,
    description: character.description || '',
    personality: character.personality || '',
    writingStyle: getCustomField(character, 'writingStyle'),
    scenario: character.scenario || '',
    examples: character.exampleMessages || '',
  };
  const quick = extras.qc
    ? {name: extras.qc.name, description: extras.qc.description || '', personality: extras.qc.personality || ''}
    : base;

  const replacements: [string, string][] = [
    ['$CHARNAME$', base.name],
    ['$CHARDESC$', base.description],
    ['$CHARPERSONALITY$', base.personality],
    ['$CHARWRITINGSTYLE$', base.writingStyle],
    ['$CHARSCENARIO$', base.scenario],
    ['$CHAREXAMPLES$', base.examples],
    ['$CHARBLOCK$', extras.charBlock ?? buildCharBlock(character, extras.qc ? 'Base character' : 'Name')],
    ['$PERSONALITY$', base.personality],
    ['$WRITINGSTYLE$', base.writingStyle],
    ['$SCENARIO$', base.scenario],
    ['$EXAMPLES$', base.examples],
    ['$QUICKCHARNAME$', quick.name],
    ['$QUICKCHARDESC$', quick.description],
    ['$QUICKCHARPERSONALITY$', quick.personality],
    ['$QUICKCHARBLOCK$', extras.qc ? buildQuickCharBlock(extras.qc) : ''],
    ['$USRDESC$', userDescription],
    ['$LOREBOOK$', extras.lorebook ?? ''],
    ['$GROUPINSTRUCTION$', extras.groupInstruction ?? ''],
  ];

  let result = template;
  for (const [placeholder, value] of replacements) {
    result = result.split(placeholder).join(value);
  }
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

function joinSystem(prefix: string, suffix: string): string {
  return [prefix, suffix].filter(Boolean).join('\n\n');
}

export function stripSpeakerNamePrefixes(
  content: string,
  names: (string | undefined | null)[],
): string {
  let result = content;
  for (const name of names) {
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp('^\\s*\\[\\s*' + escaped + '\\s*\\]:\\s*'), '');
  }
  return result;
}

function speakerName(
  msg: ChatMessage,
  character: Character,
  qc?: QuickCharacterFields,
  quickCharacters?: QuickCharacterFields[],
): string {
  const id = msg.characterId;
  if (id) {
    if (id === character.id) return character.name;
    if (qc && id === qc.id) return qc.name;
    const found = (quickCharacters ?? []).find(q => q.id === id);
    if (found) return found.name;
  }
  return character.name;
}

function sliceHistory(
  history: ChatMessage[],
  mode: 'tokens' | 'messages',
  amount: number,
): ChatMessage[] {
  if (mode === 'messages') {
    return history.slice(-amount);
  }

  let tokenCount = 0;
  const sliced: ChatMessage[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(history[i].content);
    if (tokenCount + msgTokens > amount) {
      break;
    }
    tokenCount += msgTokens;
    sliced.unshift(history[i]);
  }
  return sliced;
}

export function historyWithoutLatestUserTurn(
  history: ChatMessage[],
  userMessage: string,
): ChatMessage[] {
  const last = history[history.length - 1];
  if (userMessage && last && last.role === 'user' && last.content === userMessage) {
    return history.slice(0, -1);
  }
  return history;
}

export function buildPrompt(
  character: Character,
  userMessage: string,
  history: ChatMessage[],
  config: PromptConfig = DEFAULT_PROMPT_CONFIG,
  lorebookContext?: string,
  qc?: QuickCharacterFields,
  quickCharacters?: QuickCharacterFields[],
): ChatMessageObject[] {
  const userDescription = resolveUserDescription(character, config);
  const extras: PromptExtras = {qc, lorebook: lorebookContext};
  const resolvedPrefix = resolvePlaceholders(config.prefix, character, userDescription, extras);
  const resolvedSuffix = resolvePlaceholders(config.suffix, character, userDescription, extras);
  const systemContent = joinSystem(resolvedPrefix, resolvedSuffix);

  const messages: ChatMessageObject[] = [
    {role: 'system', content: systemContent},
  ];

  const cutoffAmount = Number(config.historyCutoffAmount) || 20;
  const slicedHistory = sliceHistory(history, config.historyCutoffMode, cutoffAmount);

  for (const msg of slicedHistory) {
    if (msg.role === 'user') {
      messages.push({role: 'user', content: msg.content});
    } else {
      messages.push({
        role: 'assistant',
        content: `[${speakerName(msg, character, qc, quickCharacters)}]: ${msg.content}`,
      });
    }
  }

  messages.push({role: 'user', content: userMessage});

  return messages;
}

export function buildGroupPrompt(
  characters: Character[],
  selectedCharacter: Character,
  userMessage: string,
  history: ChatMessage[],
  config: PromptConfig = DEFAULT_PROMPT_CONFIG,
  lorebookContext?: string,
): ChatMessageObject[] {
  const userDescription = resolveUserDescription(selectedCharacter, config);
  const charBlocks = characters.map(c => buildCharBlock(c)).join('\n\n---\n\n');
  const groupInstruction = `You are roleplaying as multiple characters in a group conversation. The characters are:\n${characters.map(c => `- ${c.name}`).join('\n')}\n\nThe user has selected **${selectedCharacter.name}** to respond next. Write ONLY as ${selectedCharacter.name}. Stay in character and respond naturally to the conversation.\n\nIMPORTANT: In the conversation history below, messages from each character are prefixed with their name in brackets, like [CharacterName]: message. Use this to understand who said what.`;
  const extras: PromptExtras = {charBlock: charBlocks, groupInstruction, lorebook: lorebookContext};

  const resolvedPrefix = resolvePlaceholders(config.prefix, selectedCharacter, userDescription, extras);
  const resolvedSuffix = resolvePlaceholders(config.suffix, selectedCharacter, userDescription, extras);

  const systemContent = joinSystem(resolvedPrefix, resolvedSuffix);

  const messages: ChatMessageObject[] = [
    {role: 'system', content: systemContent},
  ];

  const cutoffAmount = Number(config.historyCutoffAmount) || 20;
  const slicedHistory = sliceHistory(history, config.historyCutoffMode, cutoffAmount);

  for (const msg of slicedHistory) {
    if (msg.role === 'user') {
      messages.push({role: 'user', content: msg.content});
    } else {
      const charName = characters.find(c => c.id === msg.characterId)?.name;
      const prefixed = charName ? `[${charName}]: ${msg.content}` : msg.content;
      messages.push({role: 'assistant', content: prefixed});
    }
  }

  messages.push({role: 'user', content: userMessage});

  return messages;
}

export function buildContinuePrompt(
  character: Character,
  history: ChatMessage[],
  config: PromptConfig = DEFAULT_PROMPT_CONFIG,
  lorebookContext?: string,
  qc?: QuickCharacterFields,
  quickCharacters?: QuickCharacterFields[],
): ChatMessageObject[] {
  const userDescription = resolveUserDescription(character, config);
  const extras: PromptExtras = {qc, lorebook: lorebookContext};
  const resolvedPrefix = resolvePlaceholders(config.prefix, character, userDescription, extras);
  const resolvedSuffix = resolvePlaceholders(config.suffix, character, userDescription, extras);
  const systemContent = joinSystem(resolvedPrefix, resolvedSuffix);

  const messages: ChatMessageObject[] = [
    {role: 'system', content: systemContent},
  ];

  const cutoffAmount = Number(config.historyCutoffAmount) || 20;
  const slicedHistory = sliceHistory(history, config.historyCutoffMode, cutoffAmount);

  for (const msg of slicedHistory) {
    if (msg.role === 'user') {
      messages.push({role: 'user', content: msg.content});
    } else {
      messages.push({
        role: 'assistant',
        content: `[${speakerName(msg, character, qc, quickCharacters)}]: ${msg.content}`,
      });
    }
  }

  messages.push({
    role: 'user',
    content: '[Continue your previous reply exactly where it left off. Do not repeat any earlier text.]',
  });

  return messages;
}

export function buildGroupContinuePrompt(
  characters: Character[],
  selectedCharacter: Character,
  history: ChatMessage[],
  config: PromptConfig = DEFAULT_PROMPT_CONFIG,
): ChatMessageObject[] {
  const userDescription = resolveUserDescription(selectedCharacter, config);
  const charBlocks = characters.map(c => buildCharBlock(c)).join('\n\n---\n\n');
  const groupInstruction = `You are roleplaying as multiple characters in a group conversation. The characters are:\n${characters.map(c => `- ${c.name}`).join('\n')}\n\nThe user has selected **${selectedCharacter.name}** to respond next. Write ONLY as ${selectedCharacter.name}. Stay in character and respond naturally to the conversation.\n\nIMPORTANT: In the conversation history below, messages from each character are prefixed with their name in brackets, like [CharacterName]: message. Use this to understand who said what.`;
  const extras: PromptExtras = {charBlock: charBlocks, groupInstruction};

  const resolvedPrefix = resolvePlaceholders(config.prefix, selectedCharacter, userDescription, extras);
  const resolvedSuffix = resolvePlaceholders(config.suffix, selectedCharacter, userDescription, extras);

  const systemContent = joinSystem(resolvedPrefix, resolvedSuffix);

  const messages: ChatMessageObject[] = [
    {role: 'system', content: systemContent},
  ];

  const cutoffAmount = Number(config.historyCutoffAmount) || 20;
  const slicedHistory = sliceHistory(history, config.historyCutoffMode, cutoffAmount);

  for (const msg of slicedHistory) {
    if (msg.role === 'user') {
      messages.push({role: 'user', content: msg.content});
    } else {
      const charName = characters.find(c => c.id === msg.characterId)?.name;
      const prefixed = charName ? `[${charName}]: ${msg.content}` : msg.content;
      messages.push({role: 'assistant', content: prefixed});
    }
  }

  messages.push({
    role: 'user',
    content: `[Continue your previous reply as ${selectedCharacter.name} exactly where it left off. Do not repeat any earlier text.]`,
  });

  return messages;
}

export async function sendToLLM(
  character: Character,
  userMessage: string,
  history: ChatMessage[],
  config: PromptConfig = DEFAULT_PROMPT_CONFIG,
  onToken?: (token: string) => void,
  lorebooks?: LorebookState[],
  controller?: AbortController,
  continueMode: boolean = false,
  quickCharacters?: QuickCharacterFields[],
): Promise<{content: string; request: RawRequest; metrics: TimingMetrics}> {
  const buildStart = performance.now();

  const resolved = await resolveProvider(config);
  history = historyWithoutLatestUserTurn(history, userMessage);

  let lorebookContext: string | undefined;
  if (lorebooks && lorebooks.length > 0) {
    const combinedEntries: {id: number; text: string}[] = [];
    for (const lb of lorebooks) {
      for (const entry of lb.entries) {
        combinedEntries.push({id: combinedEntries.length, text: entry.text});
      }
    }

    if (combinedEntries.length > 0) {
      const combinedLorebook: LorebookState = {
        id: 'combined',
        entries: combinedEntries,
        entryCount: combinedEntries.length,
        fileName: 'combined',
      };

      const ragConfig: RAGConfig = {
        enabled: true,
        model: resolved.ragModel,
        maxEntriesToSend: resolved.ragMaxEntriesToSend,
        maxResults: resolved.ragMaxResults,
      };

      const historyMessages: ChatMessageObject[] = history.map(msg => ({
        role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
        content: msg.content,
      }));
      if (!continueMode) {
        historyMessages.push({role: 'user', content: userMessage});
      }

      const relevant = await retrieveRelevantLorebook(historyMessages, combinedLorebook, ragConfig, resolved);
      lorebookContext = buildRAGInjection(relevant);
    }
  }

  const messages = continueMode
    ? buildContinuePrompt(character, history, resolved, lorebookContext, undefined, quickCharacters)
    : buildPrompt(character, userMessage, history, resolved, lorebookContext, undefined, quickCharacters);
  const promptBuildMs = performance.now() - buildStart;
  const result = await getAIResponse(messages, resolved, onToken, true, controller);
  result.content = stripSpeakerNamePrefixes(result.content, [character.name, ...(quickCharacters ?? []).map(q => q.name)]);
  result.metrics.promptBuildMs = promptBuildMs;
  return result;
}

export async function sendToGroupLLM(
  allCharacters: Character[],
  selectedCharacter: Character,
  userMessage: string,
  history: ChatMessage[],
  config: PromptConfig = DEFAULT_PROMPT_CONFIG,
  onToken?: (token: string) => void,
  controller?: AbortController,
  continueMode: boolean = false,
): Promise<{content: string; request: RawRequest; metrics: TimingMetrics}> {
  const buildStart = performance.now();
  const resolved = await resolveProvider(config);
  history = historyWithoutLatestUserTurn(history, userMessage);

  const messages = continueMode
    ? buildGroupContinuePrompt(allCharacters, selectedCharacter, history, resolved)
    : buildGroupPrompt(allCharacters, selectedCharacter, userMessage, history, resolved);
  const promptBuildMs = performance.now() - buildStart;
  const result = await getAIResponse(messages, resolved, onToken, true, controller);
  result.content = stripSpeakerNamePrefixes(result.content, allCharacters.map(c => c.name));
  result.metrics.promptBuildMs = promptBuildMs;
  return result;
}

export function buildQuickCharacterPrompt(
  qc: QuickCharacterFields,
  parentChar: Character,
  userMessage: string,
  history: ChatMessage[],
  config: PromptConfig = DEFAULT_PROMPT_CONFIG,
  continueMode: boolean = false,
  quickCharacters?: QuickCharacterFields[],
): ChatMessageObject[] {
  const trimmed = historyWithoutLatestUserTurn(history, userMessage);
  const qcConfig: PromptConfig = {
    ...config,
    prefix: config.quickCharacterPrompt ?? DEFAULT_QUICK_CHARACTER_PROMPT,
  };
  return continueMode
    ? buildContinuePrompt(parentChar, trimmed, qcConfig, undefined, qc, quickCharacters)
    : buildPrompt(parentChar, userMessage, trimmed, qcConfig, undefined, qc, quickCharacters);
}

export async function sendToQCLLM(
  qc: QuickCharacterFields,
  parentChar: Character,
  userMessage: string,
  history: ChatMessage[],
  config: PromptConfig = DEFAULT_PROMPT_CONFIG,
  onToken?: (token: string) => void,
  controller?: AbortController,
  continueMode: boolean = false,
  quickCharacters?: QuickCharacterFields[],
): Promise<{content: string; request: RawRequest; metrics: TimingMetrics}> {
  const buildStart = performance.now();
  const resolved = await resolveProvider(config);
  const messages = buildQuickCharacterPrompt(qc, parentChar, userMessage, history, resolved, continueMode, quickCharacters);
  const promptBuildMs = performance.now() - buildStart;
  const result = await getAIResponse(messages, resolved, onToken, true, controller);
  result.content = stripSpeakerNamePrefixes(result.content, [qc.name, parentChar.name, ...(quickCharacters ?? []).map(q => q.name)]);
  result.metrics.promptBuildMs = promptBuildMs;
  return result;
}

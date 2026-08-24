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

export interface PromptConfig {
  prefix: string;
  suffix: string;
  userDescription: string;
  personas: Persona[];
  activePersonaId: string | null;
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
}

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  prefix: 'You are a roleplay companion.',
  suffix: 'Now write the next message as the assistant.',
  userDescription: '',
  personas: [],
  activePersonaId: null,
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
};

export const PLACEHOLDERS = [
  {key: '$CHARNAME$', description: 'Character name'},
  {key: '$CHARDESC$', description: 'Character description'},
  {key: '$PERSONALITY$', description: 'Character personality traits'},
  {key: '$WRITINGSTYLE$', description: 'Character writing style'},
  {key: '$SCENARIO$', description: 'Character scenario / setting'},
  {key: '$EXAMPLES$', description: 'Character example messages'},
  {key: '$USRDESC$', description: 'User description (set in Prompt Settings)'},
  {key: '$LOREBOOK$', description: 'RAG-retrieved lorebook context (auto-filled)'},
];

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

export async function loadPromptConfig(): Promise<PromptConfig> {
  try {
    const stored = getKV(PROMPT_CONFIG_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const withProvider = await resolveProvider({...DEFAULT_PROMPT_CONFIG, ...parsed});
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

function buildCharBlock(character: Character): string {
  const parts: string[] = [];
  parts.push(`Name: ${character.name}`);
  if (character.description) parts.push(`Description: ${character.description}`);
  if (character.personality) parts.push(`Personality: ${character.personality}`);
  const writingStyle = getCustomField(character, 'writingStyle');
  if (writingStyle) parts.push(`Writing style: ${writingStyle}`);
  if (character.scenario) parts.push(`Scenario: ${character.scenario}`);
  if (character.exampleMessages) parts.push(`Example messages:\n${character.exampleMessages}`);
  return parts.join('\n');
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

function resolvePlaceholders(
  template: string,
  character: Character,
  userDescription: string,
): string {
  const replacements: [string, string][] = [
    ['$CHARNAME$', character.name],
    ['$CHARDESC$', character.description || ''],
    ['$PERSONALITY$', character.personality || ''],
    ['$WRITINGSTYLE$', getCustomField(character, 'writingStyle')],
    ['$SCENARIO$', character.scenario || ''],
    ['$EXAMPLES$', character.exampleMessages || ''],
    ['$USRDESC$', userDescription],
  ];

  let result = template;
  for (const [placeholder, value] of replacements) {
    result = result.split(placeholder).join(value);
  }
  return result;
}

function buildSystemParts(
  prefix: string,
  userDescription: string,
  config: PromptConfig,
  ...rest: (string | undefined)[]
): string[] {
  const parts: string[] = [prefix];
  if (userDescription && !config.prefix.includes('$USRDESC$') && !config.suffix.includes('$USRDESC$')) {
    parts.push(userDescription);
  }
  parts.push(...rest.filter(Boolean) as string[]);
  return parts;
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

export function buildPrompt(
  character: Character,
  userMessage: string,
  history: ChatMessage[],
  config: PromptConfig = DEFAULT_PROMPT_CONFIG,
  lorebookContext?: string,
): ChatMessageObject[] {
  const userDescription = resolveUserDescription(character, config);
  const resolvedPrefix = resolvePlaceholders(config.prefix, character, userDescription);
  const resolvedSuffix = resolvePlaceholders(config.suffix, character, userDescription);
  const charBlock = buildCharBlock(character);

  const systemParts = buildSystemParts(
    resolvedPrefix,
    userDescription,
    config,
    charBlock,
    lorebookContext,
    resolvedSuffix,
  );

  const systemContent = systemParts.filter(Boolean).join('\n\n');

  const messages: ChatMessageObject[] = [
    {role: 'system', content: systemContent},
  ];

  const cutoffAmount = Number(config.historyCutoffAmount) || 20;
  const slicedHistory = sliceHistory(history, config.historyCutoffMode, cutoffAmount);

  for (const msg of slicedHistory) {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    });
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
  const resolvedPrefix = resolvePlaceholders(config.prefix, selectedCharacter, userDescription);
  const resolvedSuffix = resolvePlaceholders(config.suffix, selectedCharacter, userDescription);

  const charBlocks = characters.map(c => buildCharBlock(c)).join('\n\n---\n\n');

  const groupInstruction = `You are roleplaying as multiple characters in a group conversation. The characters are:\n${characters.map(c => `- ${c.name}`).join('\n')}\n\nThe user has selected **${selectedCharacter.name}** to respond next. Write ONLY as ${selectedCharacter.name}. Stay in character and respond naturally to the conversation.\n\nIMPORTANT: In the conversation history below, messages from each character are prefixed with their name in brackets, like [CharacterName]: message. Use this to understand who said what.`;

  const systemParts = buildSystemParts(
    resolvedPrefix,
    userDescription,
    config,
    charBlocks,
    groupInstruction,
    lorebookContext,
    resolvedSuffix,
  );

  const systemContent = systemParts.filter(Boolean).join('\n\n');

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
): ChatMessageObject[] {
  const userDescription = resolveUserDescription(character, config);
  const resolvedPrefix = resolvePlaceholders(config.prefix, character, userDescription);
  const resolvedSuffix = resolvePlaceholders(config.suffix, character, userDescription);
  const charBlock = buildCharBlock(character);

  const systemParts = buildSystemParts(
    resolvedPrefix,
    userDescription,
    config,
    charBlock,
    lorebookContext,
    resolvedSuffix,
  );

  const systemContent = systemParts.filter(Boolean).join('\n\n');

  const messages: ChatMessageObject[] = [
    {role: 'system', content: systemContent},
  ];

  const cutoffAmount = Number(config.historyCutoffAmount) || 20;
  const slicedHistory = sliceHistory(history, config.historyCutoffMode, cutoffAmount);

  for (const msg of slicedHistory) {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    });
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
  const resolvedPrefix = resolvePlaceholders(config.prefix, selectedCharacter, userDescription);
  const resolvedSuffix = resolvePlaceholders(config.suffix, selectedCharacter, userDescription);

  const charBlocks = characters.map(c => buildCharBlock(c)).join('\n\n---\n\n');

  const groupInstruction = `You are roleplaying as multiple characters in a group conversation. The characters are:\n${characters.map(c => `- ${c.name}`).join('\n')}\n\nThe user has selected **${selectedCharacter.name}** to respond next. Write ONLY as ${selectedCharacter.name}. Stay in character and respond naturally to the conversation.\n\nIMPORTANT: In the conversation history below, messages from each character are prefixed with their name in brackets, like [CharacterName]: message. Use this to understand who said what.`;

  const systemParts = buildSystemParts(
    resolvedPrefix,
    userDescription,
    config,
    charBlocks,
    groupInstruction,
    resolvedSuffix,
  );

  const systemContent = systemParts.filter(Boolean).join('\n\n');

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
): Promise<{content: string; request: RawRequest; metrics: TimingMetrics}> {
  const buildStart = performance.now();

  const resolved = await resolveProvider(config);

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
    ? buildContinuePrompt(character, history, resolved, lorebookContext)
    : buildPrompt(character, userMessage, history, resolved, lorebookContext);
  const promptBuildMs = performance.now() - buildStart;
  const result = await getAIResponse(messages, resolved, onToken, true, controller);
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

  const messages = continueMode
    ? buildGroupContinuePrompt(allCharacters, selectedCharacter, history, resolved)
    : buildGroupPrompt(allCharacters, selectedCharacter, userMessage, history, resolved);
  const promptBuildMs = performance.now() - buildStart;
  const result = await getAIResponse(messages, resolved, onToken, true, controller);
  result.metrics.promptBuildMs = promptBuildMs;
  return result;
}

export async function sendToQCLLM(
  qc: {id: string; name: string; description: string; personality: string},
  parentChar: Character,
  allQCs: {id: string; name: string; description: string; personality: string}[],
  userMessage: string,
  history: ChatMessage[],
  config: PromptConfig = DEFAULT_PROMPT_CONFIG,
  onToken?: (token: string) => void,
  controller?: AbortController,
  continueMode: boolean = false,
): Promise<{content: string; request: RawRequest; metrics: TimingMetrics}> {
  const buildStart = performance.now();
  const resolved = await resolveProvider(config);

  const qcAsCharacter: Character = {
    id: qc.id,
    name: qc.name,
    description: qc.description,
    personality: qc.personality,
    customFields: parentChar.customFields,
    scenario: parentChar.scenario,
    exampleMessages: parentChar.exampleMessages,
    initialMessage: '',
    lorebookIds: [],
    personaId: parentChar.personaId,
  };

  const allChars: Character[] = [
    parentChar,
    ...allQCs.map(q => ({
      id: q.id,
      name: q.name,
      description: q.description,
      personality: q.personality,
      customFields: parentChar.customFields,
      scenario: parentChar.scenario,
      exampleMessages: parentChar.exampleMessages,
      initialMessage: '',
      lorebookIds: [],
      personaId: parentChar.personaId,
    })),
  ];

  const messages = continueMode
    ? buildGroupContinuePrompt(allChars, qcAsCharacter, history, resolved)
    : buildGroupPrompt(allChars, qcAsCharacter, userMessage, history, resolved);
  const promptBuildMs = performance.now() - buildStart;
  const result = await getAIResponse(messages, resolved, onToken, true, controller);
  result.metrics.promptBuildMs = promptBuildMs;
  return result;
}

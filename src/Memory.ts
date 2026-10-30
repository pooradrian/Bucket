import type { ChatMessage } from './useChat';
import type { ChatMessageObject, PromptConfig } from './PromptHandler';
import { estimateTokens } from './PromptHandler';
import { getAIResponse } from './Endpoint';
import {
  cosineSimilarity,
  embedTexts,
  embeddingKey,
  RAGConfig,
} from './RAGHandler';
import {
  generateId,
  getKV,
  getMemoriesForScopeFromDB,
  getMemoriesMissingVectorFromDB,
  getMemoryCountFromDB,
  pruneMemoriesInDB,
  saveMemoryToDB,
  setKV,
  touchMemoriesInDB,
  updateMemoryInDB,
} from './Database';

export interface StoredMemory {
  id: string;
  scopeId: string;
  text: string;
  vector: number[];
  vectorKey: string;
  sourceSessionId: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  pinned: boolean;
}

export interface MemoryConfig {
  enabled: boolean;
  scope: 'character' | 'session';
  model: string;
  maxResults: number;
  minSimilarity: number;
  maxQueries: number;
  everyNMessages: number;
  maxStored: number;
  backfillChunk: number;
}

export interface MemoryPassOutput {
  queries: string[];
  facts: string[];
}

export interface BackfillEstimate {
  messages: number;
  calls: number;
  tokens: number;
}

export interface BackfillProgress {
  done: number;
  total: number;
  facts: number;
}

export const MEMORY_DEDUPE_SIMILARITY = 0.92;
export const MEMORY_PASS_MAX_MESSAGES = 16;
export const MEMORY_RECENT_MESSAGES = 6;
export const MEMORY_REMEMBERED_LIMIT = 8;
export const MEMORY_REEMBED_LIMIT = 64;
export const MEMORY_BACKFILL_REEMBED_LIMIT = 128;
export const MEMORY_MIN_MESSAGES_FOR_BACKFILL = 10;
export const MEMORY_MAX_QUERY_CHARS = 120;
export const MEMORY_MAX_FACT_CHARS = 300;

const MEMORY_PASS_PROMPT = `You maintain the long-term memory of a roleplay chat. You receive the recent conversation, new messages that are not in long-term memory yet, and facts that are already remembered.

Write two lists:

QUERIES: 3 to 5 short phrases the assistant may need to recall for its next reply. Focus on names, places, objects, relationships, promises and unresolved events. Keywords only, one per line, no numbering, no explanations.

FACTS: 0 to 4 durable facts learned from NEW MESSAGES. Each fact must be self-contained, written in the third person, name every person involved, and stay under 200 characters. Do not repeat anything under REMEMBERED, do not quote dialogue, do not speculate. Leave the list empty when there is nothing new.

Reply in exactly this format and nothing else. Do not copy the placeholder lines; write real entries in their place:
QUERIES:
- query
FACTS:
- fact`;

const MEMORY_FACTS_PROMPT = `You extract long-term memory facts from a roleplay conversation segment.

Write 0 to 4 durable facts. Each fact must be self-contained, written in the third person, name every person involved, and stay under 200 characters. Do not repeat anything under REMEMBERED, do not quote dialogue, do not speculate. Facts worth keeping: identities, relationships, promises, possessions, injuries, locations, goals and unresolved events.

Reply in exactly this format and nothing else. Do not copy the placeholder line; write real facts in its place:
FACTS:
- fact`;

export interface MemorySettings {
  enabled: boolean;
  scope: 'character' | 'session';
  model: string;
  maxResults: string;
  minSimilarity: string;
  maxQueries: string;
  everyNMessages: string;
  maxStored: string;
  backfillChunk: string;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: false,
  scope: 'character',
  model: '',
  maxResults: '5',
  minSimilarity: '0.3',
  maxQueries: '4',
  everyNMessages: '6',
  maxStored: '500',
  backfillChunk: '40',
};

const MEMORY_SETTINGS_PREFIX = 'memoryConfig:';

export function loadMemorySettings(characterId: string): MemorySettings {
  const raw = getKV(`${MEMORY_SETTINGS_PREFIX}${characterId}`);
  if (!raw) {
    return DEFAULT_MEMORY_SETTINGS;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MemorySettings>;
    const text = (value: unknown, fallback: string) =>
      typeof value === 'string' ? value : fallback;
    return {
      enabled:
        typeof parsed.enabled === 'boolean'
          ? parsed.enabled
          : DEFAULT_MEMORY_SETTINGS.enabled,
      scope: parsed.scope === 'session' ? 'session' : 'character',
      model: text(parsed.model, DEFAULT_MEMORY_SETTINGS.model),
      maxResults: text(parsed.maxResults, DEFAULT_MEMORY_SETTINGS.maxResults),
      minSimilarity: text(
        parsed.minSimilarity,
        DEFAULT_MEMORY_SETTINGS.minSimilarity,
      ),
      maxQueries: text(parsed.maxQueries, DEFAULT_MEMORY_SETTINGS.maxQueries),
      everyNMessages: text(
        parsed.everyNMessages,
        DEFAULT_MEMORY_SETTINGS.everyNMessages,
      ),
      maxStored: text(parsed.maxStored, DEFAULT_MEMORY_SETTINGS.maxStored),
      backfillChunk: text(
        parsed.backfillChunk,
        DEFAULT_MEMORY_SETTINGS.backfillChunk,
      ),
    };
  } catch {
    return DEFAULT_MEMORY_SETTINGS;
  }
}

export function saveMemorySettings(
  characterId: string,
  settings: MemorySettings,
): void {
  if (!characterId) {
    return;
  }
  setKV(`${MEMORY_SETTINGS_PREFIX}${characterId}`, JSON.stringify(settings));
}

export function getMemoryConfig(
  settings: MemorySettings,
  config: PromptConfig,
): MemoryConfig {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
  const num = (raw: string, fallback: number) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const minRaw = Number(settings.minSimilarity);
  const minSimilarity =
    settings.minSimilarity?.trim() && Number.isFinite(minRaw)
      ? clamp(minRaw, -1, 1)
      : 0.3;
  return {
    enabled: !!settings.enabled,
    scope: settings.scope === 'session' ? 'session' : 'character',
    model: settings.model?.trim() || config.model,
    maxResults: Math.round(clamp(num(settings.maxResults, 5), 1, 20)),
    minSimilarity,
    maxQueries: Math.round(clamp(num(settings.maxQueries, 4), 1, 8)),
    everyNMessages: Math.round(
      clamp(num(settings.everyNMessages, 6), 1, 100),
    ),
    maxStored: Math.round(clamp(num(settings.maxStored, 500), 10, 5000)),
    backfillChunk: Math.round(clamp(num(settings.backfillChunk, 40), 5, 200)),
  };
}

export function memoryScopeId(
  scope: 'character' | 'session',
  characterId: string,
  sessionId: string,
): string {
  return scope === 'session' ? `session:${sessionId}` : `character:${characterId}`;
}

export function memoryRagConfig(config: PromptConfig): RAGConfig {
  return {
    enabled: true,
    model: config.ragModel,
    source: config.ragSource,
    localModel: config.ragLocalModel,
    maxEntriesToSend: config.ragMaxEntriesToSend,
    maxResults: config.ragMaxResults,
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function cleanLine(line: string): string {
  return line
    .replace(/^[-*•]\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/^["'“”](.*)["'“”]$/, '$1')
    .trim();
}

const MEMORY_PLACEHOLDER =
  /^[<[(]?\s*(?:quer(?:y|ies)|facts?)\s*\d*\s*[>\])]?[:.]?$/i;

function isMemoryPlaceholder(value: string): boolean {
  return (
    !value ||
    value.toUpperCase() === 'NONE' ||
    MEMORY_PLACEHOLDER.test(value)
  );
}

export function parseMemoryOutput(
  raw: string,
  maxQueries: number,
  maxFacts: number,
): MemoryPassOutput {
  const queries: string[] = [];
  const facts: string[] = [];
  let section: 'queries' | 'facts' | null = null;

  for (const rawLine of raw.split('\n')) {
    const line = cleanLine(rawLine);
    if (!line) continue;
    const header = /^(queries|facts)(?:\s*:\s*|\s*$)(.*)$/i.exec(line);
    if (header) {
      section = header[1].toLowerCase() === 'queries' ? 'queries' : 'facts';
      const rest = cleanLine(header[2]);
      if (!isMemoryPlaceholder(rest)) {
        (section === 'queries' ? queries : facts).push(rest);
      }
      continue;
    }
    if (!section) continue;
    if (isMemoryPlaceholder(line)) continue;
    if (section === 'queries') queries.push(line);
    else facts.push(line);
  }

  const finalize = (values: string[], max: number, cap: number) => {
    if (max <= 0) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
      const text = truncate(value, cap);
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= max) break;
    }
    return out;
  };

  return {
    queries: finalize(queries, maxQueries, MEMORY_MAX_QUERY_CHARS),
    facts: finalize(facts, maxFacts, MEMORY_MAX_FACT_CHARS),
  };
}

export function formatMemoryMessages(
  messages: ChatMessage[],
  characterName: string,
): string {
  return messages
    .map(message => {
      const content = message.content.trim();
      if (content.startsWith('[Summary]')) {
        return `Story so far: ${truncate(
          content.replace(/^\[Summary\]\s*/, ''),
          1600,
        )}`;
      }
      const body = truncate(content, 1200);
      return message.role === 'user' ? `User: ${body}` : `${characterName}: ${body}`;
    })
    .join('\n\n');
}

export function buildMemoryPassMessages(input: {
  characterName: string;
  recent: ChatMessage[];
  pending: ChatMessage[];
  remembered: string[];
}): ChatMessageObject[] {
  const parts = [
    `RECENT CONVERSATION:\n${formatMemoryMessages(
      input.recent,
      input.characterName,
    )}`,
    `NEW MESSAGES:\n${
      input.pending.length
        ? formatMemoryMessages(input.pending, input.characterName)
        : '(none — do not write facts)'
    }`,
  ];
  if (input.remembered.length > 0) {
    parts.push(
      `REMEMBERED:\n${input.remembered.map(text => `- ${text}`).join('\n')}`,
    );
  }
  return [
    { role: 'system', content: MEMORY_PASS_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

export function buildBackfillMessages(input: {
  characterName: string;
  messages: ChatMessage[];
  remembered: string[];
}): ChatMessageObject[] {
  const parts = [
    `CONVERSATION SEGMENT:\n${formatMemoryMessages(
      input.messages,
      input.characterName,
    )}`,
  ];
  if (input.remembered.length > 0) {
    parts.push(
      `REMEMBERED:\n${input.remembered.map(text => `- ${text}`).join('\n')}`,
    );
  }
  return [
    { role: 'system', content: MEMORY_FACTS_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

async function callMemoryModel(
  messages: ChatMessageObject[],
  config: PromptConfig,
  memoryConfig: MemoryConfig,
  controller: AbortController,
  timeoutMs: number,
): Promise<string> {
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await getAIResponse(
      messages,
      {
        ...config,
        model: memoryConfig.model,
        temperature: '0.2',
        topP: '',
      },
      undefined,
      false,
      controller,
    );
    return result.content;
  } finally {
    clearTimeout(timer);
  }
}

export function rankMemories(
  queryVectors: number[][],
  memories: StoredMemory[],
  minSimilarity: number,
  maxResults: number,
): Array<{ memory: StoredMemory; score: number }> {
  return memories
    .map(memory => {
      let best = -1;
      for (const vector of queryVectors) {
        if (memory.vector.length !== vector.length) continue;
        best = Math.max(best, cosineSimilarity(vector, memory.vector));
      }
      return { memory, score: best };
    })
    .filter(entry => entry.score >= minSimilarity)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

export function buildMemoryInjection(texts: string[]): string {
  if (texts.length === 0) {
    return '';
  }
  return `[Long-term Memory]\n${texts.map(text => `- ${text}`).join('\n')}`;
}

interface CachedQueries {
  lastMessageId: string;
  queries: string[];
}

function readCachedQueries(sessionId: string): CachedQueries | null {
  try {
    const raw = getKV(`memoryQueries:${sessionId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.lastMessageId !== 'string' ||
      !Array.isArray(parsed?.queries)
    ) {
      return null;
    }
    return {
      lastMessageId: parsed.lastMessageId,
      queries: parsed.queries.filter(
        (query: unknown): query is string =>
          typeof query === 'string' && query.trim().length > 0,
      ),
    };
  } catch {
    return null;
  }
}

export async function buildMemoryContext(input: {
  scopeId: string;
  sessionId: string;
  priorLastMessageId?: string;
  userText: string;
  settings: MemorySettings;
  config: PromptConfig;
  continueMode?: boolean;
}): Promise<{ block: string; results: string[] }> {
  const empty: { block: string; results: string[] } = {
    block: '',
    results: [],
  };
  const memoryConfig = getMemoryConfig(input.settings, input.config);
  if (!memoryConfig.enabled) {
    return empty;
  }
  if (getMemoryCountFromDB(input.scopeId) === 0) {
    return empty;
  }

  const cached = readCachedQueries(input.sessionId);
  const queries: string[] = [];
  if (cached && cached.lastMessageId === input.priorLastMessageId) {
    queries.push(...cached.queries);
  }
  if (!input.continueMode) {
    const userText = input.userText.trim();
    if (userText) {
      queries.push(truncate(userText, 300));
    }
  }
  const uniqueQueries: string[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueQueries.push(query);
    if (uniqueQueries.length >= memoryConfig.maxQueries) break;
  }
  if (uniqueQueries.length === 0) {
    return empty;
  }

  const ragConfig = memoryRagConfig(input.config);
  const key = embeddingKey(ragConfig, input.config);
  const memories = (await getMemoriesForScopeFromDB(input.scopeId)).filter(
    memory =>
      memory.vector.length > 0 && memory.vectorKey === key,
  );
  if (memories.length === 0) {
    return empty;
  }

  const queryVectors = await embedTexts(uniqueQueries, ragConfig, input.config);
  const ranked = rankMemories(
    queryVectors,
    memories,
    memoryConfig.minSimilarity,
    memoryConfig.maxResults,
  );
  if (ranked.length === 0) {
    return empty;
  }
  touchMemoriesInDB(
    ranked.map(entry => entry.memory.id),
    Date.now(),
  );
  const results = ranked.map(entry => entry.memory.text);
  return { block: buildMemoryInjection(results), results };
}

async function storeFacts(
  scopeId: string,
  facts: string[],
  config: PromptConfig,
  sourceSessionId: string,
): Promise<number> {
  if (facts.length === 0) {
    return 0;
  }
  const existing = await getMemoriesForScopeFromDB(scopeId);
  const seen = new Set(existing.map(memory => memory.text.trim().toLowerCase()));
  const unique = facts.filter(fact => {
    const key = fact.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length === 0) {
    return 0;
  }

  const ragConfig = memoryRagConfig(config);
  let vectors: number[][] | null = null;
  let vectorKey = '';
  try {
    vectors = await embedTexts(unique, ragConfig, config);
    vectorKey = embeddingKey(ragConfig, config);
  } catch (e) {
    console.warn('Memory embedding failed, storing facts unindexed:', e);
  }

  let stored = 0;
  for (let i = 0; i < unique.length; i++) {
    const vector = vectors?.[i] ?? [];
    if (vector.length > 0) {
      const duplicate = existing.find(
        memory =>
          memory.vector.length === vector.length &&
          memory.vectorKey === vectorKey &&
          cosineSimilarity(memory.vector, vector) >= MEMORY_DEDUPE_SIMILARITY,
      );
      if (duplicate) continue;
    }
    const now = Date.now();
    await saveMemoryToDB({
      id: generateId(),
      scopeId,
      text: unique[i],
      vector,
      vectorKey: vector.length > 0 ? vectorKey : '',
      sourceSessionId,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: 0,
      pinned: false,
    });
    stored++;
  }
  return stored;
}

export async function saveAndIndexMemory(
  scopeId: string,
  text: string,
  config: PromptConfig,
  sourceSessionId: string,
): Promise<boolean> {
  const stored = await storeFacts(scopeId, [text], config, sourceSessionId);
  return stored > 0;
}

export async function reembedMemories(
  scopeId: string,
  config: PromptConfig,
  limit: number,
): Promise<number> {
  const ragConfig = memoryRagConfig(config);
  const vectorKey = embeddingKey(ragConfig, config);
  const missing = await getMemoriesMissingVectorFromDB(
    scopeId,
    vectorKey,
    limit,
  );
  if (missing.length === 0) {
    return 0;
  }
  try {
    const vectors = await embedTexts(
      missing.map(memory => memory.text),
      ragConfig,
      config,
    );
    for (let i = 0; i < missing.length; i++) {
      const vector = vectors[i] ?? [];
      if (vector.length === 0) continue;
      await updateMemoryInDB(missing[i].id, { vector, vectorKey });
    }
    return missing.length;
  } catch (e) {
    console.warn('Memory re-index failed:', e);
    return 0;
  }
}

export interface MemoryPassInput {
  sessionId: string;
  characterName: string;
  scopeId: string;
  messages: ChatMessage[];
  settings: MemorySettings;
  config: PromptConfig;
}

const passQueues = new Map<string, Promise<void>>();

export function queueMemoryPass(input: MemoryPassInput): Promise<void> {
  const previous = passQueues.get(input.sessionId) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => runMemoryPass(input));
  passQueues.set(
    input.sessionId,
    next.catch(() => {}),
  );
  return next;
}

export async function runMemoryPass(input: MemoryPassInput): Promise<void> {
  const memoryConfig = getMemoryConfig(input.settings, input.config);
  if (!memoryConfig.enabled) {
    return;
  }
  const messages = input.messages.filter(message => message.content.trim());
  if (messages.length === 0) {
    return;
  }
  const last = messages[messages.length - 1];
  const watermarkKey = `memorySeq:${input.sessionId}`;
  let watermark = getKV(watermarkKey);
  if (!watermark) {
    const baseline =
      messages.length > 1 ? messages[messages.length - 2].id : last.id;
    setKV(watermarkKey, baseline);
    watermark = baseline;
  }

  const watermarkIndex = messages.findIndex(
    message => message.id === watermark,
  );
  let pending: ChatMessage[];
  let factsDue: boolean;
  if (watermarkIndex >= 0) {
    pending = messages.slice(watermarkIndex + 1);
    factsDue = pending.length >= memoryConfig.everyNMessages;
  } else {
    pending = messages.slice(-memoryConfig.everyNMessages);
    factsDue = true;
  }

  if (!factsDue && getMemoryCountFromDB(input.scopeId) === 0) {
    return;
  }

  const recent = messages.slice(-MEMORY_RECENT_MESSAGES);
  const factsChunk = factsDue
    ? pending.slice(-MEMORY_PASS_MAX_MESSAGES)
    : [];
  const existing = await getMemoriesForScopeFromDB(input.scopeId);
  const remembered = existing
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MEMORY_REMEMBERED_LIMIT)
    .map(memory => memory.text);

  const controller = new AbortController();
  const raw = await callMemoryModel(
    buildMemoryPassMessages({
      characterName: input.characterName,
      recent,
      pending: factsChunk,
      remembered,
    }),
    input.config,
    memoryConfig,
    controller,
    60000,
  );
  const output = parseMemoryOutput(
    raw,
    memoryConfig.maxQueries,
    4,
  );
  if (output.queries.length > 0) {
    setKV(
      `memoryQueries:${input.sessionId}`,
      JSON.stringify({ lastMessageId: last.id, queries: output.queries }),
    );
  }
  if (factsChunk.length > 0) {
    const stored = await storeFacts(
      input.scopeId,
      output.facts,
      input.config,
      input.sessionId,
    );
    if (stored > 0) {
      pruneMemoriesInDB(input.scopeId, memoryConfig.maxStored);
    }
    setKV(watermarkKey, last.id);
  }
  await reembedMemories(input.scopeId, input.config, MEMORY_REEMBED_LIMIT);
}

export function estimateMemoryBackfill(
  messages: ChatMessage[],
  chunkSize: number,
): BackfillEstimate {
  const usable = messages.filter(message => message.content.trim());
  const chunk = Math.max(5, Math.floor(chunkSize) || 40);
  const calls = Math.max(1, Math.ceil(usable.length / chunk));
  let tokens = 0;
  for (const message of usable) {
    tokens += estimateTokens(message.content);
  }
  tokens += calls * estimateTokens(MEMORY_FACTS_PROMPT);
  return { messages: usable.length, calls, tokens };
}

export interface BackfillInput {
  sessionId: string;
  characterName: string;
  scopeId: string;
  messages: ChatMessage[];
  settings: MemorySettings;
  config: PromptConfig;
  chunkSize?: number;
  controller?: AbortController;
  onProgress?: (progress: BackfillProgress) => void;
}

export async function runMemoryBackfill(
  input: BackfillInput,
): Promise<{ facts: number; calls: number; cancelled: boolean }> {
  const memoryConfig = getMemoryConfig(input.settings, input.config);
  const chunkSize = Math.max(
    5,
    Math.floor(input.chunkSize || memoryConfig.backfillChunk),
  );
  const controller = input.controller ?? new AbortController();
  const usable = input.messages.filter(message => message.content.trim());
  const chunks: ChatMessage[][] = [];
  for (let i = 0; i < usable.length; i += chunkSize) {
    chunks.push(usable.slice(i, i + chunkSize));
  }

  let facts = 0;
  let calls = 0;
  for (let index = 0; index < chunks.length; index++) {
    if (controller.signal.aborted) {
      return { facts, calls, cancelled: true };
    }
    const chunk = chunks[index];
    const existing = await getMemoriesForScopeFromDB(input.scopeId);
    const remembered = existing
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MEMORY_REMEMBERED_LIMIT)
      .map(memory => memory.text);
    const raw = await callMemoryModel(
      buildBackfillMessages({
        characterName: input.characterName,
        messages: chunk,
        remembered,
      }),
      input.config,
      memoryConfig,
      controller,
      120000,
    );
    calls++;
    const output = parseMemoryOutput(raw, 0, 4);
    facts += await storeFacts(
      input.scopeId,
      output.facts,
      input.config,
      input.sessionId,
    );
    setKV(`memorySeq:${input.sessionId}`, chunk[chunk.length - 1].id);
    input.onProgress?.({
      done: index + 1,
      total: chunks.length,
      facts,
    });
  }

  pruneMemoriesInDB(input.scopeId, memoryConfig.maxStored);
  await reembedMemories(
    input.scopeId,
    input.config,
    MEMORY_BACKFILL_REEMBED_LIMIT,
  );
  return { facts, calls, cancelled: controller.signal.aborted };
}

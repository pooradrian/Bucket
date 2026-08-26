import {pick, types} from '@react-native-documents/picker';
import {ChatMessageObject, PromptConfig} from './PromptHandler';
import {getEmbeddings} from './Endpoint';
import {generateId, saveLorebookToDB, deleteLorebookFromDB, getAllLorebooksFromDB} from './Database';

export interface LorebookEntry {
  id: number;
  text: string;
}

export interface RAGConfig {
  enabled: boolean;
  model: string;
  maxEntriesToSend: string;
  maxResults: string;
}

export interface LorebookState {
  id: string;
  entries: LorebookEntry[];
  entryCount: number;
  fileName: string;
}

export function parseLorebook(raw: string): LorebookEntry[] {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map((text, i) => ({id: i, text}));
}

export async function loadLorebook(): Promise<LorebookState | null> {
  try {
    const result = await pick({type: [types.plainText]});
    if (!result || result.length === 0) {
      return null;
    }
    const file = result[0];
    const response = await fetch(file.uri);
    const text = await response.text();
    const entries = parseLorebook(text);
    if (entries.length === 0) {
      return null;
    }
    return {id: generateId(), entries, entryCount: entries.length, fileName: file.name || 'lorebook.txt'};
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as {code: string}).code === 'OPERATION_CANCELED') {
      return null;
    }
    throw e;
  }
}

export async function loadAllLorebooks(): Promise<LorebookState[]> {
  try {
    return await getAllLorebooksFromDB();
  } catch (e) {
    console.warn('Failed to load lorebooks from DB:', e);
  }
  return [];
}

export async function addLorebook(lorebook: LorebookState): Promise<LorebookState[]> {
  await saveLorebookToDB(lorebook);
  return await getAllLorebooksFromDB();
}

export async function removeLorebook(id: string): Promise<LorebookState[]> {
  deleteLorebookFromDB(id);
  return await getAllLorebooksFromDB();
}

export async function retrieveRelevantLorebook(
  recentMessages: ChatMessageObject[],
  lorebook: LorebookState,
  ragConfig: RAGConfig,
  promptConfig: PromptConfig,
): Promise<string[]> {
  const maxToReturn = Number(ragConfig.maxResults) || 5;
  const query = buildQuery(recentMessages);
  const ranked = await rankLorebookEntries(query, lorebook.entries, ragConfig, promptConfig);
  return ranked
    .filter(r => r.score >= MIN_SIMILARITY)
    .slice(0, maxToReturn)
    .map(r => r.entry.text);
}

export interface ScoredEntry {
  entry: LorebookEntry;
  score: number;
}

export const MIN_SIMILARITY = 0.25;
const QUERY_MESSAGE_COUNT = 3;
const QUERY_MAX_CHARS = 4000;
const EMBEDDING_CACHE = new Map<string, number[]>();

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function buildQuery(recentMessages: ChatMessageObject[]): string {
  const joined = recentMessages
    .slice(-QUERY_MESSAGE_COUNT)
    .map(m => m.content)
    .join('\n');
  return joined.length > QUERY_MAX_CHARS ? joined.slice(-QUERY_MAX_CHARS) : joined;
}

async function embedTexts(texts: string[], model: string, config: PromptConfig): Promise<number[][]> {
  const cached = texts.map(t => EMBEDDING_CACHE.get(`${model}\u0000${t}`));
  const missingIdx: number[] = [];
  cached.forEach((v, i) => {
    if (!v) missingIdx.push(i);
  });
  if (missingIdx.length > 0) {
    const fetched = await getEmbeddings(
      missingIdx.map(i => texts[i]),
      model,
      config,
    );
    missingIdx.forEach((textIdx, i) => {
      const vector = fetched[i];
      EMBEDDING_CACHE.set(`${model}\u0000${texts[textIdx]}`, vector);
      cached[textIdx] = vector;
    });
  }
  return cached as number[][];
}

export async function rankLorebookEntries(
  query: string,
  entries: LorebookEntry[],
  ragConfig: RAGConfig,
  promptConfig: PromptConfig,
): Promise<ScoredEntry[]> {
  const capped = entries.slice(0, Number(ragConfig.maxEntriesToSend) || 50);
  if (!query.trim() || capped.length === 0) {
    return [];
  }
  const model = ragConfig.model?.trim() || promptConfig.model;
  const vectors = await embedTexts([query, ...capped.map(e => e.text)], model, promptConfig);
  return capped
    .map((entry, i) => ({entry, score: cosineSimilarity(vectors[0], vectors[i + 1])}))
    .sort((a, b) => b.score - a.score);
}

export function buildRAGInjection(relevantEntries: string[]): string {
  if (relevantEntries.length === 0) {
    return '';
  }
  const block = relevantEntries.map((e, i) => `${i + 1}. ${e}`).join('\n');
  return `[Lorebook Context]\n${block}`;
}

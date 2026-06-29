import {pick, types} from '@react-native-documents/picker';
import {ChatMessageObject, PromptConfig} from './PromptHandler';
import {getAIResponse} from './Endpoint';
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
    return {id: generateId(), entries, fileName: file.name || 'lorebook.txt'};
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
  const maxToSend = Number(ragConfig.maxEntriesToSend) || 50;
  const maxToReturn = Number(ragConfig.maxResults) || 5;
  const entries = lorebook.entries.slice(0, maxToSend);

  const factsBlock = entries.map(e => `${e.id + 1}. ${e.text}`).join('\n');

  const recentConversation = recentMessages
    .slice(-10)
    .map(m => `[${m.role}]: ${m.content}`)
    .join('\n');

  const metaPrompt = `You are a fact-retrieval assistant. Given the following numbered facts and a conversation, return the numbers (as a JSON array of integers) of facts that are relevant to continuing the conversation. Return at most ${maxToReturn} numbers. Only return the JSON array, nothing else.

FACTS:
${factsBlock}

CONVERSATION:
${recentConversation}`;

  const ragModel = ragConfig.model || promptConfig.model;
  const ragPromptConfig: PromptConfig = {
    ...promptConfig,
    model: ragModel,
  };

  const messages: ChatMessageObject[] = [
    {role: 'system', content: 'You are a fact-retrieval assistant. Only output a JSON array of integers.'},
    {role: 'user', content: metaPrompt},
  ];

  const result = await getAIResponse(messages, ragPromptConfig, undefined, true);

  let raw = result.content.trim();
  raw = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  const match = raw.match(/\[[\d\s,]*\]/);
  if (!match) {
    return [];
  }

  try {
    const indices: number[] = JSON.parse(match[0]);
    const relevant: string[] = [];
    for (const idx of indices) {
      const entry = entries.find(e => e.id + 1 === idx);
      if (entry && relevant.length < maxToReturn) {
        relevant.push(entry.text);
      }
    }
    return relevant;
  } catch {
    return [];
  }
}

export function buildRAGInjection(relevantEntries: string[]): string {
  if (relevantEntries.length === 0) {
    return '';
  }
  const block = relevantEntries.map((e, i) => `${i + 1}. ${e}`).join('\n');
  return `[Lorebook Context]\n${block}`;
}

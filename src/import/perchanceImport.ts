import RNFS from 'react-native-fs';
import pako from 'pako';
import {Character} from '../CharacterEditor';
import {LorebookState, parseLorebook} from '../RAGHandler';
import {ChatSession, ChatMessage} from '../useChat';
import {generateId, saveCharacterToDB, saveLorebookToDB, getAllCharactersFromDB, createSession} from '../Database';
import {isGzipSignature} from './util';
import {
  parsePerchanceCharacter,
  PerchanceCharacter,
  PerchanceThread,
  PerchanceMessage,
} from './perchanceSchema';

interface PerchanceTable {
  tableName: string;
  rows: PerchanceCharacter[] | PerchanceThread[] | PerchanceMessage[];
}

export async function importPerchance(fileUri: string, downloadIcons: boolean = false, downloadLorebooks: boolean = false): Promise<{characters: Character[]; sessions: ChatSession[]; skippedCharacters: string[]}> {
  const response = await fetch(fileUri);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let text: string;
  if (isGzipSignature(bytes)) {
    const decompressed = pako.ungzip(bytes);
    text = new TextDecoder().decode(decompressed);
  } else {
    text = new TextDecoder().decode(buffer);
  }

  const json = JSON.parse(text);
  const tables: PerchanceTable[] = json.data?.data || [];

  const charTable = tables.find(t => t.tableName === 'characters');
  const threadTable = tables.find(t => t.tableName === 'threads');
  const messageTable = tables.find(t => t.tableName === 'messages');

  const pCharacters: PerchanceCharacter[] = (charTable?.rows ?? []) as PerchanceCharacter[];
  const pThreads: PerchanceThread[] = (threadTable?.rows ?? []) as PerchanceThread[];
  const pMessages: PerchanceMessage[] = (messageTable?.rows ?? []) as PerchanceMessage[];

  const result = {
    characters: [] as Character[],
    sessions: [] as ChatSession[],
    skippedCharacters: [] as string[],
  };

  const existing = await getAllCharactersFromDB();
  const perchanceIdToNewId = new Map<number, string>();

  for (const pChar of pCharacters) {
    if (existing.some(c => c.name === pChar.name)) {
      result.skippedCharacters.push(pChar.name);
      continue;
    }

    const char = parsePerchanceCharacter(pChar);
    perchanceIdToNewId.set(pChar.id, char.id);

    if (pChar.avatar?.url && downloadIcons) {
      const icon = await downloadPerchanceIcon(pChar.avatar.url, char.id);
      if (icon) {
        char.icon = icon;
      }
    }

    if (downloadLorebooks && pChar.loreBookUrls?.length) {
      for (const url of pChar.loreBookUrls) {
        const lb = await downloadPerchanceLorebook(url, char.id);
        if (lb) {
          await saveLorebookToDB(lb);
          char.lorebookIds.push(lb.id);
        }
      }
    }

    result.characters.push(char);

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
  }

  for (const pThread of pThreads) {
    const newCharId = perchanceIdToNewId.get(pThread.characterId);
    if (!newCharId) continue;

    const threadMessages = pMessages
      .filter(m => m.threadId === pThread.id)
      .sort((a, b) => a.order - b.order);

    if (threadMessages.length === 0) continue;

    const sessionId = generateId();

    const messages: ChatMessage[] = threadMessages.map(m => ({
      id: generateId(),
      role: m.characterId === -1 ? 'user' as const : 'assistant' as const,
      content: m.message,
      timestamp: m.creationTime,
      characterId: m.characterId === -1 ? undefined : newCharId,
    }));

    const session: ChatSession = {
      id: sessionId,
      characterId: newCharId,
      messages,
      createdAt: pThread.creationTime,
      updatedAt: pThread.lastMessageTime,
    };

    result.sessions.push(session);

    await createSession(session);
  }

  return result;
}

async function downloadPerchanceIcon(url: string, charId: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1] || '');
      };
      reader.onerror = () => reject(new Error('Failed to read blob'));
      reader.readAsDataURL(blob);
    });
    if (!base64) return null;
    const ext = url.split('.').pop()?.split('?')[0] || 'png';
    await RNFS.mkdir(`${RNFS.DocumentDirectoryPath}/icons`);
    const iconPath = `${RNFS.DocumentDirectoryPath}/icons/${charId}.${ext}`;
    await RNFS.writeFile(iconPath, base64, 'base64');
    return `file://${iconPath}`;
  } catch {
    return null;
  }
}

async function downloadPerchanceLorebook(url: string, charId: string): Promise<LorebookState | null> {
  try {
    const response = await fetch(url);
    const text = await response.text();
    const entries = parseLorebook(text);
    if (entries.length === 0) return null;
    const fileName = url.split('/').pop()?.split('?')[0] || `lorebook_${charId}.txt`;
    return {id: generateId(), entries, fileName};
  } catch {
    return null;
  }
}

import RNFS from 'react-native-fs';
import JSZip from 'jszip';
import pako from 'pako';
import {Character} from './CharacterEditor';
import {LorebookState, parseLorebook} from './RAGHandler';
import {ChatSession, ChatMessage} from './useChat';
import {PromptConfig, DEFAULT_PROMPT_CONFIG} from './PromptHandler';
import {AppSettings, DEFAULT_APP_SETTINGS} from './store';
import {
  generateId,
  saveCharacterToDB,
  getAllCharactersFromDB,
  saveLorebookToDB,
  getAllLorebooksFromDB,
  setKV,
  getKV,
  createSession,
  getAllSessionsForCharacter,
  getSessionById,
} from './Database';
import {readPngCharaMetadata, writePngWithCharaMetadata, isPngSignature} from './PngMetadata';

export type ImportFormat = 'ccv1' | 'ccv2' | 'buk' | 'perchance';
export type ExportFormat = 'ccv1' | 'ccv2' | 'buk';

function isGzipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export interface BukImportResult {
  characters: Character[];
  settings?: Partial<AppSettings>;
  promptConfig?: Partial<PromptConfig>;
  lorebooks: LorebookState[];
  sessions: ChatSession[];
  skippedCharacters: string[];
}

export interface ImportResult {
  character: Character;
  format: ImportFormat;
}

export interface ExportOptions {
  format: ExportFormat;
  characterIds: string[];
  includeSettings: boolean;
  includeLorebooks: boolean;
  includeChats: boolean;
}

function parseV1Json(json: Record<string, any>, id?: string): Character {
  return {
    id: id || generateId(),
    name: json.name || '',
    description: json.description || '',
    personality: json.personality || '',
    scenario: json.scenario || '',
    initialMessage: json.first_mes || '',
    exampleMessages: json.mes_example || '',
    writingStyle: '',
    lorebookIds: [],
  };
}

function parseV2Json(json: Record<string, any>, id?: string): Character {
  const data = json.data || json;
  let lorebookIds: string[] = [];
  if (data.extensions?.lorebookIds && Array.isArray(data.extensions.lorebookIds)) {
    lorebookIds = data.extensions.lorebookIds;
  } else if (data.extensions?.lorebookId) {
    lorebookIds = [data.extensions.lorebookId];
  }
  return {
    id: id || generateId(),
    name: data.name || '',
    description: data.description || '',
    personality: data.personality || '',
    scenario: data.scenario || '',
    initialMessage: data.first_mes || '',
    exampleMessages: data.mes_example || '',
    writingStyle: '',
    lorebookIds,
  };
}

interface PerchanceCharacter {
  name: string;
  roleInstruction: string;
  generalWritingInstructions: string;
  initialMessages: Array<{author: string; content: string}>;
  avatar: {url: string; size: number; shape: string};
  loreBookUrls: string[];
  id: number;
  [key: string]: any;
}

interface PerchanceThread {
  id: number;
  characterId: number;
  name: string;
  creationTime: number;
  lastMessageTime: number;
  [key: string]: any;
}

interface PerchanceMessage {
  id: number;
  threadId: number;
  characterId: number;
  message: string;
  creationTime: number;
  order: number;
  [key: string]: any;
}

function parsePerchanceCharacter(pChar: PerchanceCharacter): Character {
  const initialMessage = pChar.initialMessages?.find(m => m.author === 'ai')?.content || '';
  return {
    id: generateId(),
    name: pChar.name || '',
    description: pChar.roleInstruction || '',
    personality: '',
    scenario: '',
    initialMessage,
    exampleMessages: '',
    writingStyle: pChar.generalWritingInstructions || '',
    lorebookIds: [],
  };
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

function serializeV1(char: Character): Record<string, any> {
  return {
    name: char.name,
    description: char.description,
    personality: char.personality,
    scenario: char.scenario,
    first_mes: char.initialMessage,
    mes_example: char.exampleMessages || '',
  };
}

function serializeV2(char: Character): Record<string, any> {
  return {
    spec: 'chara_card_v2',
    data: {
      name: char.name,
      description: char.description,
      personality: char.personality,
      scenario: char.scenario,
      first_mes: char.initialMessage,
      mes_example: char.exampleMessages || '',
      alternate_greetings: [],
      system_prompt: '',
      post_history_instructions: '',
      creator_notes: 'Exported from Bucket',
      tags: [],
      creator: '',
      character_version: '1.0',
      extensions: {},
    },
  };
}

export async function detectImportFormat(fileUri: string, fileName: string): Promise<ImportFormat> {
  if (fileName.endsWith('.buk')) return 'buk';

  try {
    const response = await fetch(fileUri);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    if (isPngSignature(bytes)) {
      return 'ccv2';
    }

    let text: string;
    if (isGzipSignature(bytes)) {
      const decompressed = pako.ungzip(bytes);
      text = new TextDecoder().decode(decompressed);
    } else {
      text = new TextDecoder().decode(buffer);
    }

    const json = JSON.parse(text);

    if (json.formatName === 'dexie' && json.data?.tables) {
      return 'perchance';
    }
    if (json.spec === 'chara_card_v2') return 'ccv2';
    if (json.name || json.first_mes || json.description) return 'ccv1';
  } catch (e) { console.warn('Failed to detect import format:', e); }

  throw new Error('Unrecognized file format');
}

async function readIconFile(uri: string): Promise<string | null> {
  try {
    if (uri.startsWith('data:')) {
      return uri.split(',')[1] || null;
    }
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1] || null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function importCharacter(fileUri: string): Promise<ImportResult> {
  const format = await detectImportFormat(fileUri, fileUri.split('/').pop() || '');

  if (format === 'buk') {
    throw new Error('Use importBuk() for .buk files');
  }

  const response = await fetch(fileUri);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let char: Character;
  let iconBase64: string | null = null;

  if (format === 'ccv2' && isPngSignature(bytes)) {
    const base64 = await readIconFile(fileUri);
    if (base64) {
      iconBase64 = base64;
      const metadata = readPngCharaMetadata(base64);
      if (metadata) {
        const json = JSON.parse(metadata);
        char = parseV2Json(json);
      } else {
        char = {id: generateId(), name: 'Unknown Character', description: '', personality: '', scenario: '', initialMessage: '', writingStyle: '', lorebookIds: []};
      }
    } else {
      char = {id: generateId(), name: 'Unknown Character', description: '', personality: '', scenario: '', initialMessage: '', writingStyle: '', lorebookIds: []};
    }
  } else {
    const text = new TextDecoder().decode(buffer);
    const json = JSON.parse(text);
    char = format === 'ccv2' ? parseV2Json(json) : parseV1Json(json);
  }

  if (iconBase64) {
    const iconPath = `${RNFS.DocumentDirectoryPath}/icons/${char.id}.png`;
    await RNFS.mkdir(`${RNFS.DocumentDirectoryPath}/icons`);
    await RNFS.writeFile(iconPath, iconBase64, 'base64');
    char.icon = `file://${iconPath}`;
  }

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
    lorebook_id: '',
  });

  return {character: char, format};
}

export async function importBuk(fileUri: string): Promise<BukImportResult> {
  const response = await fetch(fileUri);
  const buffer = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const result: BukImportResult = {
    characters: [],
    lorebooks: [],
    sessions: [],
    skippedCharacters: [],
  };

  // Import settings
  const settingsFile = zip.file('Bucket/settings.json');
  if (settingsFile) {
    try {
      const text = await settingsFile.async('string');
      result.settings = JSON.parse(text);
    } catch (e) { console.warn('Failed to import settings:', e); }
  }

  const promptFile = zip.file('Bucket/prompt.json');
  if (promptFile) {
    try {
      const text = await promptFile.async('string');
      const parsed = JSON.parse(text);
      delete parsed.apiUrl;
      delete parsed.apiKey;
      result.promptConfig = parsed;
    } catch (e) { console.warn('Failed to import prompt config:', e); }
  }

  // Import lorebooks
  const origLorebookIdToNewId = new Map<string, string>();
  const lorebookDir = zip.folder('lorebooks');
  if (lorebookDir) {
    const lorebookFiles = lorebookDir.filter(() => true);
    for (const [, file] of Object.entries(lorebookFiles)) {
      if (file.dir) continue;
      try {
        const text = await file.async('string');
        let entries: {id: number; text: string}[];
        let origId: string | undefined;
        try {
          const parsed = JSON.parse(text);
          entries = parsed.entries;
          origId = parsed.id;
        } catch {
          entries = text.split('\n').filter(l => l.trim().length > 0).map((t, i) => ({id: i, text: t}));
        }
        if (entries.length > 0) {
          const lorebook: LorebookState = {
            id: generateId(),
            entries,
            fileName: file.name.split('/').pop() || 'lorebook.txt',
          };
          if (origId) {
            origLorebookIdToNewId.set(origId, lorebook.id);
          }
          result.lorebooks.push(lorebook);
        }
      } catch (e) { console.warn('Failed to import lorebook:', e); }
    }
  }

  // Import characters
  const origIdToNewId = new Map<string, string>();
  const charDir = zip.folder('characters');
  if (charDir) {
    const charFiles = charDir.filter(() => true);
    for (const [, file] of Object.entries(charFiles)) {
      if (file.dir) continue;
      try {
        const text = await file.async('string');
        const json = JSON.parse(text);
        const origId = file.name.split('/').pop()?.split('.')[0];
        const char = json.spec === 'chara_card_v2' ? parseV2Json(json) : parseV1Json(json);

        if (origId) {
          origIdToNewId.set(origId, char.id);
        }

        const existing = await getAllCharactersFromDB();
        if (existing.some(c => c.name === char.name)) {
          result.skippedCharacters.push(char.name);
          continue;
        }

        if (!char.lorebookIds || char.lorebookIds.length === 0) {
          const assignedLorebook = result.lorebooks.find(l =>
            l.fileName.replace('.txt', '') === char.name
          );
          if (assignedLorebook) {
            char.lorebookIds = [assignedLorebook.id];
          }
        } else {
          char.lorebookIds = char.lorebookIds.map(id => {
            const mapped = origLorebookIdToNewId.get(id);
            if (mapped) return mapped;
            return id;
          });
        }

        result.characters.push(char);
      } catch (e) { console.warn('Failed to import character:', e); }
    }
  }

  // Import icons
  const iconDir = zip.folder('icons');
  if (iconDir) {
    const iconFiles = iconDir.filter(() => true);
    await RNFS.mkdir(`${RNFS.DocumentDirectoryPath}/icons`);
    for (const [, file] of Object.entries(iconFiles)) {
      if (file.dir) continue;
      try {
        const base64 = await file.async('base64');
        const origId = file.name.split('/').pop()?.split('.')[0];
        if (origId) {
          const newId = origIdToNewId.get(origId);
          const ext = file.name.split('.').pop() || 'png';
          const char = newId
            ? result.characters.find(c => c.id === newId)
            : result.characters.find(c => c.id === origId);
          if (char) {
            const iconPath = `${RNFS.DocumentDirectoryPath}/icons/${char.id}.${ext}`;
            await RNFS.writeFile(iconPath, base64, 'base64');
            char.icon = `file://${iconPath}`;
          }
        }
      } catch (e) { console.warn('Failed to import icon:', e); }
    }
  }

  // Import chats
  const chatDir = zip.folder('chats');
  if (chatDir) {
    const chatFiles = chatDir.filter(() => true);
    for (const [, file] of Object.entries(chatFiles)) {
      if (file.dir) continue;
      try {
        const text = await file.async('string');
        const session: ChatSession = JSON.parse(text);
        const newCharId = origIdToNewId.get(session.characterId);
        if (newCharId) {
          session.characterId = newCharId;
          if (session.lastReplyCharacterId) {
            const mapped = origIdToNewId.get(session.lastReplyCharacterId);
            if (mapped) session.lastReplyCharacterId = mapped;
          }
          for (const msg of session.messages) {
            if (msg.characterId) {
              const mapped = origIdToNewId.get(msg.characterId);
              if (mapped) msg.characterId = mapped;
            }
          }
        }
        result.sessions.push(session);
      } catch (e) { console.warn('Failed to import chat session:', e); }
    }
  }

  // Save everything to DB
  for (const lorebook of result.lorebooks) {
    await saveLorebookToDB(lorebook);
  }

  for (const char of result.characters) {
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

  for (const session of result.sessions) {
    try {
      await createSession(session);
    } catch (e) { console.warn('Failed to create session:', e); }
  }

  // Apply settings if present
  if (result.settings) {
    const currentSettings = JSON.parse(getKV('settings') || '{}');
    const merged = {...DEFAULT_APP_SETTINGS, ...currentSettings, ...result.settings};
    setKV('settings', JSON.stringify(merged));
  }

  if (result.promptConfig) {
    const currentConfig = getKV('promptConfig');
    const current = currentConfig ? JSON.parse(currentConfig) : {};
    const merged = {...DEFAULT_PROMPT_CONFIG, ...current, ...result.promptConfig};
    delete merged.apiUrl;
    delete merged.apiKey;
    setKV('promptConfig', JSON.stringify(merged));
  }

  return result;
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
  const tables = json.data?.data || [];

  const charTable = tables.find((t: any) => t.tableName === 'characters');
  const threadTable = tables.find((t: any) => t.tableName === 'threads');
  const messageTable = tables.find((t: any) => t.tableName === 'messages');

  const pCharacters: PerchanceCharacter[] = charTable?.rows || [];
  const pThreads: PerchanceThread[] = threadTable?.rows || [];
  const pMessages: PerchanceMessage[] = messageTable?.rows || [];

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

export async function exportCCV1(characters: Character[]): Promise<string> {
  const dir = `${RNFS.CachesDirectoryPath}/export`;
  await RNFS.mkdir(dir);

  if (characters.length === 1) {
    const json = serializeV1(characters[0]);
    const path = `${dir}/${characters[0].name || 'character'}.json`;
    await RNFS.writeFile(path, JSON.stringify(json, null, 2), 'utf8');
    return path;
  }

  const zip = new JSZip();
  for (const char of characters) {
    const json = serializeV1(char);
    zip.file(`${char.name || 'character'}.json`, JSON.stringify(json, null, 2));
  }
  const base64 = await zip.generateAsync({type: 'base64', compression: 'DEFLATE'});
  const path = `${dir}/characters.zip`;
  await RNFS.writeFile(path, base64, 'base64');
  return path;
}

export async function exportCCV2(characters: Character[]): Promise<string[]> {
  const dir = `${RNFS.CachesDirectoryPath}/export`;
  await RNFS.mkdir(dir);

  const paths: string[] = [];
  for (const char of characters) {
    const json = serializeV2(char);
    const jsonStr = JSON.stringify(json, null, 2);

    if (char.icon) {
      try {
        const iconBase64 = await readIconFile(char.icon);
        if (iconBase64) {
          const pngWithMeta = writePngWithCharaMetadata(iconBase64, jsonStr);
          const path = `${dir}/${char.name || 'character'}.png`;
          await RNFS.writeFile(path, pngWithMeta, 'base64');
          paths.push(path);
          continue;
        }
      } catch (e) { console.warn('Failed to export character icon:', e); }
    }

    const path = `${dir}/${char.name || 'character'}.json`;
    await RNFS.writeFile(path, jsonStr, 'utf8');
    paths.push(path);
  }

  return paths;
}

export async function exportBuk(options: ExportOptions): Promise<string> {
  const dir = `${RNFS.CachesDirectoryPath}/export`;
  await RNFS.mkdir(dir);

  const zip = new JSZip();

  const characters = (await getAllCharactersFromDB())
    .filter(c => options.characterIds.includes(c.id))
    .map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      initialMessage: c.initial_message,
      writingStyle: c.writing_style,
      personality: c.personality,
      scenario: c.scenario,
      exampleMessages: c.example_messages,
      icon: c.icon,
      lorebookIds: c.lorebook_id ? c.lorebook_id.split(',').filter(Boolean) : [],
    }));

  // Settings
  if (options.includeSettings) {
    const settingsRaw = getKV('settings');
    if (settingsRaw) {
      zip.file('Bucket/settings.json', settingsRaw);
    }

    const promptRaw = getKV('promptConfig');
    if (promptRaw) {
      const prompt = JSON.parse(promptRaw);
      delete prompt.apiUrl;
      delete prompt.apiKey;
      zip.file('Bucket/prompt.json', JSON.stringify(prompt, null, 2));
    }
  }

  // Characters
  const charFolder = zip.folder('characters');
  for (const char of characters) {
    const cc: Character = {
      id: char.id,
      name: char.name,
      description: char.description,
      initialMessage: char.initialMessage,
      writingStyle: char.writingStyle,
      personality: char.personality,
      scenario: char.scenario,
      exampleMessages: char.exampleMessages || undefined,
      lorebookIds: char.lorebookIds || [],
      icon: char.icon || undefined,
    };
    const json = serializeV2(cc);
    if (cc.lorebookIds && cc.lorebookIds.length > 0) {
      json.data.extensions.lorebookIds = cc.lorebookIds;
    }
    charFolder?.file(`${char.id}.json`, JSON.stringify(json, null, 2));
  }

  // Icons
  if (characters.some(c => c.icon)) {
    const iconFolder = zip.folder('icons');
    await RNFS.mkdir(`${RNFS.DocumentDirectoryPath}/icons`).catch(() => {});
    for (const char of characters) {
      if (!char.icon) continue;
      try {
        const base64 = await readIconFile(char.icon);
        if (base64) {
          const ext = char.icon.split('.').pop() || 'png';
          iconFolder?.file(`${char.id}.${ext}`, base64, {base64: true});
        }
      } catch (e) { console.warn('Failed to export icon:', e); }
    }
  }

  // Lorebooks
  if (options.includeLorebooks) {
    const lorebooks = await getAllLorebooksFromDB();
    const lorebookFolder = zip.folder('lorebooks');
    for (const lorebook of lorebooks) {
      const content = JSON.stringify({id: lorebook.id, entries: lorebook.entries});
      lorebookFolder?.file(`${lorebook.fileName}`, content);
    }
  }

  // Chats
  if (options.includeChats) {
    const chatFolder = zip.folder('chats');
    for (const charId of options.characterIds) {
      const sessions = getAllSessionsForCharacter(charId);
      for (const summary of sessions) {
        const session = await getSessionById(summary.id);
        if (session) {
          chatFolder?.file(`${session.id}.json`, JSON.stringify(session, null, 2));
        }
      }
    }
  }

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const filename = `${dateStr}@${timeStr}.buk`;

  const base64 = await zip.generateAsync({type: 'base64', compression: 'DEFLATE'});
  const path = `${dir}/${filename}`;
  await RNFS.writeFile(path, base64, 'base64');
  return path;
}

export async function saveToDisk(filePath: string, mimeType: string, fileName?: string): Promise<void> {
  const {saveDocuments} = await import('@react-native-documents/picker');
  const sourceUri = `file://${filePath}`;
  const result = await saveDocuments({
    sourceUris: [sourceUri],
    mimeType,
    fileName: fileName || filePath.split('/').pop(),
  });
  if (result[0]?.error) {
    throw new Error(result[0].error);
  }
}

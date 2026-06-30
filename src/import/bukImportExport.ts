import RNFS from 'react-native-fs';
import JSZip from 'jszip';
import {Character} from '../CharacterEditor';
import {LorebookState} from '../RAGHandler';
import {ChatSession} from '../useChat';
import {DEFAULT_PROMPT_CONFIG} from '../PromptHandler';
import {DEFAULT_APP_SETTINGS} from '../store';
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
} from '../Database';
import {readIconFile} from './util';
import {parseV1Json, parseV2Json, serializeV2} from './characterCardSchema';
import {BukImportResult, ExportOptions} from './types';

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

  if (options.includeLorebooks) {
    const lorebooks = await getAllLorebooksFromDB();
    const lorebookFolder = zip.folder('lorebooks');
    for (const lorebook of lorebooks) {
      const content = JSON.stringify({id: lorebook.id, entries: lorebook.entries});
      lorebookFolder?.file(`${lorebook.fileName}`, content);
    }
  }

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

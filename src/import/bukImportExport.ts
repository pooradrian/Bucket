import RNFS from 'react-native-fs';
import JSZip from 'jszip';
import {Character} from '../CharacterEditor';
import {parseCustomFields, getCustomField} from '../CustomFields';
import {LorebookState, lorebookDisplayName, lorebookExportName} from '../RAGHandler';
import {ChatSession} from '../useChat';
import {DEFAULT_PROMPT_CONFIG} from '../PromptHandler';
import {DEFAULT_APP_SETTINGS, GroupChat} from '../store';
import {
  generateId,
  saveCharacterToDB,
  getAllCharactersFromDB,
  saveLorebookToDB,
  getAllLorebooksFromDB,
  getLorebookEntriesFromDB,
  setKV,
  getKV,
  createSession,
  getAllSessionsForCharacter,
  getSessionsForGroupChat,
  getSessionById,
  getQuickCharactersForCharacter,
  getQuickCharactersForSession,
  saveQuickCharacter,
  getAllGroupChatsFromDB,
  saveGroupChatToDB,
  getDbConnection,
  SessionSummary,
  DBQuickCharacter,
} from '../Database';
import {readIconFile} from './util';
import {parseV1Json, parseV2Json, serializeV2} from './characterCardSchema';
import {BukImportResult, ExportOptions} from './types';

function normalizeQuickCharacter(
  qc: Partial<DBQuickCharacter>,
  sessionId: string,
  characterId: string,
): DBQuickCharacter | null {
  if (!qc.id) {
    return null;
  }
  return {
    id: qc.id,
    session_id: sessionId,
    character_id: characterId,
    name: qc.name ?? '',
    description: qc.description ?? '',
    personality: qc.personality ?? '',
    starred: qc.starred ?? 0,
    icon: qc.icon ?? '',
  };
}

export async function importBuk(fileUri: string): Promise<BukImportResult> {
  const response = await fetch(fileUri);
  const buffer = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const result: BukImportResult = {
    characters: [],
    lorebooks: [],
    sessions: [],
    quickCharacters: [],
    groups: [],
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
            entryCount: entries.length,
            fileName: lorebookDisplayName(file.name.split('/').pop() || 'lorebook'),
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
  const existingCharacterIdsByName = new Map<string, string>();
  for (const row of getDbConnection().execute('SELECT id, name FROM characters').results ?? []) {
    existingCharacterIdsByName.set(row.name as string, row.id as string);
  }
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

        const existingId = existingCharacterIdsByName.get(char.name);
        if (existingId) {
          if (origId) {
            origIdToNewId.set(origId, existingId);
          }
          result.skippedCharacters.push(char.name);
          continue;
        }

        if (origId) {
          origIdToNewId.set(origId, char.id);
        }
        existingCharacterIdsByName.set(char.name, char.id);

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
        const parsed = JSON.parse(text);
        const session: ChatSession = parsed;
        const qcs = parsed.quickCharacters as Array<Partial<DBQuickCharacter>> | undefined;
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
            if (msg.variants) {
              for (const variant of msg.variants) {
                if (variant.characterId) {
                  const mapped = origIdToNewId.get(variant.characterId);
                  if (mapped) variant.characterId = mapped;
                }
              }
            }
          }
        }
        result.sessions.push(session);
        if (qcs) {
          for (const qc of qcs) {
            const mappedCharId = qc.character_id ? origIdToNewId.get(qc.character_id) : undefined;
            const normalized = normalizeQuickCharacter(qc, session.id, mappedCharId ?? qc.character_id ?? '');
            if (normalized) {
              result.quickCharacters.push(normalized);
            }
          }
        }
      } catch (e) { console.warn('Failed to import chat session:', e); }
    }
  }

  const charQcDir = zip.folder('quickcharacters');
  if (charQcDir) {
    const charQcFiles = charQcDir.filter(() => true);
    for (const [, file] of Object.entries(charQcFiles)) {
      if (file.dir) continue;
      try {
        const parsed = JSON.parse(await file.async('string'));
        const mappedCharId = origIdToNewId.get(parsed.characterId);
        const qcs = (parsed.quickCharacters ?? []) as Array<Partial<DBQuickCharacter>>;
        for (const qc of qcs) {
          const normalized = normalizeQuickCharacter(qc, '', mappedCharId ?? parsed.characterId ?? '');
          if (normalized) {
            result.quickCharacters.push(normalized);
          }
        }
      } catch (e) { console.warn('Failed to import quick characters:', e); }
    }
  }

  const groupDir = zip.folder('groups');
  if (groupDir) {
    const groupFiles = groupDir.filter(() => true);
    for (const [, file] of Object.entries(groupFiles)) {
      if (file.dir) continue;
      try {
        const text = await file.async('string');
        const parsed = JSON.parse(text);
        result.groups.push({
          id: parsed.id,
          name: parsed.name,
          description: parsed.description || '',
          icon: parsed.icon || undefined,
          characterIds: Array.isArray(parsed.characterIds) ? parsed.characterIds : [],
        });
      } catch (e) { console.warn('Failed to import group:', e); }
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
      writing_style: getCustomField(char, 'writingStyle'),
      personality: char.personality,
      scenario: char.scenario,
      example_messages: char.exampleMessages || '',
      icon: char.icon || '',
      lorebook_id: (char.lorebookIds || []).join(','),
      custom_fields: JSON.stringify(char.customFields || []),
      persona_id: char.personaId || '',
    });
  }

  const validCharIds = new Set(
    (getDbConnection().execute('SELECT id FROM characters').results ?? []).map(row => row.id as string),
  );
  const existingGroupIds = new Set(
    (getDbConnection().execute('SELECT id FROM group_chats').results ?? []).map(row => row.id as string),
  );
  const existingQcIds = new Set(
    (getDbConnection().execute('SELECT id FROM quick_characters').results ?? []).map(row => row.id as string),
  );
  const existingSessionIds = new Set(
    (getDbConnection().execute('SELECT id FROM chat_sessions').results ?? []).map(row => row.id as string),
  );

  const importedGroups: GroupChat[] = [];
  for (const group of result.groups) {
    if (existingGroupIds.has(group.id)) {
      continue;
    }
    const memberIds = group.characterIds
      .map(id => origIdToNewId.get(id) ?? id)
      .filter(id => validCharIds.has(id));
    if (memberIds.length === 0) {
      console.warn(`Skipped group ${group.name}: no valid members`);
      continue;
    }
    try {
      await saveGroupChatToDB({
        id: group.id,
        name: group.name,
        description: group.description || '',
        icon: group.icon || '',
        characterIds: memberIds,
      });
      importedGroups.push(group);
    } catch (e) { console.warn('Failed to import group:', e); }
  }
  result.groups = importedGroups;

  const importedSessions: ChatSession[] = [];
  for (const session of result.sessions) {
    if (existingSessionIds.has(session.id)) {
      continue;
    }
    try {
      await createSession(session);
      importedSessions.push(session);
    } catch (e) { console.warn('Failed to create session:', e); }
  }
  result.sessions = importedSessions;

  const importedQcs: DBQuickCharacter[] = [];
  for (const qc of result.quickCharacters) {
    if (existingQcIds.has(qc.id)) {
      continue;
    }
    try {
      await saveQuickCharacter(qc);
      importedQcs.push(qc);
    } catch (e) { console.warn('Failed to create quick character:', e); }
  }
  result.quickCharacters = importedQcs;

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

function stripRequestInfo<T extends {messages: Array<{requestInfo?: string}>}>(session: T): T {
  return {
    ...session,
    messages: session.messages.map(({requestInfo: _, ...m}) => m),
  };
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
      customFields: parseCustomFields(c.custom_fields),
      personality: c.personality,
      scenario: c.scenario,
      exampleMessages: c.example_messages,
      icon: c.icon,
      lorebookIds: c.lorebook_id ? c.lorebook_id.split(',').filter(Boolean) : [],
      personaId: c.persona_id || undefined,
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
      personality: char.personality,
      scenario: char.scenario,
      exampleMessages: char.exampleMessages || undefined,
      lorebookIds: char.lorebookIds || [],
      icon: char.icon || undefined,
      customFields: char.customFields,
      personaId: char.personaId,
    };
    const json = serializeV2(cc);
    if (cc.lorebookIds && cc.lorebookIds.length > 0) {
      json.data.extensions.lorebookIds = cc.lorebookIds;
    }
    if (cc.customFields && cc.customFields.length > 0) {
      json.data.extensions.bucket = {customFields: cc.customFields};
    }
    if (cc.personaId) {
      const bucket = json.data.extensions.bucket ?? {};
      json.data.extensions.bucket = {...bucket, personaId: cc.personaId};
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
      const entries = await getLorebookEntriesFromDB(lorebook.id);
      const content = JSON.stringify({id: lorebook.id, entries});
      lorebookFolder?.file(lorebookExportName(lorebook.fileName), content);
    }
  }

  if (options.groupIds.length > 0) {
    const allGroups = await getAllGroupChatsFromDB();
    const selectedGroups = allGroups.filter(g => options.groupIds.includes(g.id));
    if (selectedGroups.length > 0) {
      const groupFolder = zip.folder('groups');
      for (const group of selectedGroups) {
        groupFolder?.file(`${group.id}.json`, JSON.stringify({
          id: group.id,
          name: group.name,
          description: group.description,
          icon: group.icon,
          characterIds: group.characterIds,
        }, null, 2));
      }
    }
  }

  const exportedSessionIds = new Set<string>();
  const exportedQcIds = new Set<string>();
  if (options.includeChats) {
    const chatFolder = zip.folder('chats');
    const exportSessions = async (summaries: SessionSummary[]) => {
      for (const summary of summaries) {
        const session = await getSessionById(summary.id);
        if (!session) continue;
        const quickCharacters = await getQuickCharactersForSession(session.id);
        const payload = stripRequestInfo({...session, quickCharacters});
        chatFolder?.file(`${session.id}.json`, JSON.stringify(payload, null, 2));
        exportedSessionIds.add(session.id);
        for (const qc of quickCharacters) {
          exportedQcIds.add(qc.id);
        }
      }
    };
    for (const charId of options.characterIds) {
      await exportSessions(await getAllSessionsForCharacter(charId));
    }
    for (const groupId of options.groupIds) {
      await exportSessions(await getSessionsForGroupChat(groupId));
    }
  }

  for (const charId of options.characterIds) {
    const dangling = (await getQuickCharactersForCharacter(charId, '')).filter(
      qc => qc.starred && !exportedSessionIds.has(qc.session_id) && !exportedQcIds.has(qc.id),
    );
    if (dangling.length === 0) continue;
    for (const qc of dangling) {
      exportedQcIds.add(qc.id);
    }
    zip.folder('quickcharacters')?.file(
      `${charId}.json`,
      JSON.stringify({
        characterId: charId,
        quickCharacters: dangling.map(qc => ({...qc, session_id: ''})),
      }, null, 2),
    );
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

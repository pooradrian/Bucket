jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn().mockResolvedValue([]),
  saveDocuments: jest.fn().mockResolvedValue([]),
  isKnownType: jest.fn().mockReturnValue(true),
  types: {allFiles: 'public.all-files'},
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: {WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly'},
}));

jest.mock('react-native-nitro-sqlite', () => {
  const {DatabaseSync} = require('node:sqlite');
  const conn = new DatabaseSync(':memory:');
  return {
    open: jest.fn(() => ({
      execute: (sql: string, params: (string | number | null)[] = []) => {
        const returnsRows = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql);
        const stmt = conn.prepare(sql);
        if (returnsRows) {
          return {results: stmt.all(...params)};
        }
        const info = stmt.run(...params);
        return {results: [], rowsAffected: Number(info.changes)};
      },
    })),
  };
});

import RNFS from 'react-native-fs';
import JSZip from 'jszip';
import {
  initDB,
  saveCharacterToDB,
  createSession,
  saveQuickCharacter,
  saveGroupChatToDB,
  getAllCharactersFromDB,
  getAllGroupChatsFromDB,
  getQuickCharactersForCharacter,
  getQuickCharactersForSession,
  getAllSessionsForCharacter,
  getSessionById,
  deleteSession,
} from '../src/Database';
import {exportBuk, importBuk} from '../src/import/bukImportExport';
import type {ChatSession} from '../src/useChat';

const db = () => initDB();

function clearAll() {
  for (const table of [
    'quick_characters',
    'chat_messages',
    'chat_sessions',
    'group_chat_members',
    'group_chats',
    'characters',
    'lorebook_entries',
    'lorebooks',
    'kv_store',
  ]) {
    db().execute(`DELETE FROM ${table}`);
  }
}

let bundleBase64: string | null = null;

async function exportBundle(charIds: string[], groupIds: string[] = [], includeChats = true) {
  bundleBase64 = null;
  await exportBuk({
    format: 'buk',
    characterIds: charIds,
    groupIds,
    includeSettings: false,
    includeLorebooks: false,
    includeChats,
  });
  const writeFile = RNFS.writeFile as jest.Mock;
  const lastCall = writeFile.mock.calls[writeFile.mock.calls.length - 1];
  bundleBase64 = lastCall[1];
  expect(bundleBase64).toBeTruthy();
  return bundleBase64;
}

async function importBundle() {
  const bytes = Buffer.from(bundleBase64!, 'base64');
  global.fetch = jest.fn().mockResolvedValue({
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }) as unknown as typeof fetch;
  return importBuk('file:///tmp/bundle.buk');
}

const charId = 'char-1';
const sessionId = 'sess-1';
const starredQcId = 'qc-starred';
const sessionQcId = 'qc-session';

beforeEach(async () => {
  clearAll();
  await saveCharacterToDB({
    id: charId,
    name: 'Alice',
    description: 'A detective',
    initial_message: 'Hi',
    writing_style: '',
    personality: 'calm',
    scenario: 'noir',
    example_messages: '',
    icon: '',
    lorebook_id: '',
    custom_fields: '',
    persona_id: '',
  });
  const session: ChatSession = {
    id: sessionId,
    characterId: charId,
    messages: [
      {id: 'm1', role: 'user', content: 'hello alice', timestamp: 1000},
      {id: 'm2', role: 'assistant', content: 'hi there', timestamp: 2000},
    ],
    createdAt: 1000,
    updatedAt: 2000,
  };
  await createSession(session);
  await saveQuickCharacter({
    id: starredQcId,
    session_id: sessionId,
    character_id: charId,
    name: 'Starred QC',
    description: 'starred description',
    personality: 'grumpy',
    starred: 1,
  });
  await saveQuickCharacter({
    id: sessionQcId,
    session_id: sessionId,
    character_id: '',
    name: 'Session QC',
    description: 'session description',
    personality: 'sunny',
    starred: 0,
  });
});

describe('fresh device import', () => {
  test('quick characters survive export + import', async () => {
    await exportBundle([charId]);
    clearAll();

    const result = await importBundle();
    expect(result.skippedCharacters).toEqual([]);
    expect(result.quickCharacters).toHaveLength(2);

    const chars = await getAllCharactersFromDB();
    expect(chars).toHaveLength(1);
    const newCharId = chars[0].id;

    const qcs = await getQuickCharactersForSession(sessionId);
    const names = qcs.map(q => q.name).sort();
    expect(names).toEqual(['Session QC', 'Starred QC']);

    const starred = qcs.find(q => q.id === starredQcId)!;
    expect(starred.description).toBe('starred description');
    expect(starred.personality).toBe('grumpy');
    expect(starred.starred).toBe(1);
    expect(starred.character_id).toBe(newCharId);

    const sessionScoped = qcs.find(q => q.id === sessionQcId)!;
    expect(sessionScoped.description).toBe('session description');
    expect(sessionScoped.personality).toBe('sunny');
    expect(sessionScoped.starred).toBe(0);

    const byCharacter = await getQuickCharactersForCharacter(newCharId, '');
    expect(byCharacter.map(q => q.name)).toEqual(['Starred QC']);

    const sessions = await getAllSessionsForCharacter(newCharId);
    expect(sessions).toHaveLength(1);
    const loaded = await getSessionById(sessions[0].id);
    expect(loaded!.messages.map(m => m.content)).toEqual(['hello alice', 'hi there']);
  });
});

describe('re-import into the same database', () => {
  test('quick characters keep pointing at the real character', async () => {
    await exportBundle([charId]);
    const result = await importBundle();

    expect(result.skippedCharacters).toEqual(['Alice']);

    const chars = await getAllCharactersFromDB();
    expect(chars).toHaveLength(1);
    const realCharId = chars[0].id;

    const qcs = await getQuickCharactersForCharacter(realCharId, '');
    const starred = qcs.find(q => q.id === starredQcId);
    expect(starred).toBeDefined();
    expect(starred!.character_id).toBe(realCharId);
    expect(starred!.description).toBe('starred description');
  });

  test('re-import does not overwrite quick characters that already exist', async () => {
    await saveQuickCharacter({
      id: starredQcId,
      session_id: sessionId,
      character_id: charId,
      name: 'Starred QC',
      description: 'edited locally after the backup was taken',
      personality: 'grumpy',
      starred: 1,
    });

    await exportBundle([charId]);
    await importBundle();

    const starred = (await getQuickCharactersForSession(sessionId)).find(q => q.id === starredQcId);
    expect(starred!.description).toBe('edited locally after the backup was taken');
  });
});

describe('importing chats for a character that already exists', () => {
  test('session and starred quick character stay linked to the existing character', async () => {
    await exportBundle([charId]);
    clearAll();
    await saveCharacterToDB({
      id: 'char-existing',
      name: 'Alice',
      description: 'already on this device',
      initial_message: 'Hi',
      writing_style: '',
      personality: 'calm',
      scenario: 'noir',
      example_messages: '',
      icon: '',
      lorebook_id: '',
      custom_fields: '',
      persona_id: '',
    });

    const result = await importBundle();
    expect(result.skippedCharacters).toEqual(['Alice']);

    const sessions = await getAllSessionsForCharacter('char-existing');
    expect(sessions).toHaveLength(1);

    const qcs = await getQuickCharactersForCharacter('char-existing', '');
    const starred = qcs.find(q => q.id === starredQcId);
    expect(starred).toBeDefined();
    expect(starred!.character_id).toBe('char-existing');
    expect(starred!.description).toBe('starred description');
  });
});

describe('group round trip', () => {
  test('group survives export and re-import when its member already exists', async () => {
    await saveGroupChatToDB({
      id: 'group-1',
      name: 'Gang',
      description: 'friends',
      icon: '',
      characterIds: [charId],
    });

    await exportBundle([charId], ['group-1']);
    db().execute('DELETE FROM group_chat_members');
    db().execute('DELETE FROM group_chats');

    const result = await importBundle();
    expect(result.groups.map(g => g.name)).toEqual(['Gang']);

    const after = await getAllGroupChatsFromDB();
    expect(after.map(g => g.name)).toEqual(['Gang']);
    expect(after[0].characterIds).toEqual([charId]);
  });
});

describe('starred quick characters outlive their session', () => {
  test('one whose session was deleted is still exported and reimported', async () => {
    deleteSession(sessionId);
    await exportBundle([charId]);

    const bundle = await JSZip.loadAsync(Buffer.from(bundleBase64!, 'base64'));
    expect(bundle.file('quickcharacters/char-1.json')).not.toBeNull();

    clearAll();
    const result = await importBundle();

    expect(result.quickCharacters.map(q => q.id)).toEqual([starredQcId]);

    const [importedChar] = await getAllCharactersFromDB();
    const qcs = await getQuickCharactersForCharacter(importedChar.id, '');
    expect(qcs.map(q => q.name)).toEqual(['Starred QC']);
    expect(qcs[0].character_id).toBe(importedChar.id);
    expect(qcs[0].description).toBe('starred description');
  });

  test('they survive an export that leaves chat history out', async () => {
    await exportBundle([charId], [], false);

    clearAll();
    const result = await importBundle();
    expect(result.sessions).toEqual([]);
    expect(result.quickCharacters.map(q => q.id)).toEqual([starredQcId]);

    const [importedChar] = await getAllCharactersFromDB();
    const qcs = await getQuickCharactersForCharacter(importedChar.id, '');
    expect(qcs.map(q => q.name)).toEqual(['Starred QC']);
  });
});

describe('quick character icon bundling', () => {
  const dataIcon = 'data:image/png;base64,aWNvbg==';

  const fsReadFile = RNFS.readFile as jest.Mock;
  const deviceIcon = 'file:///data/user/0/bucket/files/icons/starred-src.png';

  beforeEach(() => {
    fsReadFile.mockResolvedValue('aWNvbg==');
  });

  afterEach(() => {
    fsReadFile.mockResolvedValue('');
  });

  test('qc icons export as image files, like character icons', async () => {
    await saveCharacterToDB({
      id: charId,
      name: 'Alice',
      description: 'A detective',
      initial_message: 'Hi',
      writing_style: '',
      personality: 'calm',
      scenario: 'noir',
      example_messages: '',
      icon: deviceIcon,
      lorebook_id: '',
      custom_fields: '',
      persona_id: '',
    });
    await saveQuickCharacter({
      id: starredQcId,
      session_id: sessionId,
      character_id: charId,
      name: 'Starred QC',
      description: 'starred description',
      personality: 'grumpy',
      starred: 1,
      icon: deviceIcon,
    });

    await exportBundle([charId]);
    const bundle = await JSZip.loadAsync(Buffer.from(bundleBase64!, 'base64'));

    const charImage = bundle.file(`icons/${charId}.png`);
    const qcImage = bundle.file(`qcicons/${starredQcId}.png`);
    expect(charImage).not.toBeNull();
    expect(qcImage).not.toBeNull();
    expect(await charImage!.async('string')).toBe('icon');
    expect(await qcImage!.async('string')).toBe('icon');
  });

  test('chats JSON carries no icon paths or payloads', async () => {
    await saveQuickCharacter({
      id: starredQcId,
      session_id: sessionId,
      character_id: charId,
      name: 'Starred QC',
      description: 'starred description',
      personality: 'grumpy',
      starred: 1,
      icon: deviceIcon,
    });

    await exportBundle([charId]);
    const bundle = await JSZip.loadAsync(Buffer.from(bundleBase64!, 'base64'));
    const chat = JSON.parse(await bundle.file(`chats/${sessionId}.json`)!.async('string'));
    for (const qc of chat.quickCharacters) {
      expect(qc.icon).toBe('');
    }
  });

  test('dangling quick characters export their icon image too', async () => {
    await saveQuickCharacter({
      id: starredQcId,
      session_id: sessionId,
      character_id: charId,
      name: 'Starred QC',
      description: 'starred description',
      personality: 'grumpy',
      starred: 1,
      icon: deviceIcon,
    });
    deleteSession(sessionId);

    await exportBundle([charId]);
    const bundle = await JSZip.loadAsync(Buffer.from(bundleBase64!, 'base64'));
    expect(bundle.file(`qcicons/${starredQcId}.png`)).not.toBeNull();
    const file = bundle.file(`quickcharacters/${charId}.json`);
    expect(file).not.toBeNull();
    const parsed = JSON.parse(await file!.async('string'));
    expect(parsed.quickCharacters.find((q: {id: string}) => q.id === starredQcId).icon).toBe('');
  });

  test('icons transfer to a fresh device under a local path', async () => {
    await saveQuickCharacter({
      id: sessionQcId,
      session_id: sessionId,
      character_id: '',
      name: 'Session QC',
      description: 'session description',
      personality: 'sunny',
      starred: 0,
      icon: dataIcon,
    });

    await exportBundle([charId]);
    clearAll();
    const result = await importBundle();

    const qcs = await getQuickCharactersForSession(sessionId);
    const sessionQc = qcs.find(q => q.id === sessionQcId)!;
    expect(sessionQc.icon).toMatch(new RegExp(`^file:///tmp/documents/icons/qc-${sessionQcId}\\.png$`));

    const writeFile = RNFS.writeFile as jest.Mock;
    const iconWrite = writeFile.mock.calls.find(c => String(c[0]).includes(`qc-${sessionQcId}`));
    expect(iconWrite).toBeTruthy();
    expect(iconWrite![1]).toBe('aWNvbg==');

    const imported = result.quickCharacters.find(q => q.id === sessionQcId)!;
    expect(imported.icon).toBe(sessionQc.icon);
  });

  test('a bundle without icons still imports quick characters', async () => {
    await exportBundle([charId]);
    clearAll();
    const result = await importBundle();
    expect(result.quickCharacters).toHaveLength(2);
    const qcs = await getQuickCharactersForSession(sessionId);
    expect(qcs.every(q => q.icon === '')).toBe(true);
  });
});

describe('import result only reports what was written', () => {
  test('re-importing an unchanged bundle reports nothing new', async () => {
    await saveGroupChatToDB({
      id: 'group-1',
      name: 'Gang',
      description: 'friends',
      icon: '',
      characterIds: [charId],
    });
    await exportBundle([charId], ['group-1']);

    const result = await importBundle();
    expect(result.sessions).toEqual([]);
    expect(result.groups).toEqual([]);
    expect(result.quickCharacters).toEqual([]);
    expect(result.skippedCharacters).toEqual(['Alice']);
  });
});

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn().mockResolvedValue([]),
  saveDocuments: jest.fn().mockResolvedValue([]),
  isKnownType: jest.fn().mockReturnValue(true),
  types: { allFiles: 'public.all-files' },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
  },
}));

jest.mock('react-native-nitro-sqlite', () => {
  const { DatabaseSync } = require('node:sqlite');
  const conn = new DatabaseSync(':memory:');
  return {
    open: jest.fn(() => ({
      execute: (sql: string, params: (string | number | null)[] = []) => {
        const returnsRows = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql);
        const stmt = conn.prepare(sql);
        if (returnsRows) {
          return { results: stmt.all(...params) };
        }
        const info = stmt.run(...params);
        return { results: [], rowsAffected: Number(info.changes) };
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
  getAllFoldersFromDB,
  saveFolderToDB,
  setCharacterFolder,
  getQuickCharactersForCharacter,
  getQuickCharactersForSession,
  getAllSessionsForCharacter,
  getSessionById,
  deleteSession,
  saveMemoryToDB,
  getAllMemoriesFromDB,
} from '../src/Database';
import { exportBuk, importBuk } from '../src/import/bukImportExport';
import type { ChatSession } from '../src/useChat';
import {
  Attachment,
  attachmentLabel,
  loadAttachmentBase64,
  saveAttachment,
} from '../src/Attachments';

const db = () => initDB();

function clearAll() {
  for (const table of [
    'quick_characters',
    'chat_messages',
    'chat_sessions',
    'group_chat_members',
    'group_chats',
    'characters',
    'folders',
    'lorebook_entries',
    'lorebooks',
    'kv_store',
    'memories',
  ]) {
    db().execute(`DELETE FROM ${table}`);
  }
}

let bundleBase64: string | null = null;

async function exportBundle(
  charIds: string[],
  groupIds: string[] = [],
  includeChats = true,
  folderIds: string[] = getAllFoldersFromDB().map(f => f.id),
) {
  bundleBase64 = null;
  await exportBuk({
    format: 'buk',
    characterIds: charIds,
    groupIds,
    folderIds,
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
    folder_id: '',
  });
  const session: ChatSession = {
    id: sessionId,
    characterId: charId,
    messages: [
      { id: 'm1', role: 'user', content: 'hello alice', timestamp: 1000 },
      { id: 'm2', role: 'assistant', content: 'hi there', timestamp: 2000 },
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
    expect(loaded!.messages.map(m => m.content)).toEqual([
      'hello alice',
      'hi there',
    ]);
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

    const starred = (await getQuickCharactersForSession(sessionId)).find(
      q => q.id === starredQcId,
    );
    expect(starred!.description).toBe(
      'edited locally after the backup was taken',
    );
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
      folder_id: '',
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

describe('folder round trip', () => {
  test('folder and its assignments survive a fresh device import', async () => {
    saveFolderToDB({ id: 'folder-1', name: 'Noir' });
    setCharacterFolder(charId, 'folder-1');

    await exportBundle([charId]);
    clearAll();

    const result = await importBundle();
    expect(result.folders.map(f => f.name)).toEqual(['Noir']);

    const folders = getAllFoldersFromDB();
    expect(folders.map(f => f.name)).toEqual(['Noir']);

    const [importedChar] = await getAllCharactersFromDB();
    expect(importedChar.folder_id).toBe(folders[0].id);
  });

  test('re-import merges into an existing folder of the same name', async () => {
    saveFolderToDB({ id: 'folder-1', name: 'Noir' });
    setCharacterFolder(charId, 'folder-1');
    await exportBundle([charId]);

    clearAll();
    saveFolderToDB({ id: 'folder-local', name: 'Noir' });

    const result = await importBundle();
    expect(result.folders.map(f => f.id)).toEqual(['folder-local']);

    const folders = getAllFoldersFromDB();
    expect(folders.map(f => f.id)).toEqual(['folder-local']);

    const [importedChar] = await getAllCharactersFromDB();
    expect(importedChar.folder_id).toBe('folder-local');
  });

  test('re-importing into the same database keeps the existing folder', async () => {
    saveFolderToDB({ id: 'folder-1', name: 'Noir' });
    setCharacterFolder(charId, 'folder-1');
    await exportBundle([charId]);

    const result = await importBundle();
    expect(result.skippedCharacters).toEqual(['Alice']);
    expect(getAllFoldersFromDB().map(f => f.id)).toEqual(['folder-1']);

    const [importedChar] = await getAllCharactersFromDB();
    expect(importedChar.folder_id).toBe('folder-1');
  });

  test('folders without selected characters are left out of the bundle', async () => {
    saveFolderToDB({ id: 'folder-1', name: 'Noir' });
    saveFolderToDB({ id: 'folder-2', name: 'Fantasy' });
    setCharacterFolder(charId, 'folder-1');

    await exportBundle([charId]);
    const bundle = await JSZip.loadAsync(Buffer.from(bundleBase64!, 'base64'));
    expect(bundle.file('folders/folder-1.json')).not.toBeNull();
    expect(bundle.file('folders/folder-2.json')).toBeNull();
  });

  test('only selected folders are put in the bundle', async () => {
    saveFolderToDB({ id: 'folder-1', name: 'Noir' });
    saveFolderToDB({ id: 'folder-2', name: 'Fantasy' });
    setCharacterFolder(charId, 'folder-1');
    await saveCharacterToDB({
      id: 'char-2',
      name: 'Bob',
      description: '',
      initial_message: '',
      writing_style: '',
      personality: '',
      scenario: '',
      example_messages: '',
      icon: '',
      lorebook_id: '',
      custom_fields: '',
      persona_id: '',
      folder_id: '',
    });
    setCharacterFolder('char-2', 'folder-2');

    await exportBundle([charId, 'char-2'], [], true, ['folder-2']);
    const bundle = await JSZip.loadAsync(Buffer.from(bundleBase64!, 'base64'));
    expect(bundle.file('folders/folder-1.json')).toBeNull();
    expect(bundle.file('folders/folder-2.json')).not.toBeNull();

    const folderJson = JSON.parse(
      (await bundle.file('folders/folder-2.json')!.async('string')) as string,
    );
    expect(folderJson.characterIds).toEqual(['char-2']);
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
      folder_id: '',
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
    const chat = JSON.parse(
      await bundle.file(`chats/${sessionId}.json`)!.async('string'),
    );
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
    expect(
      parsed.quickCharacters.find((q: { id: string }) => q.id === starredQcId)
        .icon,
    ).toBe('');
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
    expect(sessionQc.icon).toMatch(
      new RegExp(`^file:///tmp/documents/icons/qc-${sessionQcId}\\.png$`),
    );

    const writeFile = RNFS.writeFile as jest.Mock;
    const iconWrite = writeFile.mock.calls.find(c =>
      String(c[0]).includes(`qc-${sessionQcId}`),
    );
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

describe('attachments', () => {
  const files = new Map<string, string>();

  beforeEach(() => {
    files.clear();
    (RNFS.writeFile as jest.Mock).mockImplementation(
      async (path: string, data: string) => {
        files.set(path, data);
      },
    );
    (RNFS.readFile as jest.Mock).mockImplementation(async (path: string) => {
      if (!files.has(path)) throw new Error('ENOENT');
      return files.get(path);
    });
  });

  afterEach(() => {
    (RNFS.writeFile as jest.Mock).mockReset().mockResolvedValue(undefined);
    (RNFS.readFile as jest.Mock).mockReset().mockResolvedValue('');
  });

  test('attachment bytes ride in the bundle and come back under new ids', async () => {
    const b64 = Buffer.from('PNGBYTES').toString('base64');
    const att = await saveAttachment({
      kind: 'image',
      name: 'cat.png',
      mime: 'image/png',
      base64: b64,
    });
    const gone: Attachment = {
      id: 'deadbeef',
      kind: 'file',
      name: 'lost.pdf',
      mime: 'application/pdf',
      size: 10,
    };
    await createSession({
      id: 'sess-att',
      characterId: charId,
      messages: [
        {
          id: 'a1',
          role: 'user',
          content: 'look',
          timestamp: 3000,
          attachments: [att],
        },
        {
          id: 'a2',
          role: 'user',
          content: attachmentLabel([gone]),
          timestamp: 3100,
          attachments: [gone],
        },
      ],
      createdAt: 3000,
      updatedAt: 3100,
    });

    await exportBundle([charId]);
    const zip = await JSZip.loadAsync(Buffer.from(bundleBase64!, 'base64'));
    expect(await zip.file(`attachments/${att.id}`)!.async('base64')).toBe(b64);

    clearAll();
    files.clear();
    await importBundle();

    const imported = await getSessionById('sess-att');
    expect(imported).not.toBeNull();
    // The unrecoverable attachment-only message is dropped.
    expect(imported!.messages.map(m => m.id)).toEqual(['a1']);
    const restored = imported!.messages[0].attachments!;
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe('cat.png');
    expect(restored[0].id).not.toBe(att.id);
    expect(await loadAttachmentBase64(restored[0].id)).toBe(b64);
  });
});

async function saveBob(id = 'char-2') {
  await saveCharacterToDB({
    id,
    name: 'Bob',
    description: '',
    initial_message: '',
    writing_style: '',
    personality: '',
    scenario: '',
    example_messages: '',
    icon: '',
    lorebook_id: '',
    custom_fields: '',
    persona_id: '',
    folder_id: '',
  });
}

async function dropFromBundle(paths: string[]) {
  const zip = await JSZip.loadAsync(Buffer.from(bundleBase64!, 'base64'));
  for (const path of paths) {
    expect(zip.file(path)).not.toBeNull();
    zip.remove(path);
  }
  bundleBase64 = await zip.generateAsync({ type: 'base64' });
}

async function saveSessionMemory(scopeSessionId: string) {
  await saveMemoryToDB({
    id: `mem-${scopeSessionId}`,
    scopeId: `session:${scopeSessionId}`,
    text: `remembered in ${scopeSessionId}`,
    vector: [],
    vectorKey: '',
    sourceSessionId: scopeSessionId,
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: 0,
    pinned: false,
  });
}

describe('speaker ids are remapped on import', () => {
  test('group chat messages, variants and last reply point at the new characters', async () => {
    await saveBob();
    await saveGroupChatToDB({
      id: 'group-1',
      name: 'Gang',
      description: '',
      icon: '',
      characterIds: [charId, 'char-2'],
    });
    await createSession({
      id: 'sess-group',
      characterId: '',
      groupChatId: 'group-1',
      lastReplyCharacterId: 'char-2',
      messages: [
        { id: 'g1', role: 'user', content: 'hi all', timestamp: 1000 },
        {
          id: 'g2',
          role: 'assistant',
          content: 'hi from alice',
          timestamp: 2000,
          characterId: charId,
        },
        {
          id: 'g3',
          role: 'assistant',
          content: 'hi from bob',
          timestamp: 3000,
          characterId: 'char-2',
          variants: [
            {
              id: 'v1',
              content: 'alice cut in',
              timestamp: 3000,
              characterId: charId,
            },
            {
              id: 'v2',
              content: 'hi from bob',
              timestamp: 3001,
              characterId: 'char-2',
            },
          ],
        },
      ],
      createdAt: 1000,
      updatedAt: 3000,
    });

    await exportBundle([charId, 'char-2'], ['group-1']);
    clearAll();
    const result = await importBundle();
    expect(result.groups.map(g => g.id)).toEqual(['group-1']);

    const chars = await getAllCharactersFromDB();
    const aliceId = chars.find(c => c.name === 'Alice')!.id;
    const bobId = chars.find(c => c.name === 'Bob')!.id;
    expect(aliceId).not.toBe(charId);
    expect(bobId).not.toBe('char-2');

    const session = await getSessionById('sess-group');
    expect(session).not.toBeNull();
    expect(session!.characterId).toBe('');
    expect(session!.groupChatId).toBe('group-1');
    expect(session!.lastReplyCharacterId).toBe(bobId);
    expect(session!.messages.map(m => m.characterId || '')).toEqual([
      '',
      aliceId,
      bobId,
    ]);
    expect(session!.messages[2].variants!.map(v => v.characterId)).toEqual([
      aliceId,
      bobId,
    ]);
  });

  test('a solo chat keeps quick character speaker ids', async () => {
    await createSession({
      id: 'sess-qc',
      characterId: charId,
      lastReplyCharacterId: sessionQcId,
      messages: [
        { id: 'q1', role: 'user', content: 'hey', timestamp: 1000 },
        {
          id: 'q2',
          role: 'assistant',
          content: 'from the qc',
          timestamp: 2000,
          characterId: sessionQcId,
          variants: [
            {
              id: 'qv1',
              content: 'from the qc',
              timestamp: 2000,
              characterId: sessionQcId,
            },
            {
              id: 'qv2',
              content: 'from alice',
              timestamp: 2001,
              characterId: charId,
            },
          ],
        },
      ],
      createdAt: 1000,
      updatedAt: 2000,
    });
    await saveQuickCharacter({
      id: sessionQcId,
      session_id: 'sess-qc',
      character_id: '',
      name: 'Session QC',
      description: '',
      personality: '',
      starred: 0,
    });

    await exportBundle([charId]);
    clearAll();
    await importBundle();

    const [alice] = await getAllCharactersFromDB();
    const session = await getSessionById('sess-qc');
    expect(session!.characterId).toBe(alice.id);
    expect(session!.lastReplyCharacterId).toBe(sessionQcId);
    expect(session!.messages[1].characterId).toBe(sessionQcId);
    expect(session!.messages[1].variants!.map(v => v.characterId)).toEqual([
      sessionQcId,
      alice.id,
    ]);
    const qcs = await getQuickCharactersForSession('sess-qc');
    expect(qcs.map(q => q.id)).toEqual([sessionQcId]);
  });
});

describe('sessions without an owner are not imported', () => {
  test('a solo session whose character is absent is skipped with its quick characters and memories', async () => {
    await saveSessionMemory(sessionId);
    await exportBundle([charId]);
    await dropFromBundle([`characters/${charId}.json`]);
    clearAll();

    const result = await importBundle();
    expect(result.sessions).toEqual([]);
    expect(result.quickCharacters).toEqual([]);
    expect(result.memories).toBe(0);
    expect(await getSessionById(sessionId)).toBeNull();
    expect(await getQuickCharactersForSession(sessionId)).toEqual([]);
    expect(await getAllMemoriesFromDB()).toEqual([]);
  });

  test('a solo session whose character already exists under the same id still imports', async () => {
    await exportBundle([charId]);
    await dropFromBundle([`characters/${charId}.json`]);
    deleteSession(sessionId);

    const result = await importBundle();
    expect(result.sessions.map(s => s.id)).toEqual([sessionId]);
    const session = await getSessionById(sessionId);
    expect(session!.characterId).toBe(charId);
  });

  test('a group session whose group is skipped is not imported', async () => {
    await saveBob();
    await saveGroupChatToDB({
      id: 'group-1',
      name: 'Bobs',
      description: '',
      icon: '',
      characterIds: ['char-2'],
    });
    await createSession({
      id: 'sess-group',
      characterId: '',
      groupChatId: 'group-1',
      lastReplyCharacterId: 'char-2',
      messages: [
        {
          id: 'g1',
          role: 'assistant',
          content: 'only bob',
          timestamp: 1000,
          characterId: 'char-2',
        },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await saveQuickCharacter({
      id: 'qc-group',
      session_id: 'sess-group',
      character_id: '',
      name: 'Group QC',
      description: '',
      personality: '',
      starred: 0,
    });
    await saveSessionMemory('sess-group');

    // Bob is left out of the export, so the group has no valid members.
    await exportBundle([charId], ['group-1']);
    clearAll();

    const result = await importBundle();
    expect(result.groups).toEqual([]);
    expect(result.sessions.map(s => s.id)).toEqual([sessionId]);
    expect(await getSessionById('sess-group')).toBeNull();
    expect(await getQuickCharactersForSession('sess-group')).toEqual([]);
    expect(result.quickCharacters.map(q => q.id).sort()).toEqual(
      [sessionQcId, starredQcId].sort(),
    );
    expect(result.memories).toBe(0);
  });

  test('a group session for a group that already exists still imports', async () => {
    await saveGroupChatToDB({
      id: 'group-1',
      name: 'Gang',
      description: '',
      icon: '',
      characterIds: [charId],
    });
    await createSession({
      id: 'sess-group',
      characterId: '',
      groupChatId: 'group-1',
      messages: [
        {
          id: 'g1',
          role: 'assistant',
          content: 'hi',
          timestamp: 1000,
          characterId: charId,
        },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    });

    await exportBundle([charId], ['group-1']);
    deleteSession('sess-group');

    const result = await importBundle();
    expect(result.groups).toEqual([]);
    expect(result.sessions.map(s => s.id)).toEqual(['sess-group']);
    const session = await getSessionById('sess-group');
    expect(session!.messages[0].characterId).toBe(charId);
  });

  test('starred quick characters of a missing character are not imported', async () => {
    deleteSession(sessionId);
    await exportBundle([charId]);
    await dropFromBundle([`characters/${charId}.json`]);
    clearAll();

    const result = await importBundle();
    expect(result.quickCharacters).toEqual([]);
    const rows = db().execute('SELECT id FROM quick_characters').results;
    expect(rows).toEqual([]);
  });
});

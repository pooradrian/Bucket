jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
  },
}));

// Real SQLite (node:sqlite) so foreign keys, cascades and transactions are
// actually enforced rather than simulated.
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

import { encrypt } from '../src/Crypto';
import {
  initDB,
  saveCharacterToDB,
  saveGroupChatToDB,
  getAllCharactersFromDB,
  getAllGroupChatsFromDB,
  createSession,
  getSessionById,
  deleteFolderFromDB,
  saveFolderToDB,
  setKV,
  getKV,
  preserveSpeakerNames,
} from '../src/Database';
import type { ChatMessage, ReplyVariant } from '../src/useChat';

const db = () => initDB();

function count(table: string, where = '1=1'): number {
  const result = db().execute(
    `SELECT COUNT(*) as count FROM ${table} WHERE ${where}`,
  );
  return result.results![0].count as number;
}

function character(id: string, overrides: Record<string, string> = {}) {
  return {
    id,
    name: id,
    description: `${id} desc`,
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
    ...overrides,
  };
}

beforeEach(() => {
  for (const table of [
    'quick_characters',
    'chat_messages',
    'chat_sessions',
    'group_chat_members',
    'group_chats',
    'characters',
    'folders',
    'kv_store',
  ]) {
    db().execute(`DELETE FROM ${table}`);
  }
});

describe('saveCharacterToDB', () => {
  test('harness enforces foreign keys (INSERT OR REPLACE really cascades)', () => {
    db().execute("INSERT INTO characters (id, name) VALUES ('x', 'x')");
    db().execute("INSERT INTO group_chats (id, name) VALUES ('gx', 'gx')");
    db().execute(
      "INSERT INTO group_chat_members (group_chat_id, character_id, position) VALUES ('gx', 'x', 0)",
    );
    db().execute(
      "INSERT OR REPLACE INTO characters (id, name) VALUES ('x', 'x2')",
    );
    expect(count('group_chat_members', "character_id = 'x'")).toBe(0);
  });

  test('re-saving an existing character keeps its group memberships', async () => {
    await saveCharacterToDB(character('alice'));
    await saveCharacterToDB(character('bob'));
    await saveGroupChatToDB({
      id: 'g1',
      name: 'Group',
      description: '',
      icon: '',
      characterIds: ['alice', 'bob'],
    });

    await saveCharacterToDB(
      character('alice', {
        name: 'Alice Edited',
        description: 'new desc',
        icon: 'icon.png',
        folder_id: 'f1',
        persona_id: 'p1',
        lorebook_id: 'lb1',
        custom_fields: '{"a":1}',
        initial_message: 'hi',
        writing_style: 'ws',
        personality: 'pers',
        scenario: 'scen',
        example_messages: 'ex',
      }),
    );

    const [group] = await getAllGroupChatsFromDB();
    expect(group.characterIds).toEqual(['alice', 'bob']);

    const alice = (await getAllCharactersFromDB()).find(c => c.id === 'alice')!;
    expect(alice).toEqual({
      id: 'alice',
      name: 'Alice Edited',
      description: 'new desc',
      initial_message: 'hi',
      writing_style: 'ws',
      personality: 'pers',
      scenario: 'scen',
      example_messages: 'ex',
      icon: 'icon.png',
      lorebook_id: 'lb1',
      custom_fields: '{"a":1}',
      persona_id: 'p1',
      folder_id: 'f1',
    });
    expect(count('characters')).toBe(2);
  });
});

describe('createSession', () => {
  const msg = (id: string, content: string): ChatMessage => ({
    id,
    role: 'user',
    content,
    timestamp: 1,
  });

  test('no transaction is open while messages are being encrypted', async () => {
    const pending = createSession({
      id: 's1',
      characterId: 'c1',
      messages: [msg('m1', 'one'), msg('m2', 'two')],
      createdAt: 1,
      updatedAt: 1,
    });
    // Runs while createSession is suspended on encryption; it opens its own
    // transaction, which would throw if createSession had already BEGUN.
    saveFolderToDB({ id: 'f1', name: 'F' });
    expect(() => deleteFolderFromDB('f1')).not.toThrow();
    await pending;

    const session = await getSessionById('s1');
    expect(session!.messages.map(m => m.content)).toEqual(['one', 'two']);
  });

  test('a failing createSession does not roll back unrelated writes', async () => {
    // The message id collides, so the failure happens after encryption.
    db().execute(
      "INSERT INTO chat_sessions (id, character_id, created_at, updated_at) VALUES ('other', 'c1', 1, 1)",
    );
    db().execute(
      "INSERT INTO chat_messages (id, session_id, role, content, timestamp, seq) VALUES ('taken', 'other', 'user', 'x', 1, 1)",
    );
    const pending = createSession({
      id: 'dup',
      characterId: 'c1',
      messages: [msg('d1', 'x'), msg('taken', 'y')],
      createdAt: 1,
      updatedAt: 1,
    });
    setKV('unrelated', 'kept');
    await expect(pending).rejects.toThrow();
    expect(getKV('unrelated')).toBe('kept');
    expect(count('chat_messages', "id = 'd1'")).toBe(0);
    expect(count('chat_sessions', "id = 'dup'")).toBe(0);
  });
});

describe('preserveSpeakerNames', () => {
  async function insertMessage(
    id: string,
    characterId: string,
    variants: ReplyVariant[],
  ) {
    const enc = await Promise.all(
      variants.map(async v => ({ ...v, content: await encrypt(v.content) })),
    );
    db().execute(
      'INSERT INTO chat_messages (id, session_id, role, content, timestamp, seq, variants, character_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        'ps',
        'assistant',
        await encrypt(id),
        1,
        1,
        enc.length ? JSON.stringify(enc) : '',
        characterId,
      ],
    );
  }

  const variantsOf = (id: string): ReplyVariant[] =>
    JSON.parse(
      db().execute('SELECT variants FROM chat_messages WHERE id = ?', [id])
        .results![0].variants as string,
    );
  const speakerOf = (id: string) =>
    db().execute('SELECT speaker_name FROM chat_messages WHERE id = ?', [id])
      .results![0].speaker_name;

  beforeEach(() => {
    db().execute(
      "INSERT INTO chat_sessions (id, character_id, created_at, updated_at) VALUES ('ps', 'c1', 1, 1)",
    );
  });

  test('only stamps variants written by the deleted speaker', async () => {
    await insertMessage('own', 'qc-dead', [
      { id: 'v1', content: 'inherits', timestamp: 1 },
      { id: 'v2', content: 'explicit', timestamp: 2, characterId: 'qc-dead' },
      { id: 'v3', content: 'other', timestamp: 3, characterId: 'qc-alive' },
    ]);

    await preserveSpeakerNames('qc-dead', 'Viktor');

    expect(speakerOf('own')).toBe('Viktor');
    const v = variantsOf('own');
    expect(v[0].speakerName).toBe('Viktor');
    expect(v[1].speakerName).toBe('Viktor');
    expect(v[2].speakerName).toBeUndefined();
  });

  test('stamps variants on messages now owned by someone else', async () => {
    await insertMessage('foreign', 'qc-alive', [
      { id: 'v1', content: 'inherits alive', timestamp: 1 },
      { id: 'v2', content: 'dead one', timestamp: 2, characterId: 'qc-dead' },
    ]);

    await preserveSpeakerNames('qc-dead', 'Viktor');

    expect(speakerOf('foreign')).toBe('');
    const v = variantsOf('foreign');
    expect(v[0].speakerName).toBeUndefined();
    expect(v[1].speakerName).toBe('Viktor');
  });

  test('leaves unrelated messages untouched', async () => {
    await insertMessage('none', 'qc-alive', [
      { id: 'v1', content: 'a', timestamp: 1, characterId: 'qc-alive' },
    ]);
    const before = db().execute(
      "SELECT variants FROM chat_messages WHERE id = 'none'",
    ).results![0].variants;

    await preserveSpeakerNames('qc-dead', 'Viktor');

    expect(speakerOf('none')).toBe('');
    expect(
      db().execute("SELECT variants FROM chat_messages WHERE id = 'none'")
        .results![0].variants,
    ).toBe(before);
  });
});

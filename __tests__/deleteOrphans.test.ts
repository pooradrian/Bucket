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

import {
  initDB,
  deleteCharacterFromDB,
  deleteGroupChatFromDB,
} from '../src/Database';

const db = () => initDB();

function clearAll() {
  for (const table of [
    'quick_characters',
    'chat_messages',
    'chat_sessions',
    'group_chat_members',
    'group_chats',
    'characters',
  ]) {
    db().execute(`DELETE FROM ${table}`);
  }
}

function insertCharacter(id: string) {
  db().execute('INSERT INTO characters (id, name) VALUES (?, ?)', [id, id]);
}

function insertGroup(id: string) {
  db().execute('INSERT INTO group_chats (id, name) VALUES (?, ?)', [id, id]);
}

function insertSession(
  id: string,
  characterId: string,
  groupChatId = '',
) {
  db().execute(
    'INSERT INTO chat_sessions (id, character_id, group_chat_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, characterId, groupChatId, 1, 1],
  );
}

function insertMessage(id: string, sessionId: string) {
  db().execute(
    'INSERT INTO chat_messages (id, session_id, role, content, timestamp, seq) VALUES (?, ?, ?, ?, ?, ?)',
    [id, sessionId, 'user', 'x', 1, 1],
  );
}

function insertQuickCharacter(
  id: string,
  sessionId: string,
  characterId: string,
  starred: number,
) {
  db().execute(
    'INSERT INTO quick_characters (id, session_id, character_id, name, starred) VALUES (?, ?, ?, ?, ?)',
    [id, sessionId, characterId, id, starred],
  );
}

function count(table: string, where = '1=1'): number {
  const result = db().execute(`SELECT COUNT(*) as count FROM ${table} WHERE ${where}`);
  return result.results![0].count as number;
}

beforeEach(() => {
  clearAll();
});

test('deleteCharacterFromDB removes solo sessions, messages and quick characters', () => {
  insertCharacter('alice');
  insertCharacter('bob');
  insertGroup('group-1');
  insertSession('solo-alice', 'alice');
  insertSession('solo-bob', 'bob');
  insertSession('group-session', '', 'group-1');
  db().execute(
    'INSERT INTO group_chat_members (group_chat_id, character_id, position) VALUES (?, ?, ?)',
    ['group-1', 'alice', 0],
  );
  db().execute(
    'INSERT INTO group_chat_members (group_chat_id, character_id, position) VALUES (?, ?, ?)',
    ['group-1', 'bob', 1],
  );
  insertMessage('msg-alice', 'solo-alice');
  insertMessage('msg-bob', 'solo-bob');
  insertMessage('msg-group', 'group-session');
  insertQuickCharacter('qc-alice-starred', 'solo-alice', 'alice', 1);
  insertQuickCharacter('qc-alice-session', 'solo-alice', '', 0);
  insertQuickCharacter('qc-bob', 'solo-bob', '', 0);
  insertQuickCharacter('qc-group', 'group-session', '', 0);

  deleteCharacterFromDB('alice');

  expect(count('characters', "id = 'alice'")).toBe(0);
  expect(count('characters', "id = 'bob'")).toBe(1);
  expect(count('chat_sessions', "id = 'solo-alice'")).toBe(0);
  expect(count('chat_sessions', "id = 'solo-bob'")).toBe(1);
  expect(count('chat_sessions', "id = 'group-session'")).toBe(1);
  expect(count('chat_messages', "id = 'msg-alice'")).toBe(0);
  expect(count('chat_messages', "id = 'msg-bob'")).toBe(1);
  expect(count('chat_messages', "id = 'msg-group'")).toBe(1);
  expect(count('quick_characters', "id LIKE 'qc-alice%'")).toBe(0);
  expect(count('quick_characters', "id = 'qc-bob'")).toBe(1);
  expect(count('quick_characters', "id = 'qc-group'")).toBe(1);
  expect(count('group_chat_members', "character_id = 'alice'")).toBe(0);
  expect(count('group_chat_members', "character_id = 'bob'")).toBe(1);
  expect(count('group_chats', "id = 'group-1'")).toBe(1);
});

test('deleteGroupChatFromDB removes its sessions, messages and quick characters', () => {
  insertCharacter('alice');
  insertGroup('group-1');
  insertSession('solo-alice', 'alice');
  insertSession('group-session-1', '', 'group-1');
  insertSession('group-session-2', '', 'group-1');
  insertMessage('msg-solo', 'solo-alice');
  insertMessage('msg-group-1', 'group-session-1');
  insertMessage('msg-group-2', 'group-session-2');
  insertQuickCharacter('qc-solo', 'solo-alice', '', 0);
  insertQuickCharacter('qc-group-1', 'group-session-1', '', 0);
  insertQuickCharacter('qc-group-2', 'group-session-2', '', 1);

  deleteGroupChatFromDB('group-1');

  expect(count('group_chats', "id = 'group-1'")).toBe(0);
  expect(count('chat_sessions', "id = 'solo-alice'")).toBe(1);
  expect(count('chat_sessions', "id LIKE 'group-session-%'")).toBe(0);
  expect(count('chat_messages', "id = 'msg-solo'")).toBe(1);
  expect(count('chat_messages', "id LIKE 'msg-group-%'")).toBe(0);
  expect(count('quick_characters', "id = 'qc-solo'")).toBe(1);
  expect(count('quick_characters', "id LIKE 'qc-group-%'")).toBe(0);
});

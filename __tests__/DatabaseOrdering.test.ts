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

import {encrypt} from '../src/Crypto';
import {
  initDB,
  getSessionById,
  getAllSessionsForCharacter,
  addMessage,
  updateMessageWithVariants,
} from '../src/Database';
import type {ChatMessage} from '../src/useChat';

type Exec = {
  execute: (sql: string, params?: (string | number | null)[]) => {results?: Record<string, unknown>[]};
};

const db: Exec = require('react-native-nitro-sqlite').open({name: 'test'});

const contents = (messages: ChatMessage[]) => messages.map(m => m.content);

const msg = (id: string, role: ChatMessage['role'], content: string, timestamp: number): ChatMessage =>
  ({id, role, content, timestamp});

beforeAll(async () => {
  db.execute(`
    CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      character_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      group_chat_id TEXT DEFAULT '',
      last_reply_character_id TEXT DEFAULT '',
      name TEXT DEFAULT ''
    )
  `);
  db.execute(`
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      variants TEXT DEFAULT '',
      request_info TEXT DEFAULT '',
      thinking_ms INTEGER DEFAULT 0
    )
  `);
  db.execute(`
    CREATE TABLE quick_characters (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT,
      character_id TEXT,
      name TEXT,
      description TEXT,
      personality TEXT,
      starred INTEGER DEFAULT 0
    )
  `);
  db.execute('CREATE INDEX idx_messages_session ON chat_messages(session_id)');
  db.execute('PRAGMA user_version = 11');

  db.execute('INSERT INTO chat_sessions (id, character_id, created_at, updated_at) VALUES (?, ?, ?, ?)', [
    's1',
    'char1',
    1,
    1,
  ]);

  const seeded: [string, ChatMessage['role'], string, number][] = [
    ['m1', 'user', 'u1', 1000],
    ['m2', 'assistant', 'a1', 500000],
    ['m3', 'user', 'u2', 2000],
    ['m4', 'assistant', 'a2', 900000],
  ];
  for (const [id, role, content, timestamp] of seeded) {
    db.execute(
      'INSERT INTO chat_messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
      [id, 's1', role, await encrypt(content), timestamp],
    );
  }
});

test('upgrade runs migrations through v14', () => {
  const result = db.execute('PRAGMA user_version');
  expect(result.results?.[0]?.user_version).toBe(11);
  initDB();
  expect(db.execute('PRAGMA user_version').results?.[0]?.user_version).toBe(14);
});

test('backfill restores insertion order for threads whose timestamps were rewritten', async () => {
  const session = await getSessionById('s1');
  expect(contents(session!.messages)).toEqual(['u1', 'a1', 'u2', 'a2']);
});

test('rewriting a timestamp no longer reorders the thread', async () => {
  await updateMessageWithVariants('m1', 'u1*', 9_999_999_999, []);
  const session = await getSessionById('s1');
  expect(contents(session!.messages)).toEqual(['u1*', 'a1', 'u2', 'a2']);
});

test('appends land last and front inserts land first regardless of timestamp', async () => {
  await addMessage('s1', msg('m5', 'user', 'u3', 7));
  await addMessage('s1', msg('sum1', 'assistant', '[Summary] s', 1), true);
  await addMessage('s1', msg('m6', 'user', 'u4', 8));

  const session = await getSessionById('s1');
  expect(contents(session!.messages)).toEqual(['[Summary] s', 'u1*', 'a1', 'u2', 'a2', 'u3', 'u4']);
});

test('thread preview follows sequence, not the highest timestamp', async () => {
  const [summary] = await getAllSessionsForCharacter('char1');
  expect(summary.preview).toBe('u4');
});

test('fresh installs track sequence without a migration', async () => {
  let fresh!: typeof import('../src/Database');
  jest.isolateModules(() => {
    fresh = require('../src/Database');
  });

  await fresh.createSession({
    id: 'fs1',
    characterId: 'char2',
    messages: [
      msg('f1', 'user', 'fu1', 100),
      msg('f2', 'assistant', 'fa1', 500),
      msg('f3', 'user', 'fu2', 200),
      msg('f4', 'assistant', 'fa2', 900),
    ],
    createdAt: 1,
    updatedAt: 1,
  });

  let loaded = await fresh.getSessionById('fs1');
  expect(contents(loaded!.messages)).toEqual(['fu1', 'fa1', 'fu2', 'fa2']);

  await fresh.addMessage('fs1', msg('f5', 'user', 'fu3', 1));
  await fresh.addMessage('fs1', msg('fsum', 'assistant', '[Summary] s', 2), true);

  loaded = await fresh.getSessionById('fs1');
  expect(contents(loaded!.messages)).toEqual(['[Summary] s', 'fu1', 'fa1', 'fu2', 'fa2', 'fu3']);
});

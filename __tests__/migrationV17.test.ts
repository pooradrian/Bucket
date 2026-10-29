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
  (globalThis as any).__bucketTestConn = conn;
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

import { initDB } from '../src/Database';

const conn = () => (globalThis as any).__bucketTestConn;

function count(sql: string): number {
  return conn().prepare(sql).all()[0].count as number;
}

test('v17 migration deletes sessions whose character or group chat is gone', () => {
  conn().exec(`
    CREATE TABLE characters (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
    CREATE TABLE group_chats (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
    CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      character_id TEXT NOT NULL,
      group_chat_id TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE quick_characters (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      character_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      starred INTEGER NOT NULL DEFAULT 0
    );
    PRAGMA user_version = 16;

    INSERT INTO characters (id, name) VALUES ('alive', 'alive');
    INSERT INTO group_chats (id, name) VALUES ('group-alive', 'group-alive');

    INSERT INTO chat_sessions (id, character_id, group_chat_id, created_at, updated_at)
      VALUES ('valid-solo', 'alive', '', 1, 1),
             ('orphan-solo', 'missing', '', 1, 1),
             ('valid-group', '', 'group-alive', 1, 1),
             ('orphan-group', '', 'group-missing', 1, 1),
             ('no-parent', '', '', 1, 1);

    INSERT INTO chat_messages (id, session_id, role, content, timestamp)
      VALUES ('msg-valid-solo', 'valid-solo', 'user', 'x', 1),
             ('msg-orphan-solo', 'orphan-solo', 'user', 'x', 1),
             ('msg-valid-group', 'valid-group', 'user', 'x', 1),
             ('msg-orphan-group', 'orphan-group', 'user', 'x', 1),
             ('msg-no-parent', 'no-parent', 'user', 'x', 1);

    INSERT INTO quick_characters (id, session_id, character_id, name, starred)
      VALUES ('qc-starred-alive', 'orphan-solo', 'alive', 'x', 1),
             ('qc-starred-missing', 'orphan-solo', 'missing', 'x', 1),
             ('qc-unstarred-orphan', 'orphan-solo', '', 'x', 0),
             ('qc-valid', 'valid-solo', '', 'x', 0),
             ('qc-orphan-group', 'orphan-group', '', 'x', 0);
  `);

  initDB();

  expect(conn().prepare('PRAGMA user_version').all()[0].user_version).toBe(18);
  expect(count("SELECT COUNT(*) as count FROM chat_sessions WHERE id = 'valid-solo'")).toBe(1);
  expect(count("SELECT COUNT(*) as count FROM chat_sessions WHERE id = 'orphan-solo'")).toBe(0);
  expect(count("SELECT COUNT(*) as count FROM chat_sessions WHERE id = 'valid-group'")).toBe(1);
  expect(count("SELECT COUNT(*) as count FROM chat_sessions WHERE id = 'orphan-group'")).toBe(0);
  expect(count("SELECT COUNT(*) as count FROM chat_sessions WHERE id = 'no-parent'")).toBe(0);
  expect(count("SELECT COUNT(*) as count FROM chat_messages WHERE id = 'msg-valid-solo'")).toBe(1);
  expect(count("SELECT COUNT(*) as count FROM chat_messages WHERE id = 'msg-orphan-solo'")).toBe(0);
  expect(count("SELECT COUNT(*) as count FROM chat_messages WHERE id = 'msg-valid-group'")).toBe(1);
  expect(count("SELECT COUNT(*) as count FROM chat_messages WHERE id = 'msg-orphan-group'")).toBe(0);
  expect(count("SELECT COUNT(*) as count FROM chat_messages WHERE id = 'msg-no-parent'")).toBe(0);
  expect(count("SELECT COUNT(*) as count FROM quick_characters WHERE id = 'qc-starred-alive'")).toBe(1);
  expect(count("SELECT COUNT(*) as count FROM quick_characters WHERE id = 'qc-starred-missing'")).toBe(0);
  expect(count("SELECT COUNT(*) as count FROM quick_characters WHERE id = 'qc-unstarred-orphan'")).toBe(0);
  expect(count("SELECT COUNT(*) as count FROM quick_characters WHERE id = 'qc-valid'")).toBe(1);
  expect(count("SELECT COUNT(*) as count FROM quick_characters WHERE id = 'qc-orphan-group'")).toBe(0);
});

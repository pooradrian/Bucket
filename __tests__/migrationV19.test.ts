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

test('v19 migration adds the attachments column to chat_messages', () => {
  conn().exec('CREATE TABLE chat_messages (id TEXT PRIMARY KEY, content TEXT)');
  conn().exec('PRAGMA user_version = 18');

  initDB();

  expect(conn().prepare('PRAGMA user_version').all()[0].user_version).toBe(19);
  const columns = conn()
    .prepare('PRAGMA table_info(chat_messages)')
    .all()
    .map((row: { name: string }) => row.name);
  expect(columns).toContain('attachments');
});

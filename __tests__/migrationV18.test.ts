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

test('v18 migration creates the memories table and its scope index', () => {
  conn().exec('PRAGMA user_version = 17');

  initDB();

  expect(conn().prepare('PRAGMA user_version').all()[0].user_version).toBe(18);
  const columns = conn()
    .prepare('PRAGMA table_info(memories)')
    .all()
    .map((row: { name: string }) => row.name);
  expect(columns).toEqual([
    'id',
    'scope_id',
    'text',
    'vector',
    'vector_key',
    'source_session_id',
    'created_at',
    'updated_at',
    'last_used_at',
    'pinned',
  ]);
  const indexes = conn()
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_memories_scope'",
    )
    .all();
  expect(indexes).toHaveLength(1);
});

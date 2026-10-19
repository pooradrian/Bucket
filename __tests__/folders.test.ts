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
  saveCharacterToDB,
  getAllCharactersFromDB,
  getAllFoldersFromDB,
  saveFolderToDB,
  deleteFolderFromDB,
  setCharacterFolder,
} from '../src/Database';

function char(id: string, folderId = '') {
  return {
    id,
    name: `Char ${id}`,
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
    folder_id: folderId,
  };
}

beforeAll(() => {
  initDB();
});

beforeEach(() => {
  initDB().execute('DELETE FROM characters');
  initDB().execute('DELETE FROM folders');
});

test('folders are created, renamed, and listed by name', () => {
  saveFolderToDB({ id: 'f2', name: 'Noir' });
  saveFolderToDB({ id: 'f1', name: 'Fantasy' });
  expect(getAllFoldersFromDB().map(f => f.name)).toEqual(['Fantasy', 'Noir']);

  saveFolderToDB({ id: 'f2', name: 'Crime' });
  expect(getAllFoldersFromDB().map(f => f.name)).toEqual(['Crime', 'Fantasy']);
});

test('assignments survive a character save', async () => {
  saveFolderToDB({ id: 'f1', name: 'Fantasy' });
  await saveCharacterToDB(char('c1', 'f1'));
  await saveCharacterToDB({ ...char('c1', 'f1'), name: 'Renamed' });

  const [loaded] = await getAllCharactersFromDB();
  expect(loaded.name).toBe('Renamed');
  expect(loaded.folder_id).toBe('f1');
});

test('moving a character between folders updates the row', async () => {
  saveFolderToDB({ id: 'f1', name: 'Fantasy' });
  saveFolderToDB({ id: 'f2', name: 'Noir' });
  await saveCharacterToDB(char('c1', 'f1'));

  setCharacterFolder('c1', 'f2');
  expect((await getAllCharactersFromDB())[0].folder_id).toBe('f2');

  setCharacterFolder('c1', '');
  expect((await getAllCharactersFromDB())[0].folder_id).toBe('');
});

test('deleting a folder unfiles its characters and keeps them', async () => {
  saveFolderToDB({ id: 'f1', name: 'Fantasy' });
  await saveCharacterToDB(char('c1', 'f1'));
  await saveCharacterToDB(char('c2', ''));

  deleteFolderFromDB('f1');

  expect(getAllFoldersFromDB()).toEqual([]);
  const chars = await getAllCharactersFromDB();
  expect(chars).toHaveLength(2);
  expect(chars.every(c => c.folder_id === '')).toBe(true);
});

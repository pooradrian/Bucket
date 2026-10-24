jest.mock('../src/Database', () => ({
  getKV: jest.fn(),
  setKV: jest.fn(),
  getAllCharactersFromDB: jest.fn(),
  saveCharacterToDB: jest.fn(),
  deleteCharacterFromDB: jest.fn(),
  getAllGroupChatsFromDB: jest.fn(),
  saveGroupChatToDB: jest.fn(),
  deleteGroupChatFromDB: jest.fn(),
  getAllFoldersFromDB: jest.fn(),
  saveFolderToDB: jest.fn(),
  deleteFolderFromDB: jest.fn(),
  setCharacterFolder: jest.fn(),
}));

jest.mock('../src/RAGHandler', () => ({
  loadAllLorebooks: jest.fn(),
}));

jest.mock('../src/EventLogger', () => ({
  setLoggingEnabled: jest.fn(),
  logEvent: jest.fn(),
}));

import {
  getAllCharactersFromDB,
  getAllFoldersFromDB,
  getAllGroupChatsFromDB,
  getKV,
} from '../src/Database';
import { loadAllLorebooks } from '../src/RAGHandler';
import { useAppStore } from '../src/store';

const mockCharacters = getAllCharactersFromDB as jest.Mock;
const mockGroups = getAllGroupChatsFromDB as jest.Mock;
const mockFolders = getAllFoldersFromDB as jest.Mock;
const mockLorebooks = loadAllLorebooks as jest.Mock;
const mockGetKV = getKV as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

it('reports failed startup loads instead of swallowing them', async () => {
  mockGetKV.mockImplementation(() => {
    throw new Error('kv read failed');
  });
  mockCharacters.mockRejectedValue(new Error('characters failed'));
  mockGroups.mockRejectedValue(new Error('groups failed'));
  mockFolders.mockImplementation(() => {
    throw new Error('folders failed');
  });
  mockLorebooks.mockRejectedValue(new Error('lorebooks failed'));

  const store = useAppStore.getState();

  await expect(store.loadSettings()).resolves.toBe(false);
  await expect(store.loadCharacters()).resolves.toBe(false);
  await expect(store.loadGroupChats()).resolves.toBe(false);
  await expect(store.loadFolders()).resolves.toBe(false);
  await expect(store.loadLorebooks()).resolves.toBe(false);
});

it('reports successful startup loads', async () => {
  mockGetKV.mockReturnValue(null);
  mockCharacters.mockResolvedValue([]);
  mockGroups.mockResolvedValue([]);
  mockFolders.mockReturnValue([]);
  mockLorebooks.mockResolvedValue([]);

  const store = useAppStore.getState();

  await expect(store.loadSettings()).resolves.toBe(true);
  await expect(store.loadCharacters()).resolves.toBe(true);
  await expect(store.loadGroupChats()).resolves.toBe(true);
  await expect(store.loadFolders()).resolves.toBe(true);
  await expect(store.loadLorebooks()).resolves.toBe(true);
});

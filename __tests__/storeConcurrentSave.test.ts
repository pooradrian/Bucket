jest.mock('react-native-nitro-sqlite', () => ({ open: jest.fn() }));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: {},
  saveDocuments: jest.fn(),
  isKnownType: jest.fn(),
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
  ACCESSIBLE: {},
}));
// Each DB write resolves on a later tick, so saves overlap.
const tick = () => new Promise<void>(r => setTimeout(() => r(), 5));
jest.mock('../src/Database', () => ({
  ...jest.requireActual('../src/Database'),
  saveCharacterToDB: jest.fn(() => tick()),
  saveGroupChatToDB: jest.fn(() => tick()),
}));

import { upsertById, useAppStore } from '../src/store';
import type { Character } from '../src/CharacterEditor';

const char = (id: string, name = id): Character => ({
  id,
  name,
  description: '',
  initialMessage: '',
  personality: '',
  scenario: '',
  lorebookIds: [],
});

beforeEach(() => useAppStore.setState({ characters: [], groupChats: [] }));

it('keeps every character when saves overlap', async () => {
  const { saveCharacter } = useAppStore.getState();
  await Promise.all([saveCharacter(char('a')), saveCharacter(char('b'))]);
  expect(
    useAppStore
      .getState()
      .characters.map(c => c.id)
      .sort(),
  ).toEqual(['a', 'b']);
});

it('keeps every group when saves overlap', async () => {
  const { saveGroupChat } = useAppStore.getState();
  const g = (id: string) => ({
    id,
    name: id,
    description: '',
    characterIds: [],
  });
  await Promise.all([saveGroupChat(g('x')), saveGroupChat(g('y'))]);
  expect(
    useAppStore
      .getState()
      .groupChats.map(x => x.id)
      .sort(),
  ).toEqual(['x', 'y']);
});

it('upsertById replaces in place or appends', () => {
  const list = [char('a'), char('b')];
  expect(upsertById(list, char('a', 'A2')).map(c => c.name)).toEqual([
    'A2',
    'b',
  ]);
  expect(upsertById(list, char('c')).map(c => c.id)).toEqual(['a', 'b', 'c']);
});

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
jest.mock('../src/Database', () => ({
  ...jest.requireActual('../src/Database'),
  setKV: jest.fn(),
  saveGroupChatToDB: jest.fn(async () => {}),
  deleteGroupChatFromDB: jest.fn(),
  saveFolderToDB: jest.fn(),
  deleteFolderFromDB: jest.fn(),
}));

import { runHeadless } from '../src/UsbDebugBridge';
import { useAppStore } from '../src/store';
import type { Character } from '../src/CharacterEditor';

const char = (id: string, name: string, folderId?: string): Character => ({
  id,
  name,
  description: '',
  initialMessage: '',
  personality: '',
  scenario: '',
  lorebookIds: [],
  folderId,
});

beforeEach(() => {
  useAppStore.setState({
    characters: [char('a', 'Mira'), char('b', 'Tester')],
    groupChats: [],
    folders: [],
  });
});

describe('group commands', () => {
  it('creates a group from member names or ids, deduplicated', async () => {
    const r = await runHeadless(
      'group.new "Night Shift" --members mira,b,Mira --desc "Two of them"',
    );
    expect(r.ok).toBe(true);
    expect(useAppStore.getState().groupChats).toEqual([
      expect.objectContaining({
        name: 'Night Shift',
        description: 'Two of them',
        characterIds: ['a', 'b'],
      }),
    ]);
    expect((await runHeadless('groups')).text).toMatch(
      /Night Shift: Mira, Tester/,
    );
  });

  it('needs members that exist', async () => {
    expect((await runHeadless('group.new X')).ok).toBe(false);
    expect((await runHeadless('group.new X --members Nobody')).ok).toBe(false);
    expect(useAppStore.getState().groupChats).toHaveLength(0);
  });

  it('deletes by exact name only', async () => {
    await runHeadless('group.new Crew --members a');
    expect((await runHeadless('group.delete Cre')).ok).toBe(false);
    expect((await runHeadless('group.delete crew')).ok).toBe(true);
    expect(useAppStore.getState().groupChats).toHaveLength(0);
  });
});

describe('folder commands', () => {
  it('creates, lists and deletes folders; characters move out', async () => {
    await runHeadless('folder.new Noir');
    const [folder] = useAppStore.getState().folders;
    expect(folder.name).toBe('Noir');
    useAppStore.setState({ characters: [char('a', 'Mira', folder.id)] });
    expect((await runHeadless('folders')).text).toMatch(
      /Noir \(1 characters\)/,
    );
    expect((await runHeadless('folder.delete Noir')).ok).toBe(true);
    expect(useAppStore.getState().folders).toHaveLength(0);
    expect(useAppStore.getState().characters[0].folderId).toBeUndefined();
  });
});

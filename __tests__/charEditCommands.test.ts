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
  saveCharacterToDB: jest.fn(async () => {}),
  deleteCharacterFromDB: jest.fn(),
}));

import { runHeadless } from '../src/UsbDebugBridge';
import { useAppStore } from '../src/store';
import {
  resolveCharacterExact,
  setCharacterField,
} from '../src/debugger/charEditCommands';
import type { Character } from '../src/CharacterEditor';
import { deleteCharacterFromDB } from '../src/Database';

const blank = (over: Partial<Character> = {}): Character => ({
  id: 'c1',
  name: 'Mira',
  description: '',
  initialMessage: '',
  personality: '',
  scenario: '',
  lorebookIds: [],
  ...over,
});

const lookups = {
  folders: [{ id: 'f1', name: 'Noir' }],
  lorebooks: [{ id: 'lb1' } as never],
};

beforeEach(() => {
  useAppStore.setState({ characters: [], folders: lookups.folders });
  jest.clearAllMocks();
});

describe('char.new', () => {
  it('creates a character with every field filled', async () => {
    const r = await runHeadless(
      'char.new Mira Vance --desc "A detective" --personality Dry --scenario Office --first "Sit down." --examples "a\\nb" --writing Noir --folder noir',
    );
    expect(r.ok).toBe(true);
    const [c] = useAppStore.getState().characters;
    expect(r.text).toBe(`Created [${c.id}] Mira Vance`);
    expect(c).toMatchObject({
      name: 'Mira Vance',
      description: 'A detective',
      personality: 'Dry',
      scenario: 'Office',
      initialMessage: 'Sit down.',
      folderId: 'f1',
      customFields: [{ id: 'writingStyle', value: 'Noir' }],
    });
  });

  it('rejects unknown fields without saving', async () => {
    const r = await runHeadless('char.new Mira --mood happy');
    expect(r.ok).toBe(false);
    expect(useAppStore.getState().characters).toHaveLength(0);
  });
});

describe('setCharacterField', () => {
  it('clears optional fields', () => {
    const c = blank({
      folderId: 'f1',
      exampleMessages: 'x',
      customFields: [{ id: 'writingStyle', value: 'Noir' }],
    });
    let r = setCharacterField(c, 'folder', 'none', lookups);
    expect('char' in r && r.char.folderId).toBeUndefined();
    r = setCharacterField(c, 'examples', '', lookups);
    expect('char' in r && 'exampleMessages' in r.char).toBe(false);
    r = setCharacterField(c, 'writing', '', lookups);
    expect('char' in r && r.char.customFields).toEqual([]);
  });

  it('validates names, folders and lorebooks', () => {
    expect(setCharacterField(blank(), 'name', ' ', lookups)).toHaveProperty(
      'error',
    );
    expect(
      setCharacterField(blank(), 'folder', 'Nope', lookups),
    ).toHaveProperty('error');
    expect(setCharacterField(blank(), 'lorebooks', 'lb1,lb2', lookups)).toEqual(
      { error: 'Unknown lorebook id(s): lb2' },
    );
  });
});

describe('char.delete', () => {
  it('only deletes on an exact id or unique exact name', async () => {
    useAppStore.setState({
      characters: [
        blank({ id: 'a', name: 'Probe' }),
        blank({ id: 'b', name: 'Probe' }),
      ],
    });
    expect((await runHeadless('char.delete Prob')).ok).toBe(false);
    expect((await runHeadless('char.delete probe')).text).toMatch(
      /2 characters are named/,
    );
    expect(deleteCharacterFromDB).not.toHaveBeenCalled();
    expect((await runHeadless('char.delete b')).ok).toBe(true);
    expect(useAppStore.getState().characters.map(c => c.id)).toEqual(['a']);
  });

  it('resolveCharacterExact prefers ids', () => {
    const cs = [blank({ id: 'Mira', name: 'X' }), blank({ id: 'z' })];
    expect(resolveCharacterExact(cs, 'Mira')).toEqual({ char: cs[0] });
  });
});

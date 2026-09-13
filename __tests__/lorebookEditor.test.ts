jest.mock('react-native-nitro-sqlite', () => ({open: jest.fn()}));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: {},
}));
jest.mock('../src/Endpoint', () => ({
  getEmbeddings: jest.fn(async () => []),
}));

import {buildLorebookState, lorebookDisplayName, lorebookExportName, parseLorebook, splitBulkLines} from '../src/RAGHandler';

describe('splitBulkLines', () => {
  it('splits on newlines, trims, and drops blanks', () => {
    expect(splitBulkLines('  Elf capital is Sylvara\n\nDragons fear bells  \n ')).toEqual([
      'Elf capital is Sylvara',
      'Dragons fear bells',
    ]);
  });

  it('returns empty for blank input', () => {
    expect(splitBulkLines('\n   \n')).toEqual([]);
  });
});

describe('parseLorebook', () => {
  it('assigns sequential ids', () => {
    expect(parseLorebook('a\nb')).toEqual([
      {id: 0, text: 'a'},
      {id: 1, text: 'b'},
    ]);
  });
});

describe('lorebookExportName', () => {
  it('adds .txt when missing', () => {
    expect(lorebookExportName('World facts')).toBe('World facts.txt');
  });

  it('keeps existing .txt as-is', () => {
    expect(lorebookExportName('lorebook.txt')).toBe('lorebook.txt');
    expect(lorebookExportName('LORE.TXT')).toBe('LORE.TXT');
  });
});
describe('lorebookDisplayName', () => {
  it('strips .txt', () => {
    expect(lorebookDisplayName('lorebook.txt')).toBe('lorebook');
    expect(lorebookDisplayName('LORE.TXT')).toBe('LORE');
  });

  it('leaves names without .txt alone', () => {
    expect(lorebookDisplayName('World facts')).toBe('World facts');
    expect(lorebookDisplayName('.txt')).toBe('.txt');
  });
});

describe('buildLorebookState', () => {
  it('builds entries with sequential ids and count', () => {
    const state = buildLorebookState('id-1', 'World', ['a', 'b']);
    expect(state).toEqual({
      id: 'id-1',
      fileName: 'World',
      entries: [
        {id: 0, text: 'a'},
        {id: 1, text: 'b'},
      ],
      entryCount: 2,
    });
  });
});

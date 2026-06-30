import {parseArgs, findCharacter} from '../src/debuggerUtils';
import {Character} from '../src/CharacterEditor';

const char = (id: string, name: string): Character => ({
  id,
  name,
  description: '',
  personality: '',
  scenario: '',
  initialMessage: '',
  writingStyle: '',
  lorebookIds: [],
});

const characters = [char('abc', 'Alice'), char('def', 'Bob')];

describe('parseArgs', () => {
  it('splits on spaces', () => {
    expect(parseArgs('set bgPrimary #fff')).toEqual(['set', 'bgPrimary', '#fff']);
  });

  it('preserves quoted segments', () => {
    expect(parseArgs('say "hello world" foo')).toEqual(['say', 'hello world', 'foo']);
  });

  it('handles single quotes', () => {
    expect(parseArgs("set name 'Bob the Builder'")).toEqual(['set', 'name', 'Bob the Builder']);
  });

  it('returns empty array for empty string', () => {
    expect(parseArgs('')).toEqual([]);
  });

  it('collapses repeated spaces', () => {
    expect(parseArgs('a   b')).toEqual(['a', 'b']);
  });
});

describe('findCharacter', () => {
  it('matches by exact id', () => {
    expect(findCharacter(characters, 'abc')).toBe(characters[0]);
  });

  it('matches by exact name (case-insensitive)', () => {
    expect(findCharacter(characters, 'alice')).toBe(characters[0]);
  });

  it('matches by name prefix', () => {
    expect(findCharacter(characters, 'Al')).toBe(characters[0]);
  });

  it('returns undefined when nothing matches', () => {
    expect(findCharacter(characters, 'zzz')).toBeUndefined();
  });
});

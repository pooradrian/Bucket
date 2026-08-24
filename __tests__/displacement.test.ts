import {applyDisplacements, parseDisplacements} from '../src/displacement';

describe('parseDisplacements', () => {
  it('parses all rule forms from the example format', () => {
    const rules = parseDisplacements(
      [
        'word1 //alone, this gets nuked',
        'word2 => //replaced by a space',
        'word3 => word4',
        'word5 => word6 ~ word7',
        'word8 <=> word9',
      ].join('\n'),
    );
    expect(rules).toEqual([
      {kind: 'remove', word: 'word1'},
      {kind: 'replace', word: 'word2', replacements: [' ']},
      {kind: 'replace', word: 'word3', replacements: ['word4']},
      {kind: 'replace', word: 'word5', replacements: ['word6', 'word7']},
      {kind: 'swap', a: 'word8', b: 'word9'},
    ]);
  });

  it('skips blank lines, comment-only lines, and invalid lines', () => {
    expect(parseDisplacements('\n  \n// just a comment\n=> word4')).toEqual([]);
  });
});

describe('applyDisplacements', () => {
  it('deletes bare words', () => {
    const rules = parseDisplacements('very');
    expect(applyDisplacements('this is very bad', rules)).toBe('this is  bad');
  });

  it('replaces with a space for empty arrows', () => {
    const rules = parseDisplacements('bad =>');
    expect(applyDisplacements('this is bad stuff', rules)).toBe(
      'this is   stuff',
    );
  });

  it('replaces words', () => {
    const rules = parseDisplacements('cat => dog');
    expect(applyDisplacements('the cat sat', rules)).toBe('the dog sat');
  });

  it('picks among alternatives across seeds', () => {
    const rules = parseDisplacements('cat => dog ~ fish');
    const picks = new Set(
      Array.from({length: 20}, (_, i) => applyDisplacements('a cat', rules, i)),
    );
    expect([...picks].every(p => p === 'a dog' || p === 'a fish')).toBe(true);
  });

  it('is deterministic for a fixed seed', () => {
    const rules = parseDisplacements('cat => dog ~ fish');
    const once = applyDisplacements('a cat and a cat', rules, 42);
    expect(applyDisplacements('a cat and a cat', rules, 42)).toBe(once);
  });

  it('swaps both ways', () => {
    const rules = parseDisplacements('cat <=> dog');
    expect(applyDisplacements('cat dog', rules)).toBe('dog cat');
  });

  it('matches whole words only and case-insensitively', () => {
    const rules = parseDisplacements('cat => dog');
    expect(applyDisplacements('Cat category cats cat.', rules)).toBe(
      'dog category cats dog.',
    );
  });

  it('escapes regex metacharacters', () => {
    const rules = parseDisplacements('c.c => x');
    expect(applyDisplacements('abc abc c.c', rules)).toBe('abc abc x');
  });

  it('applies rules in order', () => {
    const rules = parseDisplacements('cat => dog\ndog => bird');
    expect(applyDisplacements('cat', rules)).toBe('bird');
  });

  it('returns text unchanged with no rules', () => {
    expect(applyDisplacements('hello world', [])).toBe('hello world');
  });
});

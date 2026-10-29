import { formatRagDuration, parseRagInfo } from '../src/ragInfo';

describe('parseRagInfo', () => {
  test('reads timing and results out of a stored request', () => {
    const requestInfo = JSON.stringify({
      url: 'http://example.test',
      body: { messages: [] },
      rag: { ms: 412.7, results: ['Elves live in Sylvara.', '  ', 7] },
    });
    expect(parseRagInfo(requestInfo)).toEqual({
      ms: 413,
      results: ['Elves live in Sylvara.'],
    });
  });

  test('returns null when there is no retrieval info', () => {
    expect(parseRagInfo(undefined)).toBeNull();
    expect(parseRagInfo('')).toBeNull();
    expect(parseRagInfo('not json')).toBeNull();
    expect(parseRagInfo(JSON.stringify({ url: 'x' }))).toBeNull();
    expect(
      parseRagInfo(JSON.stringify({ rag: { ms: 'fast', results: [] } })),
    ).toBeNull();
  });
});

describe('formatRagDuration', () => {
  test('uses milliseconds under a second and seconds above', () => {
    expect(formatRagDuration(87)).toBe('87 ms');
    expect(formatRagDuration(999)).toBe('999 ms');
    expect(formatRagDuration(1000)).toBe('1.0 s');
    expect(formatRagDuration(2345)).toBe('2.3 s');
  });
});

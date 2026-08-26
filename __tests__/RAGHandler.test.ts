jest.mock('react-native-nitro-sqlite', () => ({open: jest.fn()}));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: {},
  saveDocuments: jest.fn(),
  isKnownType: jest.fn(),
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: {},
}));

jest.mock('../src/Endpoint', () => ({
  getEmbeddings: jest.fn(async (inputs: string[]) =>
    inputs.map(text => {
      const vec = VECTORS[text];
      if (!vec) throw new Error(`no vector stubbed for "${text}"`);
      return vec;
    }),
  ),
}));

import {cosineSimilarity, rankLorebookEntries, retrieveRelevantLorebook} from '../src/RAGHandler';
import {getEmbeddings} from '../src/Endpoint';
import {DEFAULT_PROMPT_CONFIG} from '../src/PromptHandler';
import type {RAGConfig, LorebookState} from '../src/RAGHandler';
import type {ChatMessageObject} from '../src/PromptHandler';

const VECTORS: Record<string, number[]> = {
  query: [1, 0],
  exact: [1, 0],
  partial: [0.6, 0.8],
  unrelated: [0, 1],
  'cache-q': [1, 0],
  'cache-a': [1, 0],
  'cache-b': [0.6, 0.8],
  'm3\nm4\nquery': [1, 0],
};

const ragConfig = (overrides: Partial<RAGConfig> = {}): RAGConfig => ({
  enabled: true,
  model: 'embed-model',
  maxEntriesToSend: '50',
  maxResults: '5',
  ...overrides,
});

const lorebook = (...texts: string[]): LorebookState => ({
  id: 'lb',
  fileName: 'lb.txt',
  entries: texts.map((text, i) => ({id: i, text})),
  entryCount: texts.length,
});

beforeEach(() => {
  (getEmbeddings as jest.Mock).mockClear();
});

describe('cosineSimilarity', () => {
  test('identical vectors score 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  test('orthogonal vectors score 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  test('opposite vectors score -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  test('zero vector scores 0 instead of NaN', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});

describe('rankLorebookEntries', () => {
  test('ranks entries by descending similarity to the query', async () => {
    const ranked = await rankLorebookEntries(
      'query',
      lorebook('unrelated', 'exact', 'partial').entries,
      ragConfig(),
      DEFAULT_PROMPT_CONFIG,
    );
    expect(ranked.map(r => r.entry.text)).toEqual(['exact', 'partial', 'unrelated']);
    expect(ranked[0].score).toBeCloseTo(1);
    expect(ranked[1].score).toBeCloseTo(0.6);
    expect(ranked[2].score).toBeCloseTo(0);
  });

  test('caps ranked entries at maxEntriesToSend', async () => {
    const ranked = await rankLorebookEntries(
      'query',
      lorebook('exact', 'partial', 'unrelated').entries,
      ragConfig({maxEntriesToSend: '2'}),
      DEFAULT_PROMPT_CONFIG,
    );
    expect(ranked).toHaveLength(2);
    expect(ranked.map(r => r.entry.text)).toEqual(['exact', 'partial']);
  });

  test('returns nothing for an empty query', async () => {
    const ranked = await rankLorebookEntries(
      '   ',
      lorebook('exact').entries,
      ragConfig(),
      DEFAULT_PROMPT_CONFIG,
    );
    expect(ranked).toEqual([]);
    expect(getEmbeddings).not.toHaveBeenCalled();
  });

  test('caches embeddings per model+text across calls', async () => {
    const entries = lorebook('cache-a', 'cache-b').entries;
    await rankLorebookEntries('cache-q', entries, ragConfig(), DEFAULT_PROMPT_CONFIG);
    expect(getEmbeddings).toHaveBeenCalledTimes(1);

    (getEmbeddings as jest.Mock).mockClear();
    await rankLorebookEntries('query', entries, ragConfig(), DEFAULT_PROMPT_CONFIG);
    expect(getEmbeddings).not.toHaveBeenCalled();

    (getEmbeddings as jest.Mock).mockClear();
    await rankLorebookEntries('query', entries, ragConfig({model: 'other-model'}), DEFAULT_PROMPT_CONFIG);
    expect(getEmbeddings).toHaveBeenCalledTimes(1);
    expect((getEmbeddings as jest.Mock).mock.calls[0][1]).toBe('other-model');
  });
});

describe('retrieveRelevantLorebook', () => {
  const msgs = (contents: string[]): ChatMessageObject[] =>
    contents.map(content => ({role: 'user' as const, content}));

  test('builds the query from the last three messages', async () => {
    await retrieveRelevantLorebook(
      msgs(['m1', 'm2', 'm3', 'm4', 'query']),
      lorebook('exact'),
      ragConfig(),
      DEFAULT_PROMPT_CONFIG,
    );
    expect((getEmbeddings as jest.Mock).mock.calls[0][0][0]).toBe('m3\nm4\nquery');
  });

  test('drops entries below the similarity threshold and caps results', async () => {
    const relevant = await retrieveRelevantLorebook(
      msgs(['query']),
      lorebook('exact', 'partial', 'unrelated'),
      ragConfig({maxResults: '1'}),
      DEFAULT_PROMPT_CONFIG,
    );
    expect(relevant).toEqual(['exact']);
  });
});

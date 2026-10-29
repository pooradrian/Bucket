jest.mock('react-native-nitro-sqlite', () => {
  const { DatabaseSync } = require('node:sqlite');
  const conn = new DatabaseSync(':memory:');
  (globalThis as any).__bucketTestConn = conn;
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
  getAIResponse: jest.fn(),
  getEmbeddings: jest.fn(),
}));

import {
  buildMemoryContext,
  buildMemoryInjection,
  buildMemoryPassMessages,
  DEFAULT_MEMORY_SETTINGS,
  estimateMemoryBackfill,
  formatMemoryMessages,
  getMemoryConfig,
  loadMemorySettings,
  memoryRagConfig,
  memoryScopeId,
  parseMemoryOutput,
  rankMemories,
  reembedMemories,
  runMemoryBackfill,
  runMemoryPass,
  saveAndIndexMemory,
  saveMemorySettings,
} from '../src/Memory';
import { embeddingKey } from '../src/RAGHandler';
import { getAIResponse, getEmbeddings } from '../src/Endpoint';
import {
  deleteCharacterFromDB,
  deleteSession,
  getKV,
  getAllMemoryListingsFromDB,
  getMemoriesForScopeFromDB,
  getMemoryCountFromDB,
  initDB,
  pruneMemoriesInDB,
  saveMemoryToDB,
  setKV,
} from '../src/Database';
import {
  DEFAULT_PROMPT_CONFIG,
  buildPrompt,
} from '../src/PromptHandler';
import type { PromptConfig } from '../src/PromptHandler';
import type { MemorySettings, StoredMemory } from '../src/Memory';
import type { ChatMessage } from '../src/useChat';
import type { Character } from '../src/CharacterEditor';

const conn = () => (globalThis as any).__bucketTestConn;
const mockGetAIResponse = getAIResponse as jest.Mock;
const mockGetEmbeddings = getEmbeddings as jest.Mock;

function vectorFor(text: string): number[] {
  const value = text.toLowerCase();
  if (value.includes('blade')) return [0.999, 0.045];
  if (value.includes('knight') || value.includes('sword')) return [1, 0];
  if (value.includes('beta')) return [0.6, 0.8];
  if (value.includes('gamma')) return [0, 1];
  return [0.8, 0.6];
}

function config(overrides: Partial<PromptConfig> = {}): PromptConfig {
  return {
    ...DEFAULT_PROMPT_CONFIG,
    ragModel: 'memory-embed-model',
    ...overrides,
  };
}

function memorySettings(
  overrides: Partial<MemorySettings> = {},
): MemorySettings {
  return { ...DEFAULT_MEMORY_SETTINGS, enabled: true, ...overrides };
}

function message(
  id: string,
  role: 'user' | 'assistant',
  content: string,
): ChatMessage {
  return { id, role, content, timestamp: Number(id.replace(/\D/g, '')) || 1 };
}

function memory(overrides: Partial<StoredMemory> = {}): StoredMemory {
  return {
    id: 'memory-1',
    scopeId: 'character:c1',
    text: 'The knight is named Aldric.',
    vector: [1, 0],
    vectorKey: '',
    sourceSessionId: 's1',
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: 0,
    pinned: false,
    ...overrides,
  };
}

beforeEach(() => {
  initDB();
  conn().exec(`
    DELETE FROM memories;
    DELETE FROM kv_store;
    DELETE FROM chat_messages;
    DELETE FROM chat_sessions;
    DELETE FROM characters;
  `);
  mockGetEmbeddings.mockClear();
  mockGetAIResponse.mockClear();
  mockGetEmbeddings.mockImplementation(async (inputs: string[]) =>
    inputs.map(vectorFor),
  );
  mockGetAIResponse.mockResolvedValue({ content: '' });
});

describe('parseMemoryOutput', () => {
  test('parses queries and facts with bullets, numbering and inline values', () => {
    const output = parseMemoryOutput(
      [
        'QUERIES: Sir Aldric',
        '- the sword',
        '1. the keep',
        'FACTS:',
        '- Sir Aldric carries the sword.',
        '- sir aldric carries the SWORD.',
        '2. The keep is north.',
        'NONE',
      ].join('\n'),
      5,
      4,
    );
    expect(output).toEqual({
      queries: ['Sir Aldric', 'the sword', 'the keep'],
      facts: [
        'Sir Aldric carries the sword.',
        'The keep is north.',
      ],
    });
  });

  test('caps, dedupes and truncates values', () => {
    const longQuery = 'q'.repeat(200);
    const longFact = 'f'.repeat(400);
    const output = parseMemoryOutput(
      [
        'QUERIES:',
        `- ${longQuery}`,
        '- second',
        '- third',
        'FACTS:',
        `- ${longFact}`,
        '- kept',
      ].join('\n'),
      2,
      1,
    );
    expect(output.queries).toHaveLength(2);
    expect(output.queries[0].length).toBe(120);
    expect(output.queries[0].endsWith('…')).toBe(true);
    expect(output.facts).toHaveLength(1);
    expect(output.facts[0].length).toBe(300);
  });

  test('returns nothing for an empty or unlabelled response', () => {
    expect(parseMemoryOutput('', 5, 4)).toEqual({ queries: [], facts: [] });
    expect(parseMemoryOutput('- stray line', 5, 4)).toEqual({
      queries: [],
      facts: [],
    });
    expect(parseMemoryOutput('QUERIES:\n- none', 0, 0)).toEqual({
      queries: [],
      facts: [],
    });
  });
});

describe('getMemoryConfig', () => {
  test('clamps numeric fields and falls back for invalid values', () => {
    const parsed = getMemoryConfig(
      memorySettings({
        model: '',
        maxResults: '100',
        minSimilarity: '-4',
        maxQueries: '0',
        everyNMessages: 'abc',
        maxStored: '1',
        backfillChunk: '999',
      }),
      config(),
    );
    expect(parsed.model).toBe('gpt-4o');
    expect(parsed.maxResults).toBe(20);
    expect(parsed.minSimilarity).toBe(-1);
    expect(parsed.maxQueries).toBe(4);
    expect(parsed.everyNMessages).toBe(6);
    expect(parsed.maxStored).toBe(10);
    expect(parsed.backfillChunk).toBe(200);
  });

  test('honours scope, model and similarity overrides', () => {
    const parsed = getMemoryConfig(
      memorySettings({
        scope: 'session',
        model: ' memory-model ',
        minSimilarity: '0.75',
      }),
      config(),
    );
    expect(parsed).toMatchObject({
      enabled: true,
      scope: 'session',
      model: 'memory-model',
      minSimilarity: 0.75,
    });
  });

  test('memoryScopeId encodes the configured scope', () => {
    expect(memoryScopeId('character', 'c1', 's1')).toBe('character:c1');
    expect(memoryScopeId('session', 'c1', 's1')).toBe('session:s1');
  });
});

describe('per-character memory settings', () => {
  test('round-trips settings per character', () => {
    expect(loadMemorySettings('c1')).toEqual(DEFAULT_MEMORY_SETTINGS);
    saveMemorySettings(
      'c1',
      memorySettings({ scope: 'session', maxResults: '9', model: 'small' }),
    );
    expect(loadMemorySettings('c1')).toEqual(
      memorySettings({ scope: 'session', maxResults: '9', model: 'small' }),
    );
    expect(loadMemorySettings('c2')).toEqual(DEFAULT_MEMORY_SETTINGS);
  });

  test('falls back to defaults for missing or corrupt values', () => {
    setKV('memoryConfig:c1', '{not json');
    expect(loadMemorySettings('c1')).toEqual(DEFAULT_MEMORY_SETTINGS);

    setKV(
      'memoryConfig:c1',
      JSON.stringify({ enabled: 'yes', scope: 'weird', maxResults: 7 }),
    );
    expect(loadMemorySettings('c1')).toEqual(DEFAULT_MEMORY_SETTINGS);
  });

  test('ignores an empty character id when saving', () => {
    saveMemorySettings('', memorySettings());
    expect(
      conn()
        .prepare("SELECT COUNT(*) AS count FROM kv_store WHERE key LIKE 'memoryConfig:%'")
        .all()[0].count,
    ).toBe(0);
  });
});

describe('buildMemoryPassMessages', () => {
  test('labels summaries and formats both speakers', () => {
    const formatted = formatMemoryMessages(
      [
        message('m1', 'user', 'Hello'),
        message('m2', 'assistant', '[Summary] They met a knight.'),
      ],
      'Alice',
    );
    expect(formatted).toBe('User: Hello\n\nStory so far: They met a knight.');
  });

  test('includes remembered facts and marks missing new messages', () => {
    const messages = buildMemoryPassMessages({
      characterName: 'Alice',
      recent: [message('m1', 'user', 'Hello')],
      pending: [],
      remembered: ['Alice has a sword.'],
    });
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toContain('(none — do not write facts)');
    expect(messages[1].content).toContain('REMEMBERED:\n- Alice has a sword.');
  });
});

describe('rankMemories', () => {
  const list = [
    memory({ id: 'a', vector: [1, 0] }),
    memory({ id: 'b', vector: [0.6, 0.8] }),
    memory({ id: 'c', vector: [0, 1] }),
    memory({ id: 'd', vector: [1, 0, 0] }),
  ];

  test('ranks by best similarity and drops below the threshold', () => {
    const ranked = rankMemories([[1, 0]], list, 0.5, 5);
    expect(ranked.map(entry => entry.memory.id)).toEqual(['a', 'b']);
    expect(ranked[0].score).toBeCloseTo(1);
    expect(ranked[1].score).toBeCloseTo(0.6);
  });

  test('caps results and ignores mismatched vector lengths', () => {
    const ranked = rankMemories([[1, 0]], list, -1, 2);
    expect(ranked.map(entry => entry.memory.id)).toEqual(['a', 'b']);
  });

  test('uses the best score across multiple query vectors', () => {
    const ranked = rankMemories(
      [
        [0, 1],
        [1, 0],
      ],
      list,
      0,
      3,
    );
    expect(ranked.map(entry => entry.memory.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('buildMemoryInjection', () => {
  test('formats facts and returns an empty string for none', () => {
    expect(buildMemoryInjection([])).toBe('');
    expect(buildMemoryInjection(['A', 'B'])).toBe(
      '[Long-term Memory]\n- A\n- B',
    );
  });
});

describe('database memory storage', () => {
  test('stores memories encrypted and reads them back', async () => {
    await saveMemoryToDB(
      memory({ text: 'A secret fact.', vector: [0.5, 0.5] }),
    );
    const raw = conn()
      .prepare('SELECT text, vector FROM memories')
      .all()[0] as { text: string; vector: string };
    expect(raw.text).not.toBe('A secret fact.');
    expect(raw.vector).not.toBe('[0.5,0.5]');

    const [stored] = await getMemoriesForScopeFromDB('character:c1');
    expect(stored.text).toBe('A secret fact.');
    expect(stored.vector).toEqual([0.5, 0.5]);
  });

  test('deleteSession removes session memories and KV state only', async () => {
    conn().exec(`
      INSERT INTO characters (id, name) VALUES ('c1', 'Alice');
      INSERT INTO chat_sessions (id, character_id, created_at, updated_at)
        VALUES ('s1', 'c1', 1, 1);
    `);
    await saveMemoryToDB(memory());
    await saveMemoryToDB(memory({ id: 'memory-2', scopeId: 'session:s1' }));
    setKV('memorySeq:s1', 'm1');
    setKV('memoryQueries:s1', '{}');
    setKV('memoryBackfillAsked:s1', '1');

    deleteSession('s1');

    expect(getMemoryCountFromDB('session:s1')).toBe(0);
    expect(getMemoryCountFromDB('character:c1')).toBe(1);
    expect(getKV('memorySeq:s1')).toBeNull();
    expect(getKV('memoryQueries:s1')).toBeNull();
    expect(getKV('memoryBackfillAsked:s1')).toBeNull();
  });

  test('deleteCharacterFromDB removes character and session memories', async () => {
    conn().exec(`
      INSERT INTO characters (id, name) VALUES ('c1', 'Alice');
      INSERT INTO chat_sessions (id, character_id, created_at, updated_at)
        VALUES ('s1', 'c1', 1, 1);
    `);
    await saveMemoryToDB(memory());
    await saveMemoryToDB(memory({ id: 'memory-2', scopeId: 'session:s1' }));

    deleteCharacterFromDB('c1');

    expect(getMemoryCountFromDB('character:c1')).toBe(0);
    expect(getMemoryCountFromDB('session:s1')).toBe(0);
  });

  test('labels scopes with character and session names', async () => {
    conn().exec(`
      INSERT INTO characters (id, name) VALUES ('c1', 'Alice');
      INSERT INTO chat_sessions (id, character_id, name, created_at, updated_at)
        VALUES ('s1', 'c1', 'Night watch', 1, 1);
    `);
    await saveMemoryToDB(memory());
    await saveMemoryToDB(
      memory({
        id: 'memory-2',
        scopeId: 'session:s1',
        text: 'A session fact.',
      }),
    );

    const listings = await getAllMemoryListingsFromDB();
    const labels = Object.fromEntries(
      listings.map(entry => [entry.id, entry.scopeLabel]),
    );
    expect(labels).toEqual({
      'memory-1': 'Alice',
      'memory-2': 'Night watch',
    });
  });

  test('prunes unpinned memories and keeps pinned ones', () => {
    conn().exec(`
      INSERT INTO memories (id, scope_id, text, created_at, updated_at, last_used_at, pinned)
      VALUES ('old', 'character:c1', 'old', 1, 1, 0, 0),
             ('recent', 'character:c1', 'recent', 2, 2, 5, 0),
             ('pinned', 'character:c1', 'pinned', 3, 3, 0, 1);
    `);
    expect(pruneMemoriesInDB('character:c1', 2)).toBe(1);
    const ids = conn()
      .prepare('SELECT id FROM memories WHERE scope_id = ? ORDER BY id')
      .all('character:c1')
      .map((row: { id: string }) => row.id);
    expect(ids).toEqual(['pinned', 'recent']);
  });
});

describe('memory indexing', () => {
  test('saves facts with vectors and rejects textual and semantic duplicates', async () => {
    const cfg = config();
    expect(
      await saveAndIndexMemory(
        'character:c1',
        'The knight keeps a sword.',
        cfg,
        's1',
      ),
    ).toBe(true);
    expect(
      await saveAndIndexMemory(
        'character:c1',
        'The knight keeps a sword.',
        cfg,
        's1',
      ),
    ).toBe(false);
    expect(
      await saveAndIndexMemory(
        'character:c1',
        'A blade in the dark.',
        cfg,
        's1',
      ),
    ).toBe(false);

    const stored = await getMemoriesForScopeFromDB('character:c1');
    expect(stored).toHaveLength(1);
    expect(stored[0].vector).toEqual([1, 0]);
    expect(stored[0].vectorKey).toBe(
      embeddingKey(memoryRagConfig(cfg), cfg),
    );
  });

  test('stores facts unindexed when embeddings fail', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetEmbeddings.mockRejectedValue(new Error('offline'));
    const stored = await saveAndIndexMemory(
      'character:c1',
      'A gamma fact.',
      config(),
      's1',
    );
    expect(stored).toBe(true);
    const [entry] = await getMemoriesForScopeFromDB('character:c1');
    expect(entry.vector).toEqual([]);
    expect(entry.vectorKey).toBe('');
    warn.mockRestore();
  });

  test('re-embeds memories when the embedding target changes', async () => {
    const cfg = config();
    await saveMemoryToDB(
      memory({ text: 'A beta fact.', vector: [], vectorKey: '' }),
    );
    expect(await reembedMemories('character:c1', cfg, 10)).toBe(1);
    const [entry] = await getMemoriesForScopeFromDB('character:c1');
    expect(entry.vector).toEqual([0.6, 0.8]);
    expect(entry.vectorKey).toBe(embeddingKey(memoryRagConfig(cfg), cfg));
    expect(await reembedMemories('character:c1', cfg, 10)).toBe(0);
  });
});

describe('buildMemoryContext', () => {
  async function store(
    cfg: PromptConfig,
    overrides: Partial<StoredMemory> = {},
  ) {
    await saveMemoryToDB(
      memory({
        vectorKey: embeddingKey(memoryRagConfig(cfg), cfg),
        ...overrides,
      }),
    );
  }

  test('returns nothing when disabled or when the scope has no memories', async () => {
    const cfg = config();
    expect(
      (await buildMemoryContext({
        scopeId: 'character:c1',
        sessionId: 's1',
        userText: 'knight',
        settings: memorySettings({ enabled: false }),
        config: cfg,
      })).block,
    ).toBe('');
    expect(
      (await buildMemoryContext({
        scopeId: 'character:c1',
        sessionId: 's1',
        userText: 'knight',
        settings: memorySettings(),
        config: cfg,
      })).block,
    ).toBe('');
    expect(mockGetEmbeddings).not.toHaveBeenCalled();
  });

  test('injects ranked memories and marks them used', async () => {
    const cfg = config();
    await store(cfg);
    const { block, results } = await buildMemoryContext({
      scopeId: 'character:c1',
      sessionId: 's1',
      userText: 'Tell me about the knight',
      settings: memorySettings(),
      config: cfg,
    });
    expect(results).toEqual(['The knight is named Aldric.']);
    expect(block).toBe('[Long-term Memory]\n- The knight is named Aldric.');
    const [entry] = await getMemoriesForScopeFromDB('character:c1');
    expect(entry.lastUsedAt).toBeGreaterThan(0);
  });

  test('respects the similarity threshold and the vector key', async () => {
    const cfg = config();
    const set = memorySettings({ minSimilarity: '0.9' });
    await store(cfg, { vector: [0.6, 0.8] });
    expect(
      (await buildMemoryContext({
        scopeId: 'character:c1',
        sessionId: 's1',
        userText: 'knight',
        settings: set,
        config: cfg,
      })).block,
    ).toBe('');

    await store(cfg, { id: 'memory-2', vectorKey: 'old-model-key' });
    expect(
      (await buildMemoryContext({
        scopeId: 'character:c1',
        sessionId: 's1',
        userText: 'knight',
        settings: set,
        config: cfg,
      })).block,
    ).toBe('');
  });

  test('uses cached queries only for the matching last message', async () => {
    const cfg = config();
    await store(cfg, { vector: [0, 1] });
    setKV(
      'memoryQueries:s1',
      JSON.stringify({ lastMessageId: 'm4', queries: ['gamma'] }),
    );

    expect(
      (await buildMemoryContext({
        scopeId: 'character:c1',
        sessionId: 's1',
        priorLastMessageId: 'm4',
        userText: '',
        settings: memorySettings(),
        config: cfg,
      })).block,
    ).toBe('[Long-term Memory]\n- The knight is named Aldric.');
    expect(
      (await buildMemoryContext({
        scopeId: 'character:c1',
        sessionId: 's1',
        priorLastMessageId: 'm2',
        userText: '',
        settings: memorySettings(),
        config: cfg,
      })).block,
    ).toBe('');
  });

  test('ignores the user text in continue mode but keeps cached queries', async () => {
    const cfg = config();
    await store(cfg);
    setKV(
      'memoryQueries:s1',
      JSON.stringify({ lastMessageId: 'm2', queries: ['knight'] }),
    );
    expect(
      (await buildMemoryContext({
        scopeId: 'character:c1',
        sessionId: 's1',
        priorLastMessageId: 'm2',
        userText: 'gamma',
        settings: memorySettings(),
        config: cfg,
        continueMode: true,
      })).block,
    ).toBe('[Long-term Memory]\n- The knight is named Aldric.');

    setKV('memoryQueries:s1', '');
    expect(
      (await buildMemoryContext({
        scopeId: 'character:c1',
        sessionId: 's1',
        priorLastMessageId: 'm2',
        userText: 'knight',
        settings: memorySettings(),
        config: cfg,
        continueMode: true,
      })).block,
    ).toBe('');
  });

  test('caps the number of embedded queries', async () => {
    const cfg = config();
    await store(cfg);
    setKV(
      'memoryQueries:s1',
      JSON.stringify({
        lastMessageId: 'm4',
        queries: ['query-one', 'query-two', 'query-three'],
      }),
    );
    mockGetEmbeddings.mockClear();
    await buildMemoryContext({
      scopeId: 'character:c1',
      sessionId: 's1',
      priorLastMessageId: 'm4',
      userText: 'query-four',
      settings: memorySettings({ maxQueries: '2' }),
      config: cfg,
    });
    expect(mockGetEmbeddings).toHaveBeenCalledTimes(1);
    expect(mockGetEmbeddings.mock.calls[0][0]).toEqual([
      'query-one',
      'query-two',
    ]);
  });
});

describe('runMemoryPass', () => {
  test('baselines the watermark on the first run without calling the model', async () => {
    const messages = [
      message('m1', 'user', 'Hello'),
      message('m2', 'assistant', 'Hi'),
    ];
    await runMemoryPass({
      sessionId: 's1',
      characterName: 'Alice',
      scopeId: 'character:c1',
      messages,
      settings: memorySettings(),
      config: config(),
    });
    expect(mockGetAIResponse).not.toHaveBeenCalled();
    expect(getKV('memorySeq:s1')).toBe('m1');
  });

  test('waits for enough pending messages before extracting facts', async () => {
    const cfg = config();
    const settings = memorySettings({ everyNMessages: '6' });
    const messages = [
      message('m1', 'user', 'Hello'),
      message('m2', 'assistant', 'Hi'),
    ];
    const input = {
      sessionId: 's1',
      characterName: 'Alice',
      scopeId: 'character:c1',
      settings,
      config: cfg,
    };
    await runMemoryPass({ ...input, messages });
    messages.push(message('m3', 'user', 'More'));
    messages.push(message('m4', 'assistant', 'Sure'));
    await runMemoryPass({ ...input, messages });
    expect(mockGetAIResponse).not.toHaveBeenCalled();
    expect(getKV('memorySeq:s1')).toBe('m1');
  });

  test('caches queries, stores facts and advances the watermark', async () => {
    const cfg = config();
    const settings = memorySettings({
      everyNMessages: '2',
      maxQueries: '3',
      model: 'memory-model',
    });
    mockGetAIResponse.mockResolvedValue({
      content:
        'QUERIES:\n- knight\n- sword\nFACTS:\n- The knight is named Aldric.',
    });
    const messages = [
      message('m1', 'user', 'Hello'),
      message('m2', 'assistant', 'Hi'),
    ];
    const input = {
      sessionId: 's1',
      characterName: 'Alice',
      scopeId: 'character:c1',
      settings,
      config: cfg,
    };
    await runMemoryPass({ ...input, messages });
    messages.push(message('m3', 'user', 'Who is the knight?'));
    messages.push(message('m4', 'assistant', 'Aldric.'));

    await runMemoryPass({ ...input, messages });

    expect(mockGetAIResponse).toHaveBeenCalledTimes(1);
    const [modelMessages, modelConfig] = mockGetAIResponse.mock.calls[0];
    expect(modelConfig.model).toBe('memory-model');
    expect(modelMessages[1].content).toContain('NEW MESSAGES:');
    expect(modelMessages[1].content).toContain('User: Who is the knight?');
    expect(JSON.parse(getKV('memoryQueries:s1')!)).toEqual({
      lastMessageId: 'm4',
      queries: ['knight', 'sword'],
    });
    expect(getKV('memorySeq:s1')).toBe('m4');

    const stored = await getMemoriesForScopeFromDB('character:c1');
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('The knight is named Aldric.');
    expect(stored[0].vector).toEqual([1, 0]);
  });

  test('does not store the same fact twice', async () => {
    const cfg = config();
    const settings = memorySettings({ everyNMessages: '2' });
    mockGetAIResponse.mockResolvedValue({
      content: 'FACTS:\n- The knight is named Aldric.',
    });
    const messages = [
      message('m1', 'user', 'Hello'),
      message('m2', 'assistant', 'Hi'),
    ];
    const input = {
      sessionId: 's1',
      characterName: 'Alice',
      scopeId: 'character:c1',
      settings,
      config: cfg,
    };
    await runMemoryPass({ ...input, messages });
    messages.push(message('m3', 'user', 'Again?'));
    messages.push(message('m4', 'assistant', 'Yes.'));
    await runMemoryPass({ ...input, messages });
    messages.push(message('m5', 'user', 'Once more.'));
    messages.push(message('m6', 'assistant', 'Fine.'));

    await runMemoryPass({ ...input, messages });

    expect(await getMemoriesForScopeFromDB('character:c1')).toHaveLength(1);
    expect(getKV('memorySeq:s1')).toBe('m6');
  });

  test('does nothing when memory is disabled or there are no messages', async () => {
    const input = {
      sessionId: 's1',
      characterName: 'Alice',
      scopeId: 'character:c1',
      messages: [message('m1', 'user', 'Hello')],
    };
    await runMemoryPass({
      ...input,
      settings: memorySettings({ enabled: false }),
      config: config(),
    });
    await runMemoryPass({
      ...input,
      messages: [],
      settings: memorySettings(),
      config: config(),
    });
    expect(mockGetAIResponse).not.toHaveBeenCalled();
    expect(getKV('memorySeq:s1')).toBeNull();
  });
});

describe('memory backfill', () => {
  const messages = Array.from({ length: 10 }, (_, i) =>
    message(`m${i + 1}`, i % 2 === 0 ? 'user' : 'assistant', `Line ${i + 1}`),
  );

  test('estimates messages, calls and tokens', () => {
    const estimate = estimateMemoryBackfill(messages, 5);
    expect(estimate.messages).toBe(10);
    expect(estimate.calls).toBe(2);
    expect(estimate.tokens).toBeGreaterThan(0);
    expect(estimateMemoryBackfill(messages, 0).calls).toBe(1);
  });

  test('processes chunks, stores facts and advances the watermark', async () => {
    mockGetAIResponse
      .mockResolvedValueOnce({ content: 'FACTS:\n- Fact gamma.' })
      .mockResolvedValueOnce({ content: 'FACTS:\n- Fact delta.' });
    const progress: Array<{ done: number; total: number; facts: number }> = [];
    const outcome = await runMemoryBackfill({
      sessionId: 's1',
      characterName: 'Alice',
      scopeId: 'character:c1',
      messages,
      settings: memorySettings(),
      config: config(),
      chunkSize: 5,
      onProgress: entry => progress.push(entry),
    });

    expect(outcome).toEqual({ facts: 2, calls: 2, cancelled: false });
    expect(progress).toEqual([
      { done: 1, total: 2, facts: 1 },
      { done: 2, total: 2, facts: 2 },
    ]);
    const stored = await getMemoriesForScopeFromDB('character:c1');
    expect(stored.map(entry => entry.text)).toEqual([
      'Fact gamma.',
      'Fact delta.',
    ]);
    expect(getKV('memorySeq:s1')).toBe('m10');
  });

  test('stops without calling the model when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await runMemoryBackfill({
      sessionId: 's1',
      characterName: 'Alice',
      scopeId: 'character:c1',
      messages,
      settings: memorySettings(),
      config: config(),
      controller,
    });
    expect(outcome).toEqual({ facts: 0, calls: 0, cancelled: true });
    expect(mockGetAIResponse).not.toHaveBeenCalled();
  });
});

describe('prompt injection', () => {
  const character = {
    id: 'c1',
    name: 'Alice',
    description: '',
    personality: '',
    scenario: '',
    initialMessage: '',
    exampleMessages: '',
    customFields: [],
    lorebookIds: [],
  } as Character;

  test('resolves $MEMORY$ and removes it when empty', () => {
    const cfg = {
      ...DEFAULT_PROMPT_CONFIG,
      prefix: 'Before\n$MEMORY$\nAfter',
      suffix: '',
    };
    const withMemory = buildPrompt(
      character,
      'hi',
      [],
      cfg,
      undefined,
      undefined,
      undefined,
      '[Long-term Memory]\n- A fact',
    );
    expect(withMemory[0].content).toBe(
      'Before\n[Long-term Memory]\n- A fact\nAfter',
    );

    const withoutMemory = buildPrompt(character, 'hi', [], cfg);
    expect(withoutMemory[0].content).toBe('Before\n\nAfter');
    expect(withoutMemory[0].content).not.toContain('$MEMORY$');
  });
});

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
  },
}));

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: {},
  saveDocuments: jest.fn(),
  isKnownType: jest.fn(),
}));

jest.mock('../src/Endpoint', () => ({
  getAIResponse: jest.fn(),
}));

jest.mock('react-native-nitro-sqlite', () => {
  const { DatabaseSync } = require('node:sqlite');
  const conn = new DatabaseSync(':memory:');
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

import { checkAndSummarize } from '../src/Summarizer';
import * as Database from '../src/Database';
import { getAIResponse } from '../src/Endpoint';
import { DEFAULT_PROMPT_CONFIG } from '../src/PromptHandler';
import type { ChatMessage, ChatSession } from '../src/useChat';
import { encrypt } from '../src/Crypto';

const mockedAI = getAIResponse as jest.Mock;

const config = {
  enabled: true,
  tokenThreshold: 10,
  maxSummaries: 3,
  model: '',
};

const msg = (
  id: string,
  role: ChatMessage['role'],
  content: string,
  timestamp = 1000,
): ChatMessage => ({ id, role, content, timestamp });

const longTurns = (prefix: string): ChatMessage[] => [
  msg(`${prefix}1`, 'user', `${prefix} a`.repeat(60)),
  msg(`${prefix}2`, 'assistant', `${prefix} b`.repeat(60)),
  msg(`${prefix}3`, 'user', `${prefix} c`.repeat(60)),
  msg(`${prefix}4`, 'assistant', `${prefix} d`.repeat(60)),
  msg(`${prefix}5`, 'user', 'ok'),
  msg(`${prefix}6`, 'assistant', 'ok'),
];

async function makeSession(
  id: string,
  messages: ChatMessage[],
): Promise<ChatSession> {
  const session: ChatSession = {
    id,
    characterId: 'char1',
    messages,
    createdAt: 1,
    updatedAt: 1,
  };
  await Database.createSession(session);
  return session;
}

async function stored(id: string): Promise<ChatMessage[]> {
  return (await Database.getSessionById(id))!.messages;
}

const summaries = (messages: ChatMessage[]) =>
  messages.filter(m => m.content.startsWith('[Summary]'));

// Crypto.getKey has no in-flight guard: concurrent first calls (createSession
// encrypts its messages in parallel) each mint a different key. Load the key
// once up front so every row is encrypted with the same one.
beforeAll(async () => {
  await encrypt('warm-up');
});

beforeEach(() => {
  mockedAI.mockReset();
  jest.restoreAllMocks();
});

test('empty summary leaves the session untouched', async () => {
  mockedAI.mockResolvedValue({ content: '   \n ' });
  const session = await makeSession('empty', longTurns('e'));
  const before = await stored('empty');

  const result = await checkAndSummarize(
    session,
    config,
    DEFAULT_PROMPT_CONFIG,
  );

  expect(result).toBe(session);
  expect(await stored('empty')).toEqual(before);
});

test('a failed summary insert deletes nothing', async () => {
  mockedAI.mockResolvedValue({ content: 'SUMMARY' });
  const session = await makeSession('failins', longTurns('f'));
  const before = await stored('failins');
  const deleteSpy = jest.spyOn(Database, 'deleteMessage');
  jest
    .spyOn(Database, 'addMessage')
    .mockRejectedValueOnce(new Error('disk full'));

  const result = await checkAndSummarize(
    session,
    config,
    DEFAULT_PROMPT_CONFIG,
  );

  expect(result).toBe(session);
  expect(deleteSpy).not.toHaveBeenCalled();
  expect(await stored('failins')).toEqual(before);
});

test('a second pass keeps one copy of each summary, oldest first, matching the DB', async () => {
  mockedAI.mockResolvedValueOnce({ content: 'FIRST' });
  const session = await makeSession('twice', longTurns('x'));
  const first = await checkAndSummarize(
    session,
    config,
    DEFAULT_PROMPT_CONFIG,
  );
  expect(first.messages.map(m => m.content)).toEqual([
    '[Summary] FIRST',
    'ok',
    'ok',
  ]);

  for (const m of longTurns('y')) {
    await Database.addMessage('twice', m);
  }
  const reloaded = (await Database.getSessionById('twice'))!;

  mockedAI.mockResolvedValueOnce({ content: 'SECOND' });
  const second = await checkAndSummarize(
    reloaded,
    config,
    DEFAULT_PROMPT_CONFIG,
  );

  // The old summary must not be fed into the new one.
  const secondInput = mockedAI.mock.calls[1][0][1].content as string;
  expect(secondInput).not.toContain('FIRST');

  const contents = second.messages.map(m => m.content);
  expect(contents).toEqual(['[Summary] FIRST', '[Summary] SECOND', 'ok', 'ok']);
  const db = await stored('twice');
  expect(db.map(m => m.content)).toEqual(contents);
  expect(db.map(m => m.id)).toEqual(second.messages.map(m => m.id));
});

test('maxSummaries bounds the summaries stored for a session', async () => {
  // Legacy layout: two summaries stored newest-first ahead of the chat.
  const legacy = [
    msg('s2', 'assistant', '[Summary] TWO', 2000),
    msg('s1', 'assistant', '[Summary] ONE', 1000),
    ...longTurns('z'),
  ];
  const session = await makeSession('bounded', legacy);
  mockedAI
    .mockResolvedValueOnce({ content: 'THREE' })
    .mockResolvedValueOnce({ content: 'MERGED' });

  const result = await checkAndSummarize(
    session,
    { ...config, maxSummaries: 2 },
    DEFAULT_PROMPT_CONFIG,
  );

  // The merge pass receives the two oldest summaries, oldest first.
  const mergeInput = mockedAI.mock.calls[1][0][1].content as string;
  expect(mergeInput).toBe('ONE\n\nTWO');

  const contents = result.messages.map(m => m.content);
  expect(contents).toEqual(['[Summary] MERGED', '[Summary] THREE', 'ok', 'ok']);
  const db = await stored('bounded');
  expect(db.map(m => m.content)).toEqual(contents);
  expect(summaries(db)).toHaveLength(2);
});

test('a merge failure still stores the new summary consistently', async () => {
  const legacy = [
    msg('t1', 'assistant', '[Summary] ONE', 1000),
    ...longTurns('w'),
  ];
  const session = await makeSession('mergefail', legacy);
  mockedAI
    .mockResolvedValueOnce({ content: 'TWO' })
    .mockRejectedValueOnce(new Error('network'));

  const result = await checkAndSummarize(
    session,
    { ...config, maxSummaries: 1 },
    DEFAULT_PROMPT_CONFIG,
  );

  const contents = result.messages.map(m => m.content);
  expect(contents).toEqual(['[Summary] ONE', '[Summary] TWO', 'ok', 'ok']);
  expect((await stored('mergefail')).map(m => m.content)).toEqual(contents);
});

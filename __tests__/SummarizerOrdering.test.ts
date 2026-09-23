jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: {WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly'},
}));

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: {},
  saveDocuments: jest.fn(),
  isKnownType: jest.fn(),
}));

jest.mock('../src/Endpoint', () => ({
  getAIResponse: jest.fn().mockResolvedValue({content: 'SUMMARY_TEXT'}),
}));

jest.mock('react-native-nitro-sqlite', () => {
  const {DatabaseSync} = require('node:sqlite');
  const conn = new DatabaseSync(':memory:');
  return {
    open: jest.fn(() => ({
      execute: (sql: string, params: (string | number | null)[] = []) => {
        const returnsRows = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql);
        const stmt = conn.prepare(sql);
        if (returnsRows) {
          return {results: stmt.all(...params)};
        }
        const info = stmt.run(...params);
        return {results: [], rowsAffected: Number(info.changes)};
      },
    })),
  };
});

import {checkAndSummarize} from '../src/Summarizer';
import {createSession, getSessionById} from '../src/Database';
import {DEFAULT_PROMPT_CONFIG} from '../src/PromptHandler';
import type {ChatMessage, ChatSession} from '../src/useChat';

const msg = (id: string, role: ChatMessage['role'], content: string): ChatMessage => ({
  id,
  role,
  content,
  timestamp: 1000,
});

test('persisted order matches the summarized session returned in memory', async () => {
  const messages: ChatMessage[] = [
    msg('m1', 'user', 'a'.repeat(200)),
    msg('m2', 'assistant', 'b'.repeat(200)),
    msg('m3', 'user', 'c'.repeat(200)),
    msg('m4', 'assistant', 'd'.repeat(200)),
    msg('m5', 'user', 'ok'),
    msg('m6', 'assistant', 'ok'),
  ];
  const session: ChatSession = {
    id: 'sum1',
    characterId: 'char1',
    messages,
    createdAt: 1,
    updatedAt: 1,
  };
  await createSession(session);

  const config = {
    enabled: true,
    tokenThreshold: 10,
    maxSummaries: 3,
    model: '',
  };
  const summarized = await checkAndSummarize(session, config, DEFAULT_PROMPT_CONFIG);

  const inMemory = summarized.messages.map(m => m.content);
  expect(inMemory[0]).toBe('[Summary] SUMMARY_TEXT');
  expect(inMemory).toEqual(['[Summary] SUMMARY_TEXT', 'ok', 'ok']);

  const stored = await getSessionById('sum1');
  expect(stored!.messages.map(m => m.content)).toEqual(inMemory);
});

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

import {estimateTokens, buildPrompt, DEFAULT_PROMPT_CONFIG} from '../src/PromptHandler';
import type {Character} from '../src/CharacterEditor';
import type {ChatMessage} from '../src/useChat';

const char: Character = {
  id: '1',
  name: 'Bob',
  description: 'a description',
  personality: 'p',
  scenario: 's',
  initialMessage: 'hi',
  exampleMessages: '',
  writingStyle: '',
  lorebookIds: [],
};

const history: ChatMessage[] = [
  {id: '1', role: 'user', content: 'u1', timestamp: 1},
  {id: '2', role: 'assistant', content: 'a1', timestamp: 2},
  {id: '3', role: 'user', content: 'u2', timestamp: 3},
];

describe('estimateTokens', () => {
  test('empty string is zero', () => {
    expect(estimateTokens('')).toBe(0);
  });

  test('short text returns a positive count', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
  });

  test('long text (>2000 chars) uses the length/4 heuristic', () => {
    const text = 'a'.repeat(5000);
    expect(estimateTokens(text)).toBe(Math.ceil(5000 / 4));
  });
});

describe('buildPrompt', () => {
  test('starts with a system message containing the character name', () => {
    const msgs = buildPrompt(char, 'hello', [], DEFAULT_PROMPT_CONFIG);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('Bob');
  });

  test('ends with the latest user message', () => {
    const msgs = buildPrompt(char, 'hello', history, DEFAULT_PROMPT_CONFIG);
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toBe('hello');
  });

  test('includes full history when under the cutoff', () => {
    const cfg = {...DEFAULT_PROMPT_CONFIG, historyCutoffAmount: '20'};
    const msgs = buildPrompt(char, 'hello', history, cfg);
    expect(msgs.length).toBe(5);
  });

  test('slices history down to the cutoff amount', () => {
    const cfg = {...DEFAULT_PROMPT_CONFIG, historyCutoffAmount: '1'};
    const msgs = buildPrompt(char, 'hello', history, cfg);
    expect(msgs.length).toBe(3);
    expect(msgs[1].content).toBe('u2');
  });
});

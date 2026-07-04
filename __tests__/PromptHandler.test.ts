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

import {estimateTokens, buildPrompt, DEFAULT_PROMPT_CONFIG, addPersona, updatePersona, deletePersona, activatePersona} from '../src/PromptHandler';
import type {PromptConfig} from '../src/PromptHandler';
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

describe('persona helpers', () => {
  const base: PromptConfig = {
    ...DEFAULT_PROMPT_CONFIG,
    personas: [
      {id: 'a', name: 'Alpha', description: 'desc a'},
      {id: 'b', name: 'Beta', description: 'desc b'},
    ],
    activePersonaId: 'a',
    userDescription: 'desc a',
  };

  test('addPersona appends without mutating the source list', () => {
    const next = addPersona(base, {id: 'c', name: 'Gamma', description: 'desc c'});
    expect(next.personas).toHaveLength(3);
    expect(next.personas[2].name).toBe('Gamma');
    expect(base.personas).toHaveLength(2);
  });

  test('addPersona chains so rapid double-add keeps both entries', () => {
    const p1 = {id: 'c', name: 'Gamma', description: ''};
    const p2 = {id: 'd', name: 'Delta', description: ''};
    const next = addPersona(addPersona(base, p1), p2);
    expect(next.personas.map(p => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('updatePersona edits the matched index and leaves others intact', () => {
    const next = updatePersona(base, 1, {name: 'Beta+'});
    expect(next.personas[1].name).toBe('Beta+');
    expect(next.personas[1].description).toBe('desc b');
    expect(next.personas[0].name).toBe('Alpha');
  });

  test('updatePersona is a no-op for an out-of-range index', () => {
    const next = updatePersona(base, 99, {name: 'X'});
    expect(next.personas).toEqual(base.personas);
  });

  test('deletePersona clears activePersonaId when the active one is removed', () => {
    const next = deletePersona(base, 0);
    expect(next.personas.map(p => p.id)).toEqual(['b']);
    expect(next.activePersonaId).toBeNull();
    expect(next.userDescription).toBe('desc b');
  });

  test('deletePersona keeps activePersonaId when an inactive one is removed', () => {
    const next = deletePersona(base, 1);
    expect(next.personas.map(p => p.id)).toEqual(['a']);
    expect(next.activePersonaId).toBe('a');
    expect(next.userDescription).toBe('desc a');
  });

  test('activatePersona sets activePersonaId and userDescription from the latest config', () => {
    const edited = updatePersona(base, 1, {description: 'fresh desc'});
    const next = activatePersona(edited, 1);
    expect(next.activePersonaId).toBe('b');
    expect(next.userDescription).toBe('fresh desc');
  });

  test('activatePersona is a no-op for an out-of-range index', () => {
    const next = activatePersona(base, 99);
    expect(next).toEqual(base);
  });
});

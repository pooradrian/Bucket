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

import {estimateTokens, buildPrompt, buildContinuePrompt, historyWithoutLatestUserTurn, DEFAULT_PROMPT_CONFIG, addPersona, updatePersona, deletePersona, activatePersona, addModelPreset, updateModelPreset, deleteModelPreset, applyModelPreset, applyModelField, detachModelPreset} from '../src/PromptHandler';
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
  customFields: [],
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

describe('historyWithoutLatestUserTurn', () => {
  test('drops a trailing user turn that repeats the new message', () => {
    const withNewTurn = [...history, {id: '4', role: 'user' as const, content: 'hello', timestamp: 4}];
    expect(historyWithoutLatestUserTurn(withNewTurn, 'hello')).toEqual(history);
  });

  test('keeps history when the new message is not in it', () => {
    expect(historyWithoutLatestUserTurn(history, 'hello')).toEqual(history);
  });

  test('keeps history for an empty user message (continue mode)', () => {
    expect(historyWithoutLatestUserTurn(history, '')).toEqual(history);
  });

  test('keeps a trailing assistant message even if it matches the new message', () => {
    const endsWithAssistant = history.slice(0, 2);
    expect(historyWithoutLatestUserTurn(endsWithAssistant, 'a1')).toEqual(endsWithAssistant);
  });

  test('buildPrompt over a session that already holds the new turn sends it once', () => {
    const withNewTurn = [...history, {id: '4', role: 'user' as const, content: 'hello', timestamp: 4}];
    const msgs = buildPrompt(char, 'hello', historyWithoutLatestUserTurn(withNewTurn, 'hello'), DEFAULT_PROMPT_CONFIG);
    expect(msgs.filter(m => m.role === 'user' && m.content === 'hello')).toHaveLength(1);
    expect(msgs[msgs.length - 1]).toEqual({role: 'user', content: 'hello'});
  });
});

describe('buildContinuePrompt', () => {
  test('starts with a system message containing the character name', () => {
    const msgs = buildContinuePrompt(char, history, DEFAULT_PROMPT_CONFIG);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('Bob');
  });

  test('includes the full history and appends a continue nudge', () => {
    const msgs = buildContinuePrompt(char, history, DEFAULT_PROMPT_CONFIG);
    expect(msgs.length).toBe(5);
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toBe('u1');
    expect(msgs[3]).toEqual({role: 'user', content: 'u2'});
    expect(msgs.filter(m => m.role === 'assistant').length).toBe(1);
    expect(msgs[msgs.length - 1].role).toBe('user');
    expect(msgs[msgs.length - 1].content).toContain('Continue');
  });

  test('respects the history cutoff amount', () => {
    const cfg = {...DEFAULT_PROMPT_CONFIG, historyCutoffAmount: '1'};
    const msgs = buildContinuePrompt(char, history, cfg);
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

describe('model preset helpers', () => {
  const preset = {id: 'p1', model: 'gpt-4o', prefix: 'pre', suffix: 'suf', temperature: '0.7'};
  const base: PromptConfig = {
    ...DEFAULT_PROMPT_CONFIG,
    modelPresets: [preset],
    activeModelPresetId: null,
  };

  test('applyModelField applies the preset on exact model match', () => {
    const next = applyModelField(base, 'gpt-4o');
    expect(next.model).toBe('gpt-4o');
    expect(next.prefix).toBe('pre');
    expect(next.suffix).toBe('suf');
    expect(next.temperature).toBe('0.7');
    expect(next.activeModelPresetId).toBe('p1');
  });

  test('applyModelField detaches when nothing matches exactly', () => {
    const attached = {...base, activeModelPresetId: 'p1'};
    const next = applyModelField(attached, 'gpt-4o-mini');
    expect(next.model).toBe('gpt-4o-mini');
    expect(next.activeModelPresetId).toBeNull();
    expect(next.prefix).toBe(attached.prefix);
  });

  test('applyModelPreset switches model and instructions together', () => {
    const next = applyModelPreset(base, 0);
    expect(next.model).toBe('gpt-4o');
    expect(next.prefix).toBe('pre');
    expect(next.activeModelPresetId).toBe('p1');
  });

  test('detachModelPreset clears the active preset on manual edits', () => {
    const attached = {...base, activeModelPresetId: 'p1'};
    const next = detachModelPreset(attached, {temperature: '0.9'});
    expect(next.temperature).toBe('0.9');
    expect(next.activeModelPresetId).toBeNull();
  });

  test('updateModelPreset pushes edits to live fields when active', () => {
    const attached = {...base, activeModelPresetId: 'p1'};
    const next = updateModelPreset(attached, 0, {temperature: '0.2'});
    expect(next.modelPresets[0].temperature).toBe('0.2');
    expect(next.temperature).toBe('0.2');
    expect(next.activeModelPresetId).toBe('p1');
  });

  test('updateModelPreset leaves live fields alone when inactive', () => {
    const next = updateModelPreset(base, 0, {temperature: '0.2'});
    expect(next.modelPresets[0].temperature).toBe('0.2');
    expect(next.temperature).toBe(base.temperature);
  });

  test('deleteModelPreset clears the active id when the active one is removed', () => {
    const attached = {...base, activeModelPresetId: 'p1'};
    const next = deleteModelPreset(attached, 0);
    expect(next.modelPresets).toHaveLength(0);
    expect(next.activeModelPresetId).toBeNull();
  });

  test('addModelPreset appends without mutating', () => {
    const p2 = {id: 'p2', model: 'claude', prefix: '', suffix: '', temperature: '1'};
    const next = addModelPreset(base, p2);
    expect(next.modelPresets.map(p => p.id)).toEqual(['p1', 'p2']);
    expect(base.modelPresets).toHaveLength(1);
  });
});

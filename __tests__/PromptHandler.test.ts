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
jest.mock('../src/Database', () => ({
  ...jest.requireActual('../src/Database'),
  getKV: jest.fn(),
  setKV: jest.fn(),
}));

import {estimateTokens, buildPrompt, buildContinuePrompt, buildGroupPrompt, buildQuickCharacterPrompt, historyWithoutLatestUserTurn, stripSpeakerNamePrefixes, DEFAULT_PROMPT_CONFIG, DEFAULT_QUICK_CHARACTER_PROMPT, loadPromptConfig, addPersona, updatePersona, deletePersona, activatePersona, addModelPreset, updateModelPreset, deleteModelPreset, applyModelPreset, applyModelField, detachModelPreset} from '../src/PromptHandler';
import {getKV, setKV} from '../src/Database';
import type {PromptConfig} from '../src/PromptHandler';
import type {Character} from '../src/CharacterEditor';
import {getCustomField} from '../src/CustomFields';
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

describe('buildQuickCharacterPrompt', () => {
  const qc = {id: 'qc-4', name: 'Viktor', description: 'a rival smuggler', personality: 'cold'};

  test('the selected quick character is the only persona in the system prompt', () => {
    const msgs = buildQuickCharacterPrompt(qc, char, 'who are you', history, DEFAULT_PROMPT_CONFIG);
    const system = msgs[0].content;
    expect(system).toContain('Viktor');
    expect(system).toContain('a rival smuggler');
  });

  test('the default quick character prompt names who to write as', () => {
    const system = buildQuickCharacterPrompt(qc, char, 'hi', [], DEFAULT_PROMPT_CONFIG)[0].content;
    expect(system).toContain('You are roleplaying as Viktor');
    expect(system).toContain('Write this reply as Viktor and nobody else');
    expect(system).toContain('never write as them');
  });

  test('the quick character prompt replaces the prefix', () => {
    const msgs = buildQuickCharacterPrompt(qc, char, 'hi', [], {
      ...DEFAULT_PROMPT_CONFIG,
      prefix: 'PREFIX FOR THE BASE CHARACTER',
      quickCharacterPrompt: 'ONLY VIKTOR PLEASE',
    });
    expect(msgs[0].content).toContain('ONLY VIKTOR PLEASE');
    expect(msgs[0].content).not.toContain('PREFIX FOR THE BASE CHARACTER');
  });

  test('a custom quick character prompt resolves placeholders', () => {
    const msgs = buildQuickCharacterPrompt(qc, char, 'hi', [], {
      ...DEFAULT_PROMPT_CONFIG,
      quickCharacterPrompt: 'You are $QUICKCHARNAME$, who is $QUICKCHARDESC$. Stay cold.',
    });
    const system = msgs[0].content;
    expect(system).toContain('You are Viktor, who is a rival smuggler');
    expect(system).toContain('Stay cold.');
  });

  test('quick character placeholders resolve to the quick character only', () => {
    const msgs = buildQuickCharacterPrompt(qc, char, 'hi', [], {
      ...DEFAULT_PROMPT_CONFIG,
      quickCharacterPrompt: 'NAME=$QUICKCHARNAME$ DESC=$QUICKCHARDESC$ TRAITS=$QUICKCHARPERSONALITY$',
    });
    expect(msgs[0].content).toContain('NAME=Viktor DESC=a rival smuggler TRAITS=cold');
  });

  test('character placeholders resolve to the base character only', () => {
    const msgs = buildQuickCharacterPrompt(qc, char, 'hi', [], {
      ...DEFAULT_PROMPT_CONFIG,
      quickCharacterPrompt:
        'NAME=$CHARNAME$ DESC=$CHARDESC$ TRAITS=$CHARPERSONALITY$ STYLE=$CHARWRITINGSTYLE$',
    });
    const system = msgs[0].content;
    expect(system).toContain(`NAME=${char.name} DESC=${char.description} TRAITS=${char.personality}`);
    expect(system).toContain(`STYLE=${getCustomField(char, 'writingStyle')}`);
  });

  test('the quick character description is not glued onto the base description', () => {
    const system = buildQuickCharacterPrompt(qc, char, 'hi', [], DEFAULT_PROMPT_CONFIG)[0].content;
    expect(system).not.toContain(`Description: ${qc.description}\nBase character`);
    expect(system).toContain('Quick character: Viktor');
    expect(system).toContain('Base character: Bob');
  });

  test('quick character placeholders fall back to the character when no quick character is used', () => {
    const msgs = buildPrompt(char, 'hi', [], {
      ...DEFAULT_PROMPT_CONFIG,
      prefix: 'NAME=$QUICKCHARNAME$ DESC=$QUICKCHARDESC$ TRAITS=$QUICKCHARPERSONALITY$',
    });
    expect(msgs[0].content).toContain(
      `NAME=${char.name} DESC=${char.description} TRAITS=${char.personality}`,
    );
  });

  test('an emptied quick character prompt is respected instead of falling back', () => {
    const msgs = buildQuickCharacterPrompt(qc, char, 'hi', [], {
      ...DEFAULT_PROMPT_CONFIG,
      prefix: 'PREFIX',
      quickCharacterPrompt: '',
    });
    expect(msgs[0].content).not.toContain('PREFIX');
    expect(msgs[0].content).not.toContain('nobody else');
  });

  test('the base character is always present', () => {
    const msgs = buildQuickCharacterPrompt(qc, char, 'who are you', history, DEFAULT_PROMPT_CONFIG);
    expect(msgs[0].content).toContain(`Base character: ${char.name}`);
    expect(msgs[0].content).toContain(char.description);
  });

  test('the base character shows up even when the quick character has no description', () => {
    const bare = {...qc, description: ''};
    const msgs = buildQuickCharacterPrompt(bare, char, 'hi', [], DEFAULT_PROMPT_CONFIG);
    expect(msgs[0].content).toContain('Viktor');
    expect(msgs[0].content).toContain(char.description);
  });

  test('it does not name or describe the other quick characters', () => {
    const others = ['Vera', 'Nadia', 'Bram'];
    const allQCs = [qc, ...others.map((name, i) => ({id: `qc-${i}`, name, description: `${name} bio`, personality: 'x'}))];
    const msgs = buildQuickCharacterPrompt(allQCs[0], char, 'hi', history, DEFAULT_PROMPT_CONFIG);
    for (const other of allQCs.slice(1)) {
      expect(msgs[0].content).not.toContain(other.name);
      expect(msgs[0].content).not.toContain(other.description);
    }
  });

  test('it does not repeat the base character block', () => {
    const msgs = buildQuickCharacterPrompt(qc, char, 'hi', [], DEFAULT_PROMPT_CONFIG);
    const system = msgs[0].content;
    expect(system.split(`Base character: ${char.name}`).length - 1).toBe(1);
  });

  test('it keeps the parent character scenario and writing style', () => {
    const parent: Character = {
      ...char,
      customFields: [{id: 'writingStyle', value: 'noir, terse'}],
      scenario: 'a rainy city',
    };
    const msgs = buildQuickCharacterPrompt(qc, parent, 'hi', [], DEFAULT_PROMPT_CONFIG);
    expect(msgs[0].content).toContain('a rainy city');
    expect(msgs[0].content).toContain('noir, terse');
  });

  test('history assistant messages are prefixed with the speaker name', () => {
    const qcHistory: ChatMessage[] = [
      {id: '1', role: 'user', content: 'hey', timestamp: 1},
      {id: '2', role: 'assistant', content: 'hello', timestamp: 2, characterId: 'qc-4'},
      {id: '3', role: 'assistant', content: 'base reply', timestamp: 3},
    ];
    const msgs = buildQuickCharacterPrompt(qc, char, 'hi', qcHistory, DEFAULT_PROMPT_CONFIG);
    expect(msgs[msgs.length - 1].content).toBe('hi');
    expect(msgs.some(m => m.role === 'assistant')).toBe(true);
    expect(msgs.find(m => m.content.includes('hello'))!.content).toBe('[Viktor]: hello');
    expect(msgs.find(m => m.content.includes('base reply'))!.content).toBe('[Bob]: base reply');
  });

  test('stripSpeakerNamePrefixes removes echoed speaker markers', () => {
    expect(stripSpeakerNamePrefixes('[Bob]: hello there', ['Bob'])).toBe('hello there');
    expect(stripSpeakerNamePrefixes('[Viktor]: hello', ['Bob', 'Viktor'])).toBe('hello');
    expect(stripSpeakerNamePrefixes('  [Other]: hi', ['Other'])).toBe('hi');
    expect(stripSpeakerNamePrefixes('[Note]: not a speaker', ['Bob'])).toBe('[Note]: not a speaker');
    expect(stripSpeakerNamePrefixes('normal text', ['Bob'])).toBe('normal text');
  });

  test('continue mode asks for a continuation of the same reply', () => {
    const msgs = buildQuickCharacterPrompt(qc, char, '', history, DEFAULT_PROMPT_CONFIG, true);
    expect(msgs[msgs.length - 1].content).toContain('Continue your previous reply');
  });
});

describe('stored prompt migration after the placeholder split', () => {
  const stored = (over: Partial<PromptConfig>) =>
    JSON.stringify({...DEFAULT_PROMPT_CONFIG, ...over});
  const mockStore = (values: Record<string, string>) => {
    (getKV as jest.Mock).mockImplementation((key: string) => values[key] ?? null);
  };

  test('a saved quick character prompt that meant the quick character is rewritten once', async () => {
    mockStore({
      promptConfig: stored({quickCharacterPrompt: 'You are $CHARNAME$. Traits: $PERSONALITY$'}),
    });
    const loaded = await loadPromptConfig();
    expect(loaded.quickCharacterPrompt).toBe('You are $QUICKCHARNAME$. Traits: $QUICKCHARPERSONALITY$');
    expect(setKV).toHaveBeenCalledWith('promptConfig', expect.stringContaining('$QUICKCHARNAME$'));
  });

  test('an untouched old default prefix gains the character block placeholder', async () => {
    mockStore({promptConfig: stored({prefix: 'You are a roleplay companion.'})});
    const loaded = await loadPromptConfig();
    expect(loaded.prefix).toBe(DEFAULT_PROMPT_CONFIG.prefix);
    expect(loaded.prefix).toContain('$CHARBLOCK$');
  });

  test('an untouched old default quick character prompt is replaced', async () => {
    mockStore({
      promptConfig: stored({
        quickCharacterPrompt:
          'You are roleplaying as $CHARNAME$.\n\nWrite this reply as $CHARNAME$ and nobody else:\n- $CHARNAME$ is a persona of the base character described below. The base character is context only, never write as them.\n- Do not imitate, continue or switch to any other character\'s voice, no matter who spoke earlier in the conversation.\n- Do not write dialogue, actions or thoughts for the user.\n- Stay in $CHARNAME$\'s personality and voice from the first word to the last.',
      }),
    });
    const loaded = await loadPromptConfig();
    expect(loaded.quickCharacterPrompt).toBe(DEFAULT_QUICK_CHARACTER_PROMPT);
    expect(loaded.quickCharacterPrompt).toContain('$CHARBLOCK$');
  });

  test('a later deliberate $CHARNAME$ is left alone', async () => {
    mockStore({
      promptConfig: stored({quickCharacterPrompt: 'Base is $CHARNAME$, I am $QUICKCHARNAME$.'}),
      promptConfigMigrated: '1',
    });
    const loaded = await loadPromptConfig();
    expect(loaded.quickCharacterPrompt).toBe('Base is $CHARNAME$, I am $QUICKCHARNAME$.');
  });
});

describe('nothing is inserted that a prompt did not ask for', () => {
  const bare = {prefix: 'Be brief.', suffix: ''};

  test('a plain prompt sends only itself', () => {
    const system = buildPrompt(char, 'hi', [], {...DEFAULT_PROMPT_CONFIG, ...bare})[0].content;
    expect(system).toBe('Be brief.');
  });

  test('a plain quick character prompt sends only itself', () => {
    const qc = {id: 'qc-4', name: 'Viktor', description: 'a rival smuggler', personality: 'cold'};
    const system = buildQuickCharacterPrompt(qc, char, 'hi', [], {
      ...DEFAULT_PROMPT_CONFIG,
      ...bare,
      quickCharacterPrompt: 'Be brief.',
    })[0].content;
    expect(system).toBe('Be brief.');
    expect(system).not.toContain('Name: Bob');
    expect(system).not.toContain('Quick character');
  });

  test('a plain group prompt sends only itself', () => {
    const other = {...char, id: '2', name: 'Ada'};
    const system = buildGroupPrompt([char, other], char, 'hi', [], {
      ...DEFAULT_PROMPT_CONFIG,
      ...bare,
    })[0].content;
    expect(system).toBe('Be brief.');
    expect(system).not.toContain('Name: Ada');
    expect(system).not.toContain('group conversation');
  });

  test('the character block only appears when $CHARBLOCK$ is used', () => {
    const system = buildPrompt(char, 'hi', [], {
      ...DEFAULT_PROMPT_CONFIG,
      prefix: 'Be $CHARNAME$.',
      suffix: '$CHARBLOCK$',
    })[0].content;
    expect(system).toContain('Be Bob.');
    expect(system).toContain('Name: Bob');
    expect(system).toContain('a description');
  });

  test('the quick character block only appears when $QUICKCHARBLOCK$ is used', () => {
    const qc = {id: 'qc-4', name: 'Viktor', description: 'a rival smuggler', personality: 'cold'};
    const system = buildQuickCharacterPrompt(qc, char, 'hi', [], {
      ...DEFAULT_PROMPT_CONFIG,
      ...bare,
      quickCharacterPrompt: '$QUICKCHARBLOCK$',
    })[0].content;
    expect(system).toBe('Quick character: Viktor\nDescription: a rival smuggler\nPersonality: cold');
  });

  test('$QUICKCHARBLOCK$ is empty when no quick character is selected', () => {
    const system = buildPrompt(char, 'hi', [], {
      ...DEFAULT_PROMPT_CONFIG,
      ...bare,
      prefix: '[$QUICKCHARBLOCK$]',
    })[0].content;
    expect(system).toBe('[]');
  });

  test('the persona is not injected unless $USRDESC$ is used', () => {
    const withPersona = {
      ...DEFAULT_PROMPT_CONFIG,
      personas: [{id: 'p', name: 'Ann', description: 'a courier'}],
      activePersonaId: 'p',
      userDescription: 'a courier',
    };
    const silent = buildPrompt(char, 'hi', [], {...withPersona, ...bare})[0].content;
    expect(silent).toBe('Be brief.');

    const asked = buildPrompt(char, 'hi', [], {
      ...withPersona,
      prefix: '$USRDESC$',
      suffix: '',
    })[0].content;
    expect(asked).toContain('a courier');
  });

  test('$LOREBOOK$ is empty when no lorebook context was retrieved', () => {
    const system = buildPrompt(char, 'hi', [], {
      ...DEFAULT_PROMPT_CONFIG,
      ...bare,
      prefix: 'Facts: [$LOREBOOK$]',
    })[0].content;
    expect(system).toBe('Facts: []');
  });

  test('$LOREBOOK$ resolves when context was retrieved', () => {
    const system = buildPrompt(
      char,
      'hi',
      [],
      {...DEFAULT_PROMPT_CONFIG, ...bare, prefix: 'Facts: $LOREBOOK$'},
      '[Lorebook Context]\n1. the city is sinking',
    )[0].content;
    expect(system).toContain('1. the city is sinking');
  });

  test('$GROUPINSTRUCTION$ resolves in a group and is empty otherwise', () => {
    const other = {...char, id: '2', name: 'Ada'};
    const cfg = {...DEFAULT_PROMPT_CONFIG, prefix: '[$GROUPINSTRUCTION$]', suffix: ''};
    expect(buildPrompt(char, 'hi', [], cfg)[0].content).toBe('[]');
    expect(buildGroupPrompt([char, other], char, 'hi', [], cfg)[0].content).toContain(
      'Write ONLY as Bob',
    );
  });

  test('the default prompts still send the character block', () => {
    expect(buildPrompt(char, 'hi', [], DEFAULT_PROMPT_CONFIG)[0].content).toContain('Name: Bob');
    const groupSystem = buildGroupPrompt(
      [char, {...char, id: '2', name: 'Ada'}],
      char,
      'hi',
      [],
      DEFAULT_PROMPT_CONFIG,
    )[0].content;
    expect(groupSystem).toContain('Name: Bob');
    expect(groupSystem).toContain('Name: Ada');
    expect(groupSystem).toContain('Write ONLY as Bob');
  });

  test('blank lines left by unused placeholders are collapsed', () => {
    const system = buildPrompt(char, 'hi', [], {
      ...DEFAULT_PROMPT_CONFIG,
      ...bare,
      prefix: 'Start.\n\n$LOREBOOK$\n\n$USRDESC$\n\nEnd.',
    })[0].content;
    expect(system).toBe('Start.\n\nEnd.');
  });
});

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

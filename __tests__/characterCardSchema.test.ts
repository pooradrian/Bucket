jest.mock('react-native-nitro-sqlite', () => ({open: jest.fn()}));
jest.mock('react-native-nitro-modules', () => ({}));

import {parseV1Json, parseV2Json, serializeV1, serializeV2} from '../src/import/characterCardSchema';
import {Character} from '../src/CharacterEditor';

const fullChar: Character = {
  id: 'char-1',
  name: 'Alice',
  description: 'A test character',
  personality: 'cheerful',
  scenario: 'in a forest',
  initialMessage: 'Hello there!',
  exampleMessages: 'user: hi',
  writingStyle: 'concise',
  lorebookIds: ['lb-1', 'lb-2'],
  icon: 'file:///icon.png',
};

describe('parseV1Json', () => {
  it('maps v1 fields to Character shape', () => {
    const char = parseV1Json({
      name: 'Bob',
      description: 'desc',
      personality: 'p',
      scenario: 'sc',
      first_mes: 'hi',
      mes_example: 'ex',
    });
    expect(char).toMatchObject({
      name: 'Bob',
      description: 'desc',
      personality: 'p',
      scenario: 'sc',
      initialMessage: 'hi',
      exampleMessages: 'ex',
      writingStyle: '',
      lorebookIds: [],
    });
  });

  it('defaults missing optional fields to empty strings', () => {
    const char = parseV1Json({name: 'X'});
    expect(char.description).toBe('');
    expect(char.initialMessage).toBe('');
  });

  it('uses provided id when given', () => {
    expect(parseV1Json({name: 'X'}, 'fixed-id').id).toBe('fixed-id');
  });
});

describe('parseV2Json', () => {
  it('reads from data envelope', () => {
    const char = parseV2Json({
      spec: 'chara_card_v2',
      data: {name: 'V2', first_mes: 'greet'},
    });
    expect(char.name).toBe('V2');
    expect(char.initialMessage).toBe('greet');
  });

  it('falls back to top-level fields when data is absent', () => {
    const char = parseV2Json({name: 'Flat'});
    expect(char.name).toBe('Flat');
  });

  it('maps extensions.lorebookIds array', () => {
    const char = parseV2Json({
      data: {name: 'X', extensions: {lorebookIds: ['a', 'b']}},
    });
    expect(char.lorebookIds).toEqual(['a', 'b']);
  });

  it('wraps single extensions.lorebookId into an array', () => {
    const char = parseV2Json({
      data: {name: 'X', extensions: {lorebookId: 'solo'}},
    });
    expect(char.lorebookIds).toEqual(['solo']);
  });
});

describe('serializeV1', () => {
  it('round-trips through parseV1Json (lossy: drops writingStyle/lorebookIds)', () => {
    const json = serializeV1(fullChar);
    const reparsed = parseV1Json(json);
    expect(reparsed.name).toBe(fullChar.name);
    expect(reparsed.description).toBe(fullChar.description);
    expect(reparsed.initialMessage).toBe(fullChar.initialMessage);
    expect(reparsed.exampleMessages).toBe(fullChar.exampleMessages);
    expect(reparsed.personality).toBe(fullChar.personality);
    expect(reparsed.scenario).toBe(fullChar.scenario);
  });

  it('coerces undefined exampleMessages to empty string', () => {
    const json = serializeV1({...fullChar, exampleMessages: undefined});
    expect(json.mes_example).toBe('');
  });
});

describe('serializeV2', () => {
  it('produces a chara_card_v2 spec', () => {
    expect(serializeV2(fullChar).spec).toBe('chara_card_v2');
  });

  it('round-trips through parseV2Json', () => {
    const json = serializeV2(fullChar);
    const reparsed = parseV2Json(json);
    expect(reparsed.name).toBe(fullChar.name);
    expect(reparsed.description).toBe(fullChar.description);
    expect(reparsed.initialMessage).toBe(fullChar.initialMessage);
    expect(reparsed.personality).toBe(fullChar.personality);
    expect(reparsed.scenario).toBe(fullChar.scenario);
  });

  it('defaults to empty extensions object', () => {
    expect(serializeV2(fullChar).data.extensions).toEqual({});
  });
});

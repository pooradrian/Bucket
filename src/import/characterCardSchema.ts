import {Character} from '../CharacterEditor';
import {generateId} from '../Database';

interface CharacterCardExtensions {
  lorebookIds?: string[];
  lorebookId?: string;
}

interface CharacterCardData {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  extensions?: CharacterCardExtensions;
}

interface CharacterCardJson extends CharacterCardData {
  spec?: string;
  data?: CharacterCardData;
}

export function parseV1Json(json: CharacterCardJson, id?: string): Character {
  return {
    id: id || generateId(),
    name: json.name || '',
    description: json.description || '',
    personality: json.personality || '',
    scenario: json.scenario || '',
    initialMessage: json.first_mes || '',
    exampleMessages: json.mes_example || '',
    writingStyle: '',
    lorebookIds: [],
  };
}

export function parseV2Json(json: CharacterCardJson, id?: string): Character {
  const data: CharacterCardData = json.data ?? json;
  let lorebookIds: string[] = [];
  if (data.extensions?.lorebookIds && Array.isArray(data.extensions.lorebookIds)) {
    lorebookIds = data.extensions.lorebookIds;
  } else if (data.extensions?.lorebookId) {
    lorebookIds = [data.extensions.lorebookId];
  }
  return {
    id: id || generateId(),
    name: data.name || '',
    description: data.description || '',
    personality: data.personality || '',
    scenario: data.scenario || '',
    initialMessage: data.first_mes || '',
    exampleMessages: data.mes_example || '',
    writingStyle: '',
    lorebookIds,
  };
}

interface CCV1Card {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
}

export function serializeV1(char: Character): CCV1Card {
  return {
    name: char.name,
    description: char.description,
    personality: char.personality,
    scenario: char.scenario,
    first_mes: char.initialMessage,
    mes_example: char.exampleMessages || '',
  };
}

interface CCV2Card {
  spec: 'chara_card_v2';
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    alternate_greetings: string[];
    system_prompt: string;
    post_history_instructions: string;
    creator_notes: string;
    tags: string[];
    creator: string;
    character_version: string;
    extensions: {
      lorebookIds?: string[];
    };
  };
}

export function serializeV2(char: Character): CCV2Card {
  return {
    spec: 'chara_card_v2',
    data: {
      name: char.name,
      description: char.description,
      personality: char.personality,
      scenario: char.scenario,
      first_mes: char.initialMessage,
      mes_example: char.exampleMessages || '',
      alternate_greetings: [],
      system_prompt: '',
      post_history_instructions: '',
      creator_notes: 'Exported from Bucket',
      tags: [],
      creator: '',
      character_version: '1.0',
      extensions: {},
    },
  };
}

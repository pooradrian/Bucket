import {Character} from '../CharacterEditor';
import {generateId} from '../Database';

export interface PerchanceCharacter {
  name: string;
  roleInstruction: string;
  generalWritingInstructions: string;
  initialMessages: Array<{author: string; content: string}>;
  avatar: {url: string; size: number; shape: string};
  loreBookUrls: string[];
  id: number;
  [key: string]: unknown;
}

export interface PerchanceThread {
  id: number;
  characterId: number;
  name: string;
  creationTime: number;
  lastMessageTime: number;
  [key: string]: unknown;
}

export interface PerchanceMessage {
  id: number;
  threadId: number;
  characterId: number;
  message: string;
  creationTime: number;
  order: number;
  [key: string]: unknown;
}

export function parsePerchanceCharacter(pChar: PerchanceCharacter): Character {
  const initialMessage = pChar.initialMessages?.find(m => m.author === 'ai')?.content || '';
  return {
    id: generateId(),
    name: pChar.name || '',
    description: pChar.roleInstruction || '',
    personality: '',
    scenario: '',
    initialMessage,
    exampleMessages: '',
    writingStyle: pChar.generalWritingInstructions || '',
    lorebookIds: [],
  };
}

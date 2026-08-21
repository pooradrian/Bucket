import {Character} from '../CharacterEditor';
import {LorebookState} from '../RAGHandler';
import {ChatSession} from '../useChat';
import {PromptConfig} from '../PromptHandler';
import {AppSettings, GroupChat} from '../store';
import {DBQuickCharacter} from '../Database';

export type ImportFormat = 'ccv1' | 'ccv2' | 'buk' | 'perchance';
export type ExportFormat = 'ccv1' | 'ccv2' | 'buk';

export interface BukImportResult {
  characters: Character[];
  settings?: Partial<AppSettings>;
  promptConfig?: Partial<PromptConfig>;
  lorebooks: LorebookState[];
  sessions: ChatSession[];
  quickCharacters: DBQuickCharacter[];
  groups: GroupChat[];
  skippedCharacters: string[];
}

export interface ImportResult {
  character: Character;
  format: ImportFormat;
}

export interface ExportOptions {
  format: ExportFormat;
  characterIds: string[];
  groupIds: string[];
  includeSettings: boolean;
  includeLorebooks: boolean;
  includeChats: boolean;
}

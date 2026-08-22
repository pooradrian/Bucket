import {Character} from '../CharacterEditor';
import {AppSettings} from '../store';

export type DebuggerLogType = 'input' | 'info' | 'output' | 'error';

export interface DebuggerIO {
  log: (type: DebuggerLogType, text: string) => void;
  clear: () => void;
}

export interface DebuggerEnv {
  characters: Character[];
  appSettings: AppSettings;
  toggleSysStats: () => void;
  enableVerbose: () => void;
  disableVerbose: () => void;
  isVerbose: () => boolean;
}

export type CommandHandler = (
  rest: string[],
  env: DebuggerEnv,
  io: DebuggerIO,
) => Promise<void> | void;

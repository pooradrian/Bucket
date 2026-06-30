import {Character} from './CharacterEditor';

export interface LogEntry {
  id: string;
  type: 'input' | 'output' | 'error' | 'info';
  text: string;
}

export function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ') {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) {
    args.push(current);
  }
  return args;
}

export function findCharacter(characters: Character[], query: string): Character | undefined {
  return (
    characters.find(c => c.id === query) ||
    characters.find(c => c.name.toLowerCase() === query.toLowerCase()) ||
    characters.find(c => c.name.toLowerCase().startsWith(query.toLowerCase()))
  );
}

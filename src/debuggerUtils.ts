import { Character } from './CharacterEditor';

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

export function findCharacter(
  characters: Character[],
  query: string,
): Character | undefined {
  return (
    characters.find(c => c.id === query) ||
    characters.find(c => c.name.toLowerCase() === query.toLowerCase()) ||
    characters.find(c => c.name.toLowerCase().startsWith(query.toLowerCase()))
  );
}

/**
 * Splits parsed args into positionals and `--flag value` pairs. A flag with no
 * value (end of args or followed by another flag) is set to ''. Flag names are
 * lowercased; repeated flags keep the last value.
 */
export function parseFlags(args: string[]): {
  positional: string[];
  flags: Record<string, string>;
} {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--') && a.length > 2) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[a.slice(2).toLowerCase()] = next;
        i++;
      } else {
        flags[a.slice(2).toLowerCase()] = '';
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

import { Character } from '../CharacterEditor';
import { generateId } from '../Database';
import { parseFlags } from '../debuggerUtils';
import { Folder, useAppStore } from '../store';
import { LorebookState } from '../RAGHandler';
import { CommandHandler } from './types';

export const CHAR_EDIT_HELP = [
  'Character Editing:',
  '  char.new <name> [--<field> <value> ...]   Create a character; prints its id',
  '  char.set <id|name> <field> <value>        Change one field',
  '  char.delete <id|exact name>               Delete a character, like the UI does',
  '',
  '  Fields: name, description (desc), personality, scenario,',
  '          first (greeting), examples, writing, folder (name|id|none),',
  '          persona (id|none), lorebooks (comma-separated ids|none)',
  '  Quote values with spaces: char.new Mira --desc "A tired detective"',
].join('\n');

type FieldKey =
  | 'name'
  | 'description'
  | 'personality'
  | 'scenario'
  | 'initialMessage'
  | 'exampleMessages'
  | 'writingStyle'
  | 'folderId'
  | 'personaId'
  | 'lorebookIds';

const FIELD_ALIASES: Record<string, FieldKey> = {
  name: 'name',
  description: 'description',
  desc: 'description',
  personality: 'personality',
  scenario: 'scenario',
  first: 'initialMessage',
  greeting: 'initialMessage',
  initialmessage: 'initialMessage',
  examples: 'exampleMessages',
  examplemessages: 'exampleMessages',
  writing: 'writingStyle',
  writingstyle: 'writingStyle',
  folder: 'folderId',
  persona: 'personaId',
  lorebooks: 'lorebookIds',
};

const CLEAR_WORDS = new Set(['', 'none', '-']);

interface Lookups {
  folders: Folder[];
  lorebooks: LorebookState[];
}

/**
 * Returns a copy of `char` with `field` set to `value`, or an error. Mirrors
 * what the editor stores: trimmed text, custom fields only when non-empty,
 * folder/persona as undefined when cleared.
 */
export function setCharacterField(
  char: Character,
  field: string,
  value: string,
  { folders, lorebooks }: Lookups,
): { char: Character } | { error: string } {
  const key = FIELD_ALIASES[field.toLowerCase()];
  if (!key) {
    return { error: `Unknown field "${field}" (help char)` };
  }
  const v = value.trim();
  const next: Character = { ...char };
  switch (key) {
    case 'name':
      if (!v) return { error: 'name cannot be empty' };
      next.name = v;
      break;
    case 'exampleMessages':
      if (v) next.exampleMessages = v;
      else delete next.exampleMessages;
      break;
    case 'writingStyle': {
      const others = (char.customFields ?? []).filter(
        f => f.id !== 'writingStyle',
      );
      next.customFields = v
        ? [...others, { id: 'writingStyle', value: v }]
        : others;
      break;
    }
    case 'folderId': {
      if (CLEAR_WORDS.has(v.toLowerCase())) {
        next.folderId = undefined;
        break;
      }
      const folder =
        folders.find(f => f.id === v) ??
        folders.find(f => f.name.toLowerCase() === v.toLowerCase());
      if (!folder) return { error: `No folder "${v}"` };
      next.folderId = folder.id;
      break;
    }
    case 'personaId':
      next.personaId = CLEAR_WORDS.has(v.toLowerCase()) ? undefined : v;
      break;
    case 'lorebookIds': {
      if (CLEAR_WORDS.has(v.toLowerCase())) {
        next.lorebookIds = [];
        break;
      }
      const ids = v
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const missing = ids.filter(id => !lorebooks.some(l => l.id === id));
      if (missing.length > 0) {
        return { error: `Unknown lorebook id(s): ${missing.join(', ')}` };
      }
      next.lorebookIds = ids;
      break;
    }
    default:
      next[key] = v;
  }
  return { char: next };
}

/** Exact id, or a unique case-insensitive exact name. No prefix matching. */
export function resolveCharacterExact(
  characters: Character[],
  query: string,
): { char: Character } | { error: string } {
  const byId = characters.find(c => c.id === query);
  if (byId) return { char: byId };
  const byName = characters.filter(
    c => c.name.toLowerCase() === query.toLowerCase(),
  );
  if (byName.length === 1) return { char: byName[0] };
  if (byName.length > 1) {
    return {
      error: `${byName.length} characters are named "${query}"; use an id:\n${byName
        .map(c => `  [${c.id}] ${c.name}`)
        .join('\n')}`,
    };
  }
  return { error: `Character "${query}" not found (exact id or name)` };
}

function lookups(): Lookups {
  const { folders, lorebooks } = useAppStore.getState();
  return { folders, lorebooks };
}

export const charNewCommand: CommandHandler = async (rest, _env, io) => {
  const { positional, flags } = parseFlags(rest);
  const name = positional.join(' ').trim();
  if (!name) {
    io.log('error', 'Usage: char.new <name> [--<field> <value> ...]');
    return;
  }
  let char: Character = {
    id: generateId(),
    name,
    description: '',
    initialMessage: '',
    personality: '',
    scenario: '',
    lorebookIds: [],
    icon: '',
    customFields: [],
  };
  const lk = lookups();
  for (const [field, value] of Object.entries(flags)) {
    const r = setCharacterField(char, field, value, lk);
    if ('error' in r) {
      io.log('error', r.error);
      return;
    }
    char = r.char;
  }
  await useAppStore.getState().saveCharacter(char);
  if (!useAppStore.getState().characters.some(c => c.id === char.id)) {
    io.log('error', 'Save failed (see logcat for the warning)');
    return;
  }
  io.log('output', `Created [${char.id}] ${char.name}`);
};

export const charSetCommand: CommandHandler = async (rest, _env, io) => {
  const [query, field, ...valueParts] = rest;
  if (!query || !field || valueParts.length === 0) {
    io.log('error', 'Usage: char.set <id|name> <field> <value>');
    return;
  }
  const found = resolveCharacterExact(useAppStore.getState().characters, query);
  if ('error' in found) {
    io.log('error', found.error);
    return;
  }
  const r = setCharacterField(
    found.char,
    field,
    valueParts.join(' '),
    lookups(),
  );
  if ('error' in r) {
    io.log('error', r.error);
    return;
  }
  await useAppStore.getState().saveCharacter(r.char);
  io.log('output', `Updated [${r.char.id}] ${r.char.name}: ${field}`);
};

export const charDeleteCommand: CommandHandler = (rest, _env, io) => {
  const query = rest.join(' ').trim();
  if (!query) {
    io.log('error', 'Usage: char.delete <id|exact name>');
    return;
  }
  const store = useAppStore.getState();
  const found = resolveCharacterExact(store.characters, query);
  if ('error' in found) {
    io.log('error', found.error);
    return;
  }
  store.deleteCharacter(found.char.id);
  if (useAppStore.getState().characters.some(c => c.id === found.char.id)) {
    io.log('error', 'Delete failed (see logcat for the warning)');
    return;
  }
  io.log('output', `Deleted [${found.char.id}] ${found.char.name}`);
};

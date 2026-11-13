import { generateId } from '../Database';
import { parseFlags } from '../debuggerUtils';
import { GroupChat, useAppStore } from '../store';
import { resolveCharacterExact } from './charEditCommands';
import { CommandHandler } from './types';

export const GROUP_HELP = [
  'Groups & Folders:',
  '  groups                                    List group chats',
  '  group.new <name> --members <a,b,...>      Create a group (members: ids or exact names)',
  '     [--desc <text>]',
  '  group.delete <id|exact name>              Delete a group chat (same as the UI)',
  '  folders                                   List folders',
  '  folder.new <name>                         Create a folder',
  '  folder.delete <id|exact name>             Delete a folder (its characters move out)',
].join('\n');

/** Exact id, or a unique case-insensitive exact name. */
function resolveExact<T extends { id: string; name: string }>(
  items: T[],
  query: string,
  kind: string,
): { item: T } | { error: string } {
  const byId = items.find(i => i.id === query);
  if (byId) return { item: byId };
  const byName = items.filter(
    i => i.name.toLowerCase() === query.toLowerCase(),
  );
  if (byName.length === 1) return { item: byName[0] };
  if (byName.length > 1) {
    return {
      error: `${byName.length} ${kind}s are named "${query}"; use an id:\n${byName
        .map(i => `  [${i.id}] ${i.name}`)
        .join('\n')}`,
    };
  }
  return { error: `${kind} "${query}" not found (exact id or name)` };
}

export const groupsCommand: CommandHandler = (_rest, _env, io) => {
  const { groupChats, characters } = useAppStore.getState();
  if (groupChats.length === 0) {
    io.log('info', 'No group chats.');
    return;
  }
  const nameOf = (id: string) =>
    characters.find(c => c.id === id)?.name ?? `?${id}`;
  io.log(
    'output',
    `Groups (${groupChats.length}):\n${groupChats
      .map(
        g => `  [${g.id}] ${g.name}: ${g.characterIds.map(nameOf).join(', ')}`,
      )
      .join('\n')}`,
  );
};

export const groupNewCommand: CommandHandler = async (rest, _env, io) => {
  const { positional, flags } = parseFlags(rest);
  const name = positional.join(' ').trim();
  const memberQueries = (flags.members ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (!name || memberQueries.length === 0) {
    io.log(
      'error',
      'Usage: group.new <name> --members <a,b,...> [--desc <text>]',
    );
    return;
  }
  const { characters } = useAppStore.getState();
  const ids: string[] = [];
  for (const q of memberQueries) {
    const r = resolveCharacterExact(characters, q);
    if ('error' in r) {
      io.log('error', r.error);
      return;
    }
    if (!ids.includes(r.char.id)) ids.push(r.char.id);
  }
  const group: GroupChat = {
    id: generateId(),
    name,
    description: (flags.desc ?? flags.description ?? '').trim(),
    characterIds: ids,
  };
  await useAppStore.getState().saveGroupChat(group);
  if (!useAppStore.getState().groupChats.some(g => g.id === group.id)) {
    io.log('error', 'Save failed (see logcat for the warning)');
    return;
  }
  io.log('output', `Created group [${group.id}] ${group.name}`);
};

export const groupDeleteCommand: CommandHandler = (rest, _env, io) => {
  const query = rest.join(' ').trim();
  if (!query) {
    io.log('error', 'Usage: group.delete <id|exact name>');
    return;
  }
  const store = useAppStore.getState();
  const r = resolveExact(store.groupChats, query, 'Group');
  if ('error' in r) {
    io.log('error', r.error);
    return;
  }
  store.deleteGroupChat(r.item.id);
  io.log('output', `Deleted group [${r.item.id}] ${r.item.name}`);
};

export const foldersCommand: CommandHandler = (_rest, _env, io) => {
  const { folders, characters } = useAppStore.getState();
  if (folders.length === 0) {
    io.log('info', 'No folders.');
    return;
  }
  io.log(
    'output',
    `Folders (${folders.length}):\n${folders
      .map(
        f =>
          `  [${f.id}] ${f.name} (${characters.filter(c => c.folderId === f.id).length} characters)`,
      )
      .join('\n')}`,
  );
};

export const folderNewCommand: CommandHandler = (rest, _env, io) => {
  const name = rest.join(' ').trim();
  if (!name) {
    io.log('error', 'Usage: folder.new <name>');
    return;
  }
  const folder = { id: generateId(), name };
  useAppStore.getState().saveFolder(folder);
  if (!useAppStore.getState().folders.some(f => f.id === folder.id)) {
    io.log('error', 'Save failed (see logcat for the warning)');
    return;
  }
  io.log('output', `Created folder [${folder.id}] ${folder.name}`);
};

export const folderDeleteCommand: CommandHandler = (rest, _env, io) => {
  const query = rest.join(' ').trim();
  if (!query) {
    io.log('error', 'Usage: folder.delete <id|exact name>');
    return;
  }
  const store = useAppStore.getState();
  const r = resolveExact(store.folders, query, 'Folder');
  if ('error' in r) {
    io.log('error', r.error);
    return;
  }
  store.deleteFolder(r.item.id);
  io.log('output', `Deleted folder [${r.item.id}] ${r.item.name}`);
};

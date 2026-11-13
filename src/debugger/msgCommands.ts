import {
  addMessage,
  createSession,
  generateId,
  getSessionForCharacter,
  updateSessionTimestamp,
} from '../Database';
import {
  notifySessionChanged,
  notifySessionCreated,
} from '../GenerationEngine';
import { ChatMessage, ChatSession } from '../useChat';
import { useAppStore } from '../store';
import { resolveCharacterExact } from './charEditCommands';
import { CommandHandler } from './types';

export const MSG_HELP = [
  'Message Commands:',
  '  msg.add <char id|name> <user|assistant> <text>',
  "      Append a message to the character's latest chat (no LLM call).",
  "      With no saved chat yet, starts one with the character's first",
  '      message, like the UI. An open chat for it reloads automatically.',
].join('\n');

const ROLES: Record<string, ChatMessage['role']> = {
  user: 'user',
  u: 'user',
  assistant: 'assistant',
  a: 'assistant',
  char: 'assistant',
  bot: 'assistant',
};

export const msgAddCommand: CommandHandler = async (rest, _env, io) => {
  const [query, roleArg, ...textParts] = rest;
  const role = roleArg ? ROLES[roleArg.toLowerCase()] : undefined;
  const text = textParts.join(' ');
  if (!query || !role || !text.trim()) {
    io.log('error', 'Usage: msg.add <char id|name> <user|assistant> <text>');
    return;
  }
  const found = resolveCharacterExact(useAppStore.getState().characters, query);
  if ('error' in found) {
    io.log('error', found.error);
    return;
  }
  const { char } = found;
  const now = Date.now();
  const message: ChatMessage = {
    id: generateId(),
    role,
    content: text,
    timestamp: now,
    ...(role === 'assistant' ? { characterId: char.id } : {}),
  };

  const existing = await getSessionForCharacter(char.id);
  if (existing) {
    await addMessage(existing.id, message);
    updateSessionTimestamp(existing.id, now);
    notifySessionChanged(existing.id);
    io.log(
      'output',
      `Added ${role} message to ${char.name} (session ${existing.id}, ${existing.messages.length + 1} messages)`,
    );
    return;
  }

  const messages: ChatMessage[] = char.initialMessage
    ? [
        {
          id: generateId(),
          role: 'assistant',
          content: char.initialMessage,
          timestamp: now - 1,
        },
        message,
      ]
    : [message];
  const session: ChatSession = {
    id: generateId(),
    characterId: char.id,
    messages,
    createdAt: now,
    updatedAt: now,
  };
  await createSession(session);
  notifySessionCreated(char.id, session.id);
  io.log(
    'output',
    `Started a chat for ${char.name} (session ${session.id}, ${messages.length} messages)`,
  );
};

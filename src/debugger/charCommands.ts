import {ChatMessage} from '../useChat';
import {
  buildPrompt,
  sendToLLM,
  loadPromptConfig,
} from '../PromptHandler';
import {
  getAllSessionsForCharacter,
  getSessionForCharacter,
  getAllLorebooksFromDB,
} from '../Database';
import {findCharacter} from '../debuggerUtils';
import {getCustomField} from '../CustomFields';
import {CommandHandler} from './types';

export const charsCommand: CommandHandler = (rest, env, io) => {
  const {characters} = env;
  if (characters.length === 0) {
    io.log('info', 'No characters found.');
  } else {
    const lines = characters.map(
      c => `  [${c.id}] ${c.name}${c.description ? ' - ' + c.description.slice(0, 60) : ''}`,
    );
    io.log('output', `Characters (${characters.length}):\n${lines.join('\n')}`);
  }
};

export const charCommand: CommandHandler = async (rest, env, io) => {
  const query = rest[0];
  if (!query) {
    io.log('error', 'Usage: char <id|name>');
    return;
  }
  const char = findCharacter(env.characters, query);
  if (!char) {
    io.log('error', `Character "${query}" not found.`);
    return;
  }
  const sessions = getAllSessionsForCharacter(char.id);
  const lorebooks = await getAllLorebooksFromDB();
  const assignedLorebooks = lorebooks.filter(l => (char.lorebookIds || []).includes(l.id));
  io.log(
    'output',
    [
      `ID:          ${char.id}`,
      `Name:        ${char.name}`,
      `Description: ${char.description || '(none)'}`,
      `Personality: ${char.personality || '(none)'}`,
      `Writing:     ${getCustomField(char, 'writingStyle') || '(none)'}`,
      `Scenario:    ${char.scenario || '(none)'}`,
      `First Msg:   ${char.initialMessage || '(none)'}`,
      `Examples:    ${char.exampleMessages ? char.exampleMessages.slice(0, 80) + (char.exampleMessages.length > 80 ? '...' : '') : '(none)'}`,
      `Lorebooks:   ${assignedLorebooks.length > 0 ? assignedLorebooks.map(l => `${l.fileName} (${l.entryCount} entries)`).join(', ') : '(none)'}`,
      `Sessions:    ${sessions.length}`,
      `Last Active: ${sessions.length > 0 ? new Date(sessions[0].updatedAt).toLocaleString() : 'never'}`,
    ].join('\n'),
  );
};

export const promptCommand: CommandHandler = async (rest, env, io) => {
  const query = rest[0];
  const message = rest.slice(1).join(' ');
  if (!query || !message) {
    io.log('error', 'Usage: prompt <id|name> <message>');
    return;
  }
  const char = findCharacter(env.characters, query);
  if (!char) {
    io.log('error', `Character "${query}" not found.`);
    return;
  }
  const config = await loadPromptConfig();
  const history: ChatMessage[] = [];
  const t0 = performance.now();
  const messages = buildPrompt(char, message, history, config);
  const buildMs = (performance.now() - t0).toFixed(1);
  io.log('output', `${JSON.stringify(messages, null, 2)}\n\nPrompt built in ${buildMs}ms`);
};

export const sendCommand: CommandHandler = async (rest, env, io) => {
  const query = rest[0];
  const message = rest.slice(1).join(' ');
  if (!query || !message) {
    io.log('error', 'Usage: send <id|name> <message>');
    return;
  }
  const char = findCharacter(env.characters, query);
  if (!char) {
    io.log('error', `Character "${query}" not found.`);
    return;
  }
  io.log('info', 'Sending to LLM...');
  const config = await loadPromptConfig();
  let history: ChatMessage[] = [];
  try {
    const session = await getSessionForCharacter(char.id);
    if (session) {
      history = session.messages;
    }
  } catch {
    // history load failed, use empty
  }
  const result = await sendToLLM(char, message, history, config);
  const m = result.metrics;
  io.log('output', [
    '\u2500'.repeat(40),
    result.content,
    '\u2500'.repeat(40),
    `  Prompt build:  ${m.promptBuildMs.toFixed(1)}ms`,
    `  TTFB (ack):    ${m.ttfbMs.toFixed(1)}ms`,
    `  Body read:     ${m.bodyReadMs.toFixed(1)}ms`,
    `  Total:         ${m.totalMs.toFixed(1)}ms`,
  ].join('\n'));
};

export const historyCommand: CommandHandler = async (rest, env, io) => {
  const query = rest[0];
  if (!query) {
    io.log('error', 'Usage: history <id|name>');
    return;
  }
  const char = findCharacter(env.characters, query);
  if (!char) {
    io.log('error', `Character "${query}" not found.`);
    return;
  }
  try {
    const session = await getSessionForCharacter(char.id);
    if (!session || session.messages.length === 0) {
      io.log('info', 'No chat history for this character.');
    } else {
      const lines = session.messages.map(
        (m: {role: string; content: string}) => `[${m.role}] ${m.content.slice(0, 120)}${m.content.length > 120 ? '...' : ''}`,
      );
      io.log('output', `History for ${char.name} (${session.messages.length} messages):\n${lines.join('\n')}`);
    }
  } catch (e) {
    io.log('error', `Failed to load history: ${e}`);
  }
};

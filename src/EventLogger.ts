import RNFS from 'react-native-fs';
import {getKV, setKV} from './Database';

const EVENTS_KEY = 'activity_log';
const MAX_MEMORY_EVENTS = 50;
const PERSIST_BATCH_SIZE = 20;

const LOG_FILE = `${RNFS.DocumentDirectoryPath}/event_log.txt`;
const MAX_LOG_FILE_SIZE = 512 * 1024;
const TRUNC_CHECK_INTERVAL = 100;

export interface ActivityEvent {
  id: string;
  type: string;
  timestamp: number;
  stats: Record<string, number | string | boolean>;
  summary: string;
}

interface PersistedLog {
  events: Array<{
    id: string;
    type: string;
    timestamp: number;
    stats: Record<string, number | string | boolean>;
    summary: string;
  }>;
}

let memoryEvents: ActivityEvent[] = [];
let pendingPersist: ActivityEvent[] = [];
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let enabled = false;

const originalConsoleWarn = console.warn.bind(console);
const originalConsoleError = console.error.bind(console);

function extractErrorInfo(args: unknown[]): {errorMsg: string; errorName: string; errorStack: string; fullMsg: string} {
  let errorMsg = '';
  let errorName = '';
  let errorStack = '';
  const stringParts: string[] = [];

  for (const a of args) {
    if (a instanceof Error) {
      errorMsg = a.message || '';
      errorName = a.name || 'Error';
      errorStack = a.stack || '';
      stringParts.push(`${errorName}: ${errorMsg}`);
    } else if (typeof a === 'object' && a !== null) {
      try {
        stringParts.push(JSON.stringify(a));
      } catch {
        stringParts.push(String(a));
      }
    } else {
      stringParts.push(String(a));
    }
  }

  const fullMsg = stringParts.join(' ');
  if (!errorMsg) {
    errorMsg = fullMsg;
  }

  return {errorMsg, errorName, errorStack, fullMsg};
}

function overrideWarn(...args: unknown[]): void {
  originalConsoleWarn(...args);
  if (!enabled) return;
  const info = extractErrorInfo(args);
  logEvent('runtime_warn', {
    errorName: info.errorName || 'Warning',
    errorMsg: info.errorMsg,
    errorStack: info.errorStack,
    fullMsg: info.fullMsg,
    msgLen: info.fullMsg.length,
  });
}

function overrideError(...args: unknown[]): void {
  originalConsoleError(...args);
  if (!enabled) return;
  const info = extractErrorInfo(args);
  logEvent('runtime_error', {
    errorName: info.errorName || 'Error',
    errorMsg: info.errorMsg,
    errorStack: info.errorStack,
    fullMsg: info.fullMsg,
    msgLen: info.fullMsg.length,
  });
}

export function setLoggingEnabled(on: boolean): void {
  if (on === enabled) return;
  enabled = on;
  if (on) {
    console.warn = overrideWarn;
    console.error = overrideError;
  } else {
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  }
}

export function isLoggingEnabled(): boolean {
  return enabled;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

let writeCount = 0;
let initialTruncDone = false;

function truncateLogFileIfNeeded(): void {
  RNFS.stat(LOG_FILE)
    .then(stat => {
      if ((stat as any).size <= MAX_LOG_FILE_SIZE) return;
      const keepBytes = Math.floor(MAX_LOG_FILE_SIZE / 3);
      return RNFS.readFile(LOG_FILE, 'utf8').then(content => {
        const truncated = content.slice(-keepBytes);
        const nlIdx = truncated.indexOf('\n');
        const clean = nlIdx >= 0 ? truncated.slice(nlIdx + 1) : truncated;
        return RNFS.writeFile(LOG_FILE, clean, 'utf8');
      });
    })
    .catch(() => {});
}

function appendToLogFile(event: ActivityEvent): void {
  if (!initialTruncDone) {
    initialTruncDone = true;
    truncateLogFileIfNeeded();
  }

  try {
    const line = JSON.stringify({
      id: event.id,
      type: event.type,
      timestamp: event.timestamp,
      stats: event.stats,
      summary: event.summary,
    }) + '\n';
    RNFS.appendFile(LOG_FILE, line, 'utf8').catch(() => {});
  } catch {}

  writeCount++;
  if (writeCount % TRUNC_CHECK_INTERVAL === 0) {
    truncateLogFileIfNeeded();
  }
}

export async function readLogFile(): Promise<string> {
  try {
    return await RNFS.readFile(LOG_FILE, 'utf8');
  } catch {
    return '';
  }
}

function buildSummary(type: string, stats: Record<string, number | string | boolean>): string {
  switch (type) {
    case 'character_saved': {
      const fields: string[] = [];
      if (stats.nameLen) fields.push(`name(${stats.nameLen}c)`);
      if (stats.descLen) fields.push(`desc(${stats.descLen}c)`);
      if (stats.hasPersonality) fields.push('personality');
      if (stats.hasInitialMsg) fields.push('greeting');
      if (stats.hasWritingStyle) fields.push('style');
      if (stats.hasScenario) fields.push('scenario');
      if (stats.hasExamples) fields.push('examples');
      if (stats.lorebookCount) fields.push(`${stats.lorebookCount} lorebooks`);
      if (stats.iconSize) fields.push(`icon(${stats.iconSize} chars)`);
      const action = stats.isNew ? 'Created' : 'Saved';
      return `${action} character [${fields.join(', ')}]`;
    }
    case 'character_deleted':
      return `Deleted character [name(${stats.nameLen}c)]`;
    case 'message_sent':
      return `Sent message [${stats.charCount} chars, session has ${stats.sessionMsgCount} msgs${stats.isGroupChat ? ', group' : ''}${stats.isQC ? ', QC persona' : ''}]`;
    case 'message_streamed': {
      const dur = typeof stats.durationMs === 'number' ? `${stats.durationMs}ms` : '?ms';
      return `Streamed ${stats.charCount} chars in ${dur} [session: ${stats.sessionMsgCount} msgs]`;
    }
    case 'message_edited':
      return `Edited message [${stats.oldCharCount}→${stats.newCharCount} chars]`;
    case 'message_deleted':
      return `Deleted message [${stats.charCount} chars]`;
    case 'message_regenerated':
      return `Regenerated last response [session: ${stats.sessionMsgCount} msgs]`;
    case 'qc_created':
      return `Created quick character [name(${stats.nameLen}c)${stats.descLen ? `, desc(${stats.descLen}c)` : ''}${stats.hasPersonality ? ', personality' : ''}]`;
    case 'qc_starred':
      return `Starred quick character "${stats.nameLen}c name" → saved to character`;
    case 'qc_unstarred':
      return `Unstarred quick character [name(${stats.nameLen}c)]`;
    case 'qc_deleted':
      return `Deleted quick character [name(${stats.nameLen}c)]`;
    case 'group_saved': {
      const fields: string[] = [];
      if (stats.nameLen) fields.push(`name(${stats.nameLen}c)`);
      if (stats.memberCount) fields.push(`${stats.memberCount} members`);
      if (stats.descLen) fields.push(`desc(${stats.descLen}c)`);
      const action = stats.isNew ? 'Created' : 'Saved';
      return `${action} group chat [${fields.join(', ')}]`;
    }
    case 'group_deleted':
      return `Deleted group chat [name(${stats.nameLen}c), ${stats.memberCount} members]`;
    case 'chat_converted_to_group':
      return `Converted chat to group [${stats.memberCount} members]`;
    case 'lorebook_imported':
      return `Imported lorebook [${stats.entryCount} entries, name(${stats.fileNameLen}c)]`;
    case 'lorebook_removed':
      return `Removed lorebook [${stats.entryCount} entries, name(${stats.fileNameLen}c)]`;
    case 'session_switched':
      return `Switched session [${stats.msgCount} msgs]`;
    case 'session_deleted':
      return `Deleted session [${stats.msgCount} msgs]`;
    case 'session_created':
      return `Created new session${stats.msgCount ? ` [${stats.msgCount} init msgs]` : ''}`;
    case 'settings_changed':
      return `Changed ${stats.changedKeys} settings`;
    case 'theme_imported':
      return `Imported theme${stats.themeName ? ` "${stats.themeName}"` : ''}`;
    case 'theme_shared':
      return 'Shared theme via URL';
    case 'api_request':
      return `API ${stats.method} [${stats.urlHost}${stats.urlPathLen ? `/${'x'.repeat(Math.min(Number(stats.urlPathLen), 20))}` : ''}] → ${stats.statusCode || '???'} (${stats.durationMs}ms)`;
    case 'prompt_config_saved':
      return `Saved prompt config [${stats.changedKeys} fields]`;
    case 'provider_added':
      return `Added provider "${stats.providerName}" [url(${stats.urlLen}c)]`;
    case 'provider_removed':
      return `Removed provider "${stats.providerName}"`;
    case 'provider_switched':
      return `Switched to provider "${stats.providerName}"`;
    case 'character_imported':
      return `Imported character from ${stats.source || 'file'} [name(${stats.nameLen}c), desc(${stats.descLen}c)]`;
    case 'runtime_warn': {
      const wName = (stats.errorName as string) || 'Warning';
      const wMsg = typeof stats.errorMsg === 'string' && stats.errorMsg ? (stats.errorMsg as string).slice(0, 120) : '';
      if (!wMsg) {
        const fallback = typeof stats.fullMsg === 'string' ? (stats.fullMsg as string).slice(0, 120) : '';
        return fallback ? `${wName}: ${fallback}` : wName;
      }
      return `${wName}: ${wMsg}`;
    }
    case 'runtime_error': {
      const eName = (stats.errorName as string) || 'Error';
      const eMsg = typeof stats.errorMsg === 'string' && stats.errorMsg ? (stats.errorMsg as string).slice(0, 200) : '';
      const hasStack = typeof stats.errorStack === 'string' && (stats.errorStack as string).length > 0;
      if (!eMsg) {
        const fallback = typeof stats.fullMsg === 'string' ? (stats.fullMsg as string).slice(0, 200) : '';
        return `${eName}${fallback ? `: ${fallback}` : ''}${hasStack ? ' (+stack)' : ''}`;
      }
      return `${eName}: ${eMsg}${hasStack ? ' (+stack)' : ''}`;
    }
    case 'fatal_error': {
      const fName = (stats.errorName as string) || 'Error';
      const fMsg = typeof stats.errorMsg === 'string' && stats.errorMsg ? (stats.errorMsg as string).slice(0, 200) : '';
      const fStack = typeof stats.errorStack === 'string' && (stats.errorStack as string).length > 0;
      return `FATAL ${fName}${fMsg ? `: ${fMsg}` : ''}${fStack ? ' (+stack)' : ''}`;
    }
    default:
      return `${type} [${Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(', ')}]`;
  }
}

function flushPersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (pendingPersist.length === 0) return;

  try {
    const stored = getKV(EVENTS_KEY);
    let existing: PersistedLog = {events: []};
    if (stored) {
      existing = JSON.parse(stored);
    }
    const merged = [...existing.events, ...pendingPersist.map(e => ({
      id: e.id,
      type: e.type,
      timestamp: e.timestamp,
      stats: e.stats,
      summary: e.summary,
    }))].slice(-MAX_MEMORY_EVENTS);
    setKV(EVENTS_KEY, JSON.stringify({events: merged}));
  } catch {
  }

  for (const e of pendingPersist) {
    const isError = e.type === 'runtime_error' || e.type === 'runtime_warn' || e.type === 'fatal_error';
    if (!isError) {
      appendToLogFile(e);
    }
  }

  pendingPersist = [];
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(flushPersist, 2000);
}

export function logEvent(
  type: string,
  stats: Record<string, number | string | boolean> = {},
): void {
  if (!enabled) return;

  const event: ActivityEvent = {
    id: generateId(),
    type,
    timestamp: Date.now(),
    stats,
    summary: buildSummary(type, stats),
  };

  memoryEvents.push(event);
  if (memoryEvents.length > MAX_MEMORY_EVENTS) {
    memoryEvents = memoryEvents.slice(-MAX_MEMORY_EVENTS);
  }

  pendingPersist.push(event);
  if (pendingPersist.length >= PERSIST_BATCH_SIZE) {
    flushPersist();
  } else {
    schedulePersist();
  }

  const isError = type === 'runtime_error' || type === 'runtime_warn' || type === 'fatal_error';
  if (isError) {
    appendToLogFile(event);
  }
}

export function getEvents(limit: number = 50): ActivityEvent[] {
  return memoryEvents.slice(-limit).reverse();
}

export function loadPersistedEvents(): ActivityEvent[] {
  try {
    const stored = getKV(EVENTS_KEY);
    if (!stored) return [];
    const parsed: PersistedLog = JSON.parse(stored);
    return parsed.events.map(e => ({
      ...e,
      summary: buildSummary(e.type, e.stats),
    }));
  } catch {
    return [];
  }
}

export function clearEvents(): void {
  memoryEvents = [];
  pendingPersist = [];
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  setKV(EVENTS_KEY, JSON.stringify({events: []}));
}

export function shutdown(): void {
  flushPersist();
}

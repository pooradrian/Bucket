import {getKV, setKV} from './Database';

const EVENTS_KEY = 'activity_log';
const MAX_MEMORY_EVENTS = 50;
const PERSIST_BATCH_SIZE = 20;

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

function overrideWarn(...args: unknown[]): void {
  originalConsoleWarn(...args);
  if (!enabled) return;
  const msg = args.map(a => (a instanceof Error ? a.message : String(a))).join(' ');
  logEvent('runtime_warn', {msgLen: msg.length});
}

function overrideError(...args: unknown[]): void {
  originalConsoleError(...args);
  if (!enabled) return;
  const msg = args.map(a => (a instanceof Error ? a.message : String(a))).join(' ');
  logEvent('runtime_error', {msgLen: msg.length});
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
    case 'runtime_warn':
      return `Warning [${stats.msgLen}c msg]`;
    case 'runtime_error':
      return `Runtime error [${stats.msgLen}c msg]`;
    case 'fatal_error':
      return `FATAL: ${stats.errorName || 'Error'} [${stats.msgLen}c msg]`;
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
      summary: e.summary || buildSummary(e.type, e.stats),
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

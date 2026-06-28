import {open, NitroSQLiteConnection} from 'react-native-nitro-sqlite';
import {ChatSession, ChatMessage} from './useChat';
import {encrypt, decrypt} from './Crypto';
import {LorebookEntry, LorebookState} from './RAGHandler';

const DB_NAME = 'bucket';
const CURRENT_VERSION = 3;

let db: NitroSQLiteConnection | null = null;

interface GlobalWithCrypto {
  crypto?: {
    randomUUID?: () => string;
  };
}

export function generateId(): string {
  try {
    const c = globalThis as GlobalWithCrypto;
    if (typeof c.crypto?.randomUUID === 'function') {
      return c.crypto.randomUUID();
    }
  } catch {}
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function tableColumns(conn: NitroSQLiteConnection, table: string): Set<string> {
  const result = conn.execute(`PRAGMA table_info(${table})`);
  const columns = new Set<string>();
  for (const row of result.results || []) {
    const name = row.name as string;
    if (name) {
      columns.add(name);
    }
  }
  return columns;
}

function addColumnIfMissing(
  conn: NitroSQLiteConnection,
  table: string,
  column: string,
  definition: string,
) {
  if (!tableColumns(conn, table).has(column)) {
    conn.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrate(conn: NitroSQLiteConnection, from: number, to: number) {
  for (let v = from + 1; v <= to; v++) {
    conn.execute('BEGIN');
    try {
      if (v === 1) {
        conn.execute(`
          CREATE TABLE IF NOT EXISTS chat_sessions (
            id TEXT PRIMARY KEY NOT NULL,
            character_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `);
        conn.execute(`
          CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
          )
        `);
        conn.execute(`
          CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
          )
        `);
        conn.execute(`
          CREATE TABLE IF NOT EXISTS lorebooks (
            id TEXT PRIMARY KEY NOT NULL,
            file_name TEXT NOT NULL
          )
        `);
        conn.execute(`
          CREATE TABLE IF NOT EXISTS lorebook_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lorebook_id TEXT NOT NULL,
            entry_index INTEGER NOT NULL,
            text TEXT NOT NULL,
            FOREIGN KEY (lorebook_id) REFERENCES lorebooks(id) ON DELETE CASCADE
          )
        `);
        conn.execute('CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id)');
        conn.execute('CREATE INDEX IF NOT EXISTS idx_sessions_character ON chat_sessions(character_id)');
        conn.execute('CREATE INDEX IF NOT EXISTS idx_lorebook_entries_lorebook ON lorebook_entries(lorebook_id)');
      }

      if (v === 2) {
        conn.execute(`
          CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            initial_message TEXT DEFAULT '',
            writing_style TEXT DEFAULT '',
            personality TEXT DEFAULT '',
            scenario TEXT DEFAULT '',
            example_messages TEXT DEFAULT '',
            icon TEXT DEFAULT '',
            lorebook_id TEXT DEFAULT ''
          )
        `);
        conn.execute('CREATE INDEX IF NOT EXISTS idx_characters_name ON characters(name)');
      }

      if (v === 3) {
        conn.execute(`
          CREATE TABLE IF NOT EXISTS group_chats (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            icon TEXT DEFAULT ''
          )
        `);
        conn.execute(`
          CREATE TABLE IF NOT EXISTS group_chat_members (
            group_chat_id TEXT NOT NULL,
            character_id TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (group_chat_id, character_id),
            FOREIGN KEY (group_chat_id) REFERENCES group_chats(id) ON DELETE CASCADE,
            FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
          )
        `);
        conn.execute('CREATE INDEX IF NOT EXISTS idx_group_chat_members_group ON group_chat_members(group_chat_id)');
        addColumnIfMissing(conn, 'chat_sessions', 'group_chat_id', 'TEXT DEFAULT ""');
        addColumnIfMissing(conn, 'chat_sessions', 'last_reply_character_id', 'TEXT DEFAULT ""');
      }

      conn.execute(`PRAGMA user_version = ${v}`);
      conn.execute('COMMIT');
    } catch (e) {
      conn.execute('ROLLBACK');
      throw e;
    }
  }
}

export function initDB(): NitroSQLiteConnection {
  if (db) {
    return db;
  }

  db = open({name: DB_NAME});

  db.execute('PRAGMA foreign_keys = ON');
  db.execute('PRAGMA journal_mode = WAL');

  const versionResult = db.execute('PRAGMA user_version');
  const currentVersion = (versionResult.results?.[0]?.user_version as number) ?? 0;

  if (currentVersion < CURRENT_VERSION) {
    migrate(db, currentVersion, CURRENT_VERSION);
  }

  return db;
}

async function decryptMessages(messages: ChatMessage[]): Promise<ChatMessage[]> {
  return Promise.all(
    messages.map(async msg => ({
      ...msg,
      content: await decrypt(msg.content),
    }))
  );
}

export async function getSessionForCharacter(characterId: string): Promise<ChatSession | null> {
  const d = initDB();

  const sessionResult = d.execute(
    'SELECT id, character_id, created_at, updated_at FROM chat_sessions WHERE character_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1',
    [characterId],
  );

  if (!sessionResult.results || sessionResult.results.length === 0) {
    return null;
  }

  const row = sessionResult.results[0];
  const sessionId = row.id as string;

  const messagesResult = d.execute(
    'SELECT id, role, content, timestamp FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC',
    [sessionId],
  );

  let messages: ChatMessage[] = [];
  if (messagesResult.results) {
    messages = await decryptMessages(
      messagesResult.results.map(msg => ({
        id: msg.id as string,
        role: msg.role as 'user' | 'assistant',
        content: msg.content as string,
        timestamp: msg.timestamp as number,
      }))
    );
  }

  return {
    id: row.id as string,
    characterId: row.character_id as string,
    messages,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export async function createSession(session: ChatSession): Promise<void> {
  const d = initDB();

  d.execute('BEGIN');
  try {
    d.execute(
      'INSERT INTO chat_sessions (id, character_id, group_chat_id, last_reply_character_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [session.id, session.characterId, session.groupChatId || '', session.lastReplyCharacterId || '', session.createdAt, session.updatedAt],
    );

    for (const msg of session.messages) {
      const encryptedContent = await encrypt(msg.content);
      d.execute(
        'INSERT INTO chat_messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
        [msg.id, session.id, msg.role, encryptedContent, msg.timestamp],
      );
    }
    d.execute('COMMIT');
  } catch (e) {
    d.execute('ROLLBACK');
    throw e;
  }
}

export function updateSessionTimestamp(sessionId: string, updatedAt: number): void {
  const d = initDB();
  d.execute('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', [updatedAt, sessionId]);
}

export function setLastReplyCharacterId(sessionId: string, characterId: string): void {
  const d = initDB();
  d.execute('UPDATE chat_sessions SET last_reply_character_id = ? WHERE id = ?', [characterId, sessionId]);
}

export async function addMessage(sessionId: string, message: ChatMessage): Promise<void> {
  const d = initDB();
  const encryptedContent = await encrypt(message.content);
  d.execute(
    'INSERT INTO chat_messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
    [message.id, sessionId, message.role, encryptedContent, message.timestamp],
  );
}

export interface SessionSummary {
  id: string;
  characterId: string;
  groupChatId?: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export function getAllSessionsForCharacter(characterId: string): SessionSummary[] {
  const d = initDB();
  const result = d.execute(
    `SELECT s.id, s.character_id, s.created_at, s.updated_at,
       COUNT(m.id) as message_count
     FROM chat_sessions s
     LEFT JOIN chat_messages m ON m.session_id = s.id
     WHERE s.character_id = ?
     GROUP BY s.id
     ORDER BY s.updated_at DESC`,
    [characterId],
  );
  if (!result.results) {
    return [];
  }
  return result.results.map(row => ({
    id: row.id as string,
    characterId: row.character_id as string,
    messageCount: row.message_count as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }));
}

export async function getSessionById(sessionId: string): Promise<ChatSession | null> {
  const d = initDB();
  const sessionResult = d.execute(
    'SELECT id, character_id, group_chat_id, last_reply_character_id, created_at, updated_at FROM chat_sessions WHERE id = ?',
    [sessionId],
  );
  if (!sessionResult.results || sessionResult.results.length === 0) {
    return null;
  }
  const row = sessionResult.results[0];
  const messagesResult = d.execute(
    'SELECT id, role, content, timestamp FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC',
    [sessionId],
  );
  let messages: ChatMessage[] = [];
  if (messagesResult.results) {
    messages = await decryptMessages(
      messagesResult.results.map(msg => ({
        id: msg.id as string,
        role: msg.role as 'user' | 'assistant',
        content: msg.content as string,
        timestamp: msg.timestamp as number,
      }))
    );
  }
  return {
    id: row.id as string,
    characterId: row.character_id as string,
    groupChatId: (row.group_chat_id as string) || undefined,
    lastReplyCharacterId: (row.last_reply_character_id as string) || undefined,
    messages,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export function deleteSession(sessionId: string): void {
  const d = initDB();
  d.execute('DELETE FROM chat_sessions WHERE id = ?', [sessionId]);
}

export async function updateMessage(messageId: string, content: string): Promise<void> {
  const d = initDB();
  const encryptedContent = await encrypt(content);
  d.execute('UPDATE chat_messages SET content = ? WHERE id = ?', [encryptedContent, messageId]);
}

export function deleteMessage(messageId: string): void {
  const d = initDB();
  d.execute('DELETE FROM chat_messages WHERE id = ?', [messageId]);
}

export function getDbConnection(): NitroSQLiteConnection {
  return initDB();
}

export function getDBInfo(): {sessionCount: number; messageCount: number} {
  const d = initDB();
  const sessions = d.execute('SELECT COUNT(*) as count FROM chat_sessions');
  const messages = d.execute('SELECT COUNT(*) as count FROM chat_messages');
  return {
    sessionCount: sessions.results?.[0]?.count as number ?? 0,
    messageCount: messages.results?.[0]?.count as number ?? 0,
  };
}

export interface MessageSearchResult {
  sessionId: string;
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

const SEARCH_PAGE_SIZE = 500;
const SEARCH_MAX_RESULTS = 200;

/**
 * Full-text search across all chat messages.
 *
 * Message content is encrypted at rest, so we cannot filter with a SQL `LIKE`.
 * Instead we page through every row in deterministic order, decrypt each page,
 * and filter in JS. Scanning is bounded by `SEARCH_MAX_RESULTS` matches, but we
 * no longer silently look at only the first 200 arbitrary rows.
 */
export async function searchMessages(query: string): Promise<MessageSearchResult[]> {
  const d = initDB();
  const needle = query.toLowerCase();
  if (!needle) {
    return [];
  }

  const matches: MessageSearchResult[] = [];
  let offset = 0;

  for (;;) {
    const result = d.execute(
      'SELECT session_id, id, role, content, timestamp FROM chat_messages ORDER BY timestamp DESC, id ASC LIMIT ? OFFSET ?',
      [SEARCH_PAGE_SIZE, offset],
    );
    const rows = result.results;
    if (!rows || rows.length === 0) {
      break;
    }

    const decrypted = await Promise.all(
      rows.map(async row => ({
        sessionId: row.session_id as string,
        id: row.id as string,
        role: row.role as string,
        content: await decrypt(row.content as string),
        timestamp: row.timestamp as number,
      }))
    );

    for (const msg of decrypted) {
      if (msg.content.toLowerCase().includes(needle)) {
        matches.push(msg);
        if (matches.length >= SEARCH_MAX_RESULTS) {
          return matches;
        }
      }
    }

    if (rows.length < SEARCH_PAGE_SIZE) {
      break;
    }
    offset += SEARCH_PAGE_SIZE;
  }

  return matches;
}

/**
 * Deletes all sessions and messages whose ids share a given prefix.
 *
 * This is a debug/stress-test helper only: the debugger creates throwaway
 * sessions and messages whose ids are deliberately constructed with a known
 * prefix (e.g. `_stress_`). Real ids are `crypto.randomUUID()` and never start
 * with such a prefix, so this cannot match real data. We match messages on both
 * their own id prefix and their session id prefix so no stress rows are left
 * orphaned.
 */
export function deleteAllByPrefix(prefix: string): {sessions: number; messages: number} {
  const d = initDB();
  const like = `${prefix}%`;
  const msgResult = d.execute(
    'DELETE FROM chat_messages WHERE id LIKE ? OR session_id LIKE ?',
    [like, like],
  );
  const sessResult = d.execute('DELETE FROM chat_sessions WHERE id LIKE ?', [like]);
  return {
    sessions: sessResult.rowsAffected ?? 0,
    messages: msgResult.rowsAffected ?? 0,
  };
}

export function getKV(key: string): string | null {
  const d = initDB();
  const result = d.execute('SELECT value FROM kv_store WHERE key = ?', [key]);
  if (!result.results || result.results.length === 0) {
    return null;
  }
  return result.results[0].value as string;
}

export function setKV(key: string, value: string): void {
  const d = initDB();
  d.execute('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)', [key, value]);
}

export function getAllKVKeys(): string[] {
  const d = initDB();
  const result = d.execute('SELECT key FROM kv_store ORDER BY key');
  if (!result.results) {
    return [];
  }
  return result.results.map(row => row.key as string);
}

export async function saveLorebookToDB(lorebook: LorebookState): Promise<void> {
  const d = initDB();
  d.execute('INSERT OR REPLACE INTO lorebooks (id, file_name) VALUES (?, ?)', [lorebook.id, lorebook.fileName]);
  d.execute('DELETE FROM lorebook_entries WHERE lorebook_id = ?', [lorebook.id]);
  for (const entry of lorebook.entries) {
    const encryptedText = await encrypt(entry.text);
    d.execute(
      'INSERT INTO lorebook_entries (lorebook_id, entry_index, text) VALUES (?, ?, ?)',
      [lorebook.id, entry.id, encryptedText],
    );
  }
}

export function deleteLorebookFromDB(lorebookId: string): void {
  const d = initDB();
  d.execute('DELETE FROM lorebook_entries WHERE lorebook_id = ?', [lorebookId]);
  d.execute('DELETE FROM lorebooks WHERE id = ?', [lorebookId]);
}

export async function getAllLorebooksFromDB(): Promise<LorebookState[]> {
  const d = initDB();
  const lorebookResult = d.execute('SELECT id, file_name FROM lorebooks ORDER BY file_name');
  if (!lorebookResult.results) {
    return [];
  }
  return Promise.all(
    lorebookResult.results.map(async row => {
      const id = row.id as string;
      const entriesResult = d.execute(
        'SELECT entry_index, text FROM lorebook_entries WHERE lorebook_id = ? ORDER BY entry_index',
        [id],
      );
      const entries: LorebookEntry[] = await Promise.all(
        (entriesResult.results || []).map(async e => ({
          id: e.entry_index as number,
          text: await decrypt(e.text as string),
        }))
      );
      return {id, fileName: row.file_name as string, entries};
    })
  );
}

interface DBCharacter {
  id: string;
  name: string;
  description: string;
  initial_message: string;
  writing_style: string;
  personality: string;
  scenario: string;
  example_messages: string;
  icon: string;
  lorebook_id: string;
}

export async function saveCharacterToDB(char: DBCharacter): Promise<void> {
  const d = initDB();
  const encrypted = {
    description: await encrypt(char.description),
    initial_message: await encrypt(char.initial_message),
    writing_style: await encrypt(char.writing_style),
    personality: await encrypt(char.personality),
    scenario: await encrypt(char.scenario),
    example_messages: await encrypt(char.example_messages),
  };
  d.execute(
    `INSERT OR REPLACE INTO characters
      (id, name, description, initial_message, writing_style, personality, scenario, example_messages, icon, lorebook_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [char.id, char.name, encrypted.description, encrypted.initial_message, encrypted.writing_style, encrypted.personality, encrypted.scenario, encrypted.example_messages, char.icon, char.lorebook_id],
  );
}

export function deleteCharacterFromDB(id: string): void {
  const d = initDB();
  d.execute('DELETE FROM characters WHERE id = ?', [id]);
}

export async function getAllCharactersFromDB(): Promise<DBCharacter[]> {
  const d = initDB();
  const result = d.execute(
    'SELECT id, name, description, initial_message, writing_style, personality, scenario, example_messages, icon, lorebook_id FROM characters ORDER BY name',
  );
  if (!result.results) {
    return [];
  }
  return Promise.all(
    result.results.map(async row => ({
      id: row.id as string,
      name: row.name as string,
      description: await decrypt((row.description as string) || ''),
      initial_message: await decrypt((row.initial_message as string) || ''),
      writing_style: await decrypt((row.writing_style as string) || ''),
      personality: await decrypt((row.personality as string) || ''),
      scenario: await decrypt((row.scenario as string) || ''),
      example_messages: await decrypt((row.example_messages as string) || ''),
      icon: (row.icon as string) || '',
      lorebook_id: (row.lorebook_id as string) || '',
    }))
  );
}

// =========================================================================
// Group Chats
// =========================================================================

interface GroupChatRow {
  id: string;
  name: string;
  description: string;
  icon: string;
  characterIds: string[];
}

export async function saveGroupChatToDB(group: GroupChatRow): Promise<void> {
  const d = initDB();
  const encryptedDescription = await encrypt(group.description);
  d.execute('BEGIN');
  try {
    d.execute(
      'INSERT OR REPLACE INTO group_chats (id, name, description, icon) VALUES (?, ?, ?, ?)',
      [group.id, group.name, encryptedDescription, group.icon],
    );
    d.execute('DELETE FROM group_chat_members WHERE group_chat_id = ?', [group.id]);
    for (let i = 0; i < group.characterIds.length; i++) {
      d.execute(
        'INSERT INTO group_chat_members (group_chat_id, character_id, position) VALUES (?, ?, ?)',
        [group.id, group.characterIds[i], i],
      );
    }
    d.execute('COMMIT');
  } catch (e) {
    d.execute('ROLLBACK');
    throw e;
  }
}

export function deleteGroupChatFromDB(id: string): void {
  const d = initDB();
  d.execute('BEGIN');
  try {
    d.execute('DELETE FROM group_chat_members WHERE group_chat_id = ?', [id]);
    d.execute('DELETE FROM group_chats WHERE id = ?', [id]);
    d.execute('COMMIT');
  } catch (e) {
    d.execute('ROLLBACK');
    throw e;
  }
}

export async function getAllGroupChatsFromDB(): Promise<GroupChatRow[]> {
  const d = initDB();
  const result = d.execute('SELECT id, name, description, icon FROM group_chats ORDER BY name');
  if (!result.results) {
    return [];
  }
  return Promise.all(
    result.results.map(async row => {
      const id = row.id as string;
      const membersResult = d.execute(
        'SELECT character_id FROM group_chat_members WHERE group_chat_id = ? ORDER BY position',
        [id],
      );
      const characterIds = (membersResult.results || []).map(m => m.character_id as string);
      return {
        id,
        name: row.name as string,
        description: await decrypt((row.description as string) || ''),
        icon: (row.icon as string) || '',
        characterIds,
      };
    })
  );
}

export function getSessionsForGroupChat(groupChatId: string): SessionSummary[] {
  const d = initDB();
  const result = d.execute(
    `SELECT s.id, s.character_id, s.group_chat_id, s.created_at, s.updated_at,
       COUNT(m.id) as message_count
     FROM chat_sessions s
     LEFT JOIN chat_messages m ON m.session_id = s.id
     WHERE s.group_chat_id = ?
     GROUP BY s.id
     ORDER BY s.updated_at DESC`,
    [groupChatId],
  );
  if (!result.results) {
    return [];
  }
  return result.results.map(row => ({
    id: row.id as string,
    characterId: row.character_id as string,
    groupChatId: row.group_chat_id as string,
    messageCount: row.message_count as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }));
}

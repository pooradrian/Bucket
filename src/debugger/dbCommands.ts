import {
  getDbConnection,
  getDBInfo,
  searchMessages,
  deleteAllByPrefix,
} from '../Database';
import {findCharacter} from '../debuggerUtils';
import {CommandHandler, DebuggerEnv, DebuggerIO} from './types';

export const DB_HELP_TEXT = [
  'DB Commands:',
  '  db                                Show DB info (row counts, journal mode)',
  '  db lookat <character>             Show session info for a character',
  '  db lookfor <query>                Search messages for text',
  '  db sessions                       List all sessions with message counts',
  '  db tables                         List all tables and row counts',
  '  db schema <table>                 Show table schema',
  '  db stress size:<MB>               Stress test up to target size',
  '  db stress entries:<N>             Stress test with N entries',
  '  db cleanup                        Remove all stress test data',
].join('\n');

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function safeIdentifier(name: string): string {
  if (!IDENT_RE.test(name)) {
    throw new Error(`Invalid identifier: "${name}"`);
  }
  return `"${name}"`;
}

export const dbCommand: CommandHandler = async (rest, env, io) => {
  const sub = rest[0]?.toLowerCase();

  if (!sub || sub === 'help') {
    io.log('info', DB_HELP_TEXT);
    return;
  }

  if (sub === 'info') {
    const info = getDBInfo();
    const journalResult = getDbConnection().execute('PRAGMA journal_mode');
    const journalMode = journalResult.results?.[0]?.journal_mode as string ?? '?';
    io.log('output', `Sessions: ${info.sessionCount}\nMessages: ${info.messageCount}\nJournal:  ${journalMode}`);
    return;
  }

  if (sub === 'tables') {
    const d = getDbConnection();
    const tables = d.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    if (!tables.results || tables.results.length === 0) {
      io.log('info', 'No tables found.');
      return;
    }
    const lines: string[] = [];
    for (const row of tables.results) {
      const name = row.name as string;
      const count = d.execute(`SELECT COUNT(*) as count FROM ${safeIdentifier(name)}`);
      const cnt = count.results?.[0]?.count as number ?? 0;
      lines.push(`  ${name}: ${cnt} rows`);
    }
    io.log('output', `Tables:\n${lines.join('\n')}`);
    return;
  }

  if (sub === 'schema') {
    const table = rest[1];
    if (!table) {
      io.log('error', 'Usage: db schema <table>');
      return;
    }
    const d = getDbConnection();
    const result = d.execute(`PRAGMA table_info(${safeIdentifier(table)})`);
    if (!result.results || result.results.length === 0) {
      io.log('error', `Table "${table}" not found.`);
      return;
    }
    const lines = result.results.map(row =>
      `  ${row.name} ${row.type}${row.notnull ? ' NOT NULL' : ''}${row.dflt_value !== null ? ` DEFAULT ${row.dflt_value}` : ''}${row.pk ? ' PRIMARY KEY' : ''}`
    );
    io.log('output', `Schema for ${table}:\n${lines.join('\n')}`);
    return;
  }

  if (sub === 'lookat') {
    const query = rest[1];
    if (!query) {
      io.log('error', 'Usage: db lookat <character>');
      return;
    }
    const char = findCharacter(env.characters, query);
    if (!char) {
      io.log('error', `Character "${query}" not found.`);
      return;
    }
    const session = getDbConnection().execute(
      'SELECT id, created_at, updated_at FROM chat_sessions WHERE character_id = ?',
      [char.id],
    );
    if (!session.results || session.results.length === 0) {
      io.log('info', `No session for ${char.name}.`);
      return;
    }
    const lines = session.results.map(sess => {
      const msgCount = getDbConnection().execute(
        'SELECT COUNT(*) as count FROM chat_messages WHERE session_id = ?',
        [sess.id as string],
      );
      const count = msgCount.results?.[0]?.count as number ?? 0;
      return [
        `Session:    ${sess.id}`,
        `Created:    ${new Date((sess.created_at as number)).toLocaleString()}`,
        `Updated:    ${new Date((sess.updated_at as number)).toLocaleString()}`,
        `Messages:   ${count}`,
      ].join('\n');
    });
    io.log('output', `Character: ${char.name} (${char.id})\n\n${lines.join('\n\n')}`);
    return;
  }

  if (sub === 'lookfor') {
    const query = rest.slice(1).join(' ');
    if (!query) {
      io.log('error', 'Usage: db lookfor <query>');
      return;
    }
    const results = await searchMessages(query);
    if (results.length === 0) {
      io.log('info', `No messages matching "${query}".`);
      return;
    }
    const lines = results.map(
      r => `  [${r.role}] ${r.content.slice(0, 100)}${r.content.length > 100 ? '...' : ''}`,
    );
    io.log('output', `Results (${results.length}):\n${lines.join('\n')}`);
    return;
  }

  if (sub === 'sessions') {
    const d = getDbConnection();
    const result = d.execute(
      'SELECT s.id, s.character_id, s.created_at, s.updated_at, COUNT(m.id) as msg_count FROM chat_sessions s LEFT JOIN chat_messages m ON m.session_id = s.id GROUP BY s.id ORDER BY s.updated_at DESC',
    );
    if (!result.results || result.results.length === 0) {
      io.log('info', 'No sessions found.');
      return;
    }
    const lines = result.results.map(row => {
      const charName = env.characters.find(c => c.id === row.character_id)?.name || '?';
      return `  [${row.id}] ${charName} — ${row.msg_count} msgs — updated ${new Date(row.updated_at as number).toLocaleString()}`;
    });
    io.log('output', `Sessions (${result.results.length}):\n${lines.join('\n')}`);
    return;
  }

  if (sub === 'cleanup') {
    io.log('info', 'Removing all stress test data...');
    const cleanupStart = performance.now();
    const result = deleteAllByPrefix('_stress_');
    const cleanupMs = (performance.now() - cleanupStart).toFixed(0);
    io.log('output', `Cleanup done in ${cleanupMs}ms — removed ${result.messages} messages, ${result.sessions} sessions`);
    return;
  }

  if (sub === 'stress') {
    await stressCommand(rest.slice(1), env, io);
    return;
  }

  io.log('error', `Unknown DB subcommand: "${sub}". Type "help db" for available commands.`);
};

async function stressCommand(rest: string[], env: DebuggerEnv, io: DebuggerIO) {
  const sizeArg = rest[0];
  if (!sizeArg) {
    io.log('error', 'Usage: db stress size:<MB> or db stress entries:<N>');
    return;
  }

  let targetEntries = 0;
  let targetBytes = 0;
  const isSize = sizeArg.toLowerCase().startsWith('size:');
  const isEntries = sizeArg.toLowerCase().startsWith('entries:');

  if (isSize) {
    const mb = parseFloat(sizeArg.split(':')[1]);
    if (isNaN(mb) || mb <= 0) {
      io.log('error', 'Invalid size. Example: db stress size:8');
      return;
    }
    targetBytes = mb * 1024 * 1024;
    targetEntries = Math.ceil(targetBytes / 300);
  } else if (isEntries) {
    targetEntries = parseInt(sizeArg.split(':')[1], 10);
    if (isNaN(targetEntries) || targetEntries <= 0) {
      io.log('error', 'Invalid entry count. Example: db stress entries:1000');
      return;
    }
  } else {
    io.log('error', 'Usage: db stress size:<MB> or db stress entries:<N>');
    return;
  }

  const d = getDbConnection();
  const stressPrefix = '_stress_';
  const msgsPerSession = 10;
  const totalSessions = Math.ceil(targetEntries / msgsPerSession);
  const t0 = performance.now();

  const yieldToUI = () => new Promise<void>(r => setTimeout(r, 0));

  io.log('info', `Stress test: ${isSize ? `~${targetEntries} entries (${sizeArg.split(':')[1]}MB)` : `${targetEntries} entries`}`);

  io.log('info', 'Phase 1: Inserting (batched)...');
  let inserted = 0;
  let firstSessionId = '';
  const insertStart = performance.now();
  const BATCH_SIZE = 500;
  let batch: Array<{query: string; params: (string | number | boolean | null)[]}> = [];
  for (let s = 0; s < totalSessions; s++) {
    const sessionId = `${stressPrefix}s${s}_${Date.now()}`;
    if (s === 0) firstSessionId = sessionId;
    batch.push({
      query: 'INSERT INTO chat_sessions (id, character_id, created_at, updated_at) VALUES (?, ?, ?, ?)',
      params: [sessionId, `_stress_char_${s % 5}`, Date.now(), Date.now()],
    });
    const msgCount = Math.min(msgsPerSession, targetEntries - inserted);
    for (let m = 0; m < msgCount; m++) {
      const content = `Stress test row ${inserted}: ${Math.random().toString(36).slice(2)} ${'x'.repeat(80)}`;
      batch.push({
        query: 'INSERT INTO chat_messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
        params: [`${stressPrefix}m${inserted}_${Date.now()}`, sessionId, m % 2 === 0 ? 'user' : 'assistant', content, Date.now()],
      });
      inserted++;
    }
    if (batch.length >= BATCH_SIZE || s === totalSessions - 1) {
      d.executeBatch(batch);
      batch = [];
      io.log('info', `  ... ${inserted}/${targetEntries} entries`);
      await yieldToUI();
    }
  }
  const insertMs = (performance.now() - insertStart).toFixed(0);
  io.log('output', `Bulk insert: ${insertMs}ms (${inserted} rows in batched transactions)`);

  io.log('info', 'Phase 2: Single-row insert benchmark...');
  const benchId = `${stressPrefix}_bench_${Date.now()}`;
  const singleInsertStart = performance.now();
  d.execute(
    'INSERT INTO chat_messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
    [benchId, firstSessionId, 'user', 'Benchmark row', Date.now()],
  );
  const singleInsertMs = (performance.now() - singleInsertStart).toFixed(1);
  io.log('output', `Single insert: ${singleInsertMs}ms (1 row, auto-commit)`);

  io.log('info', 'Phase 3: Reading back...');
  const readStart = performance.now();
  const sampleSize = Math.min(100, inserted);
  const sample = d.execute(
    'SELECT id, content FROM chat_messages WHERE id LIKE ? LIMIT ?',
    [`${stressPrefix}%`, sampleSize],
  );
  let readCount = 0;
  if (sample.results) {
    for (const row of sample.results) {
      const id = row.id as string;
      if (id.startsWith(stressPrefix)) readCount++;
    }
  }
  const readMs = (performance.now() - readStart).toFixed(0);
  io.log('output', `Read: ${readMs}ms (${readCount}/${sampleSize} verified)`);

  io.log('info', 'Phase 4: Updating...');
  const updateStart = performance.now();
  const toUpdate = d.execute(
    'SELECT id FROM chat_messages WHERE id LIKE ? LIMIT 50',
    [`${stressPrefix}%`],
  );
  let updateCount = 0;
  if (toUpdate.results) {
    for (const row of toUpdate.results) {
      d.execute(
        'UPDATE chat_messages SET content = ? WHERE id = ?',
        ['UPDATED_STRESS_ROW', row.id as string],
      );
      updateCount++;
    }
  }
  const updateMs = (performance.now() - updateStart).toFixed(0);
  io.log('output', `Bulk update: ${updateMs}ms (${updateCount} rows)`);

  const singleUpdateStart = performance.now();
  d.execute(
    'UPDATE chat_messages SET content = ? WHERE id = ?',
    ['Benchmark updated', benchId],
  );
  const singleUpdateMs = (performance.now() - singleUpdateStart).toFixed(1);
  io.log('output', `Single update: ${singleUpdateMs}ms (1 row, auto-commit)`);

  io.log('info', 'Phase 5: Deleting half...');
  const deleteStart = performance.now();
  const toDelete = d.execute(
    'SELECT id FROM chat_messages WHERE id LIKE ? LIMIT ?',
    [`${stressPrefix}%`, Math.floor(inserted / 2)],
  );
  let deleteCount = 0;
  if (toDelete.results) {
    for (const row of toDelete.results) {
      d.execute('DELETE FROM chat_messages WHERE id = ?', [row.id as string]);
      deleteCount++;
    }
  }
  const deleteMs = (performance.now() - deleteStart).toFixed(0);
  io.log('output', `Delete: ${deleteMs}ms (${deleteCount} rows)`);

  io.log('info', 'Phase 6: Cleaning up...');
  const cleanupStart = performance.now();
  const cleanup = deleteAllByPrefix(stressPrefix);
  const cleanupMs = (performance.now() - cleanupStart).toFixed(0);
  io.log('output', `Cleanup: ${cleanupMs}ms (${cleanup.messages} msgs, ${cleanup.sessions} sessions)`);

  const totalMs = (performance.now() - t0).toFixed(0);
  io.log('output', [
    '\u2500'.repeat(40),
    `DONE — ${inserted} entries in ${totalMs}ms`,
    `  Bulk insert:    ${insertMs}ms (${inserted} rows)`,
    `  Single insert:  ${singleInsertMs}ms (1 row)`,
    `  Read:           ${readMs}ms (${readCount}/${sampleSize})`,
    `  Bulk update:    ${updateMs}ms (${updateCount} rows)`,
    `  Single update:  ${singleUpdateMs}ms (1 row)`,
    `  Delete:         ${deleteMs}ms (${deleteCount} rows)`,
    `  Cleanup:        ${cleanupMs}ms`,
    '\u2500'.repeat(40),
  ].join('\n'));
}

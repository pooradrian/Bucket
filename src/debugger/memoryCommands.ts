import { loadPromptConfig } from '../PromptHandler';
import {
  getDbConnection,
  getMemoriesForScopeFromDB,
  getSessionById,
  deleteMemoryFromDB,
  deleteMemoriesForScopeFromDB,
} from '../Database';
import {
  buildMemoryContext,
  getMemoryConfig,
  loadMemorySettings,
  memoryRagConfig,
  memoryScopeId,
  rankMemories,
  runMemoryBackfill,
  saveAndIndexMemory,
} from '../Memory';
import { embedTexts, embeddingKey } from '../RAGHandler';
import { CommandHandler } from './types';

export const MEMORY_HELP_TEXT = [
  'Memory Commands:',
  '  mem                               List memory scopes and counts',
  '  mem.list <scope>                  List memories in a scope',
  '  mem.add <scope> <text>            Store a memory (indexed immediately)',
  '  mem.del <id>                      Delete a memory by id',
  '  mem.rank <scope> <query>          Rank memories against a query',
  '  mem.context <sessionId> <text>    Show the block retrieval would inject',
  '  mem.extract <sessionId> [chunk]   Backfill memories from a session',
  '  mem.clear <scope>                 Delete every memory in a scope',
  '',
  '  Scopes: character:<characterId> or session:<sessionId>',
].join('\n');

function scopeCounts(): Array<{ scopeId: string; count: number }> {
  const result = getDbConnection().execute(
    'SELECT scope_id, COUNT(*) AS count FROM memories GROUP BY scope_id ORDER BY scope_id',
  );
  return (result.results || []).map(row => ({
    scopeId: row.scope_id as string,
    count: row.count as number,
  }));
}

export const memCommand: CommandHandler = async (rest, _env, io) => {
  const sub = (rest[0] || 'list').toLowerCase();
  const args = rest.slice(1);

  if (sub === 'help') {
    io.log('info', MEMORY_HELP_TEXT);
    return;
  }

  if (sub === 'list') {
    const scopeId = args[0];
    if (!scopeId) {
      const counts = scopeCounts();
      if (counts.length === 0) {
        io.log('info', 'No memories stored.');
        return;
      }
      io.log(
        'output',
        counts.map(row => `  ${row.scopeId}: ${row.count}`).join('\n'),
      );
      return;
    }
    const memories = await getMemoriesForScopeFromDB(scopeId);
    if (memories.length === 0) {
      io.log('info', `No memories in ${scopeId}.`);
      return;
    }
    io.log(
      'output',
      memories
        .map(
          memory =>
            `  ${memory.id}\n    ${memory.text}\n    created ${new Date(
              memory.createdAt,
            ).toISOString()} · ${
              memory.vector.length > 0 ? 'indexed' : 'not indexed'
            }${memory.pinned ? ' · pinned' : ''}`,
        )
        .join('\n'),
    );
    return;
  }

  if (sub === 'add') {
    const scopeId = args[0];
    const text = args.slice(1).join(' ').trim();
    if (!scopeId || !text) {
      io.log('error', 'Usage: mem.add <scope> <text>');
      return;
    }
    try {
      const config = await loadPromptConfig();
      const stored = await saveAndIndexMemory(scopeId, text, config, '');
      io.log(
        stored ? 'output' : 'info',
        stored
          ? `Stored and indexed in ${scopeId}.`
          : 'Duplicate memory ignored.',
      );
    } catch (e) {
      io.log('error', `Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }

  if (sub === 'del') {
    const id = args[0];
    if (!id) {
      io.log('error', 'Usage: mem.del <id>');
      return;
    }
    deleteMemoryFromDB(id);
    io.log('output', `Deleted ${id}.`);
    return;
  }

  if (sub === 'clear') {
    const scopeId = args[0];
    if (!scopeId) {
      io.log('error', 'Usage: mem.clear <scope>');
      return;
    }
    deleteMemoriesForScopeFromDB(scopeId);
    io.log('output', `Cleared ${scopeId}.`);
    return;
  }

  if (sub === 'rank') {
    const scopeId = args[0];
    const query = args.slice(1).join(' ');
    if (!scopeId || !query.trim()) {
      io.log('error', 'Usage: mem.rank <scope> <query>');
      return;
    }
    const config = await loadPromptConfig();
    const ragConfig = memoryRagConfig(config);
    const key = embeddingKey(ragConfig, config);
    const memories = (await getMemoriesForScopeFromDB(scopeId)).filter(
      memory => memory.vectorKey === key && memory.vector.length > 0,
    );
    if (memories.length === 0) {
      io.log('info', `No indexed memories in ${scopeId}.`);
      return;
    }
    try {
      const t0 = performance.now();
      const vectors = await embedTexts([query], ragConfig, config);
      const ms = (performance.now() - t0).toFixed(0);
      const memoryConfig = getMemoryConfig(
        loadMemorySettings(scopeId.replace(/^character:/, '')),
        config,
      );
      const ranked = rankMemories(
        vectors,
        memories,
        -1,
        memories.length,
      );
      io.log(
        'output',
        [
          `Ranked ${ranked.length} memories in ${ms}ms (inject >= ${memoryConfig.minSimilarity}):`,
          ...ranked.map(entry => {
            const injected = entry.score >= memoryConfig.minSimilarity;
            return `  ${injected ? '=>' : '  '} ${entry.score.toFixed(
              4,
            )}  ${entry.memory.text.slice(0, 90)}`;
          }),
        ].join('\n'),
      );
    } catch (e) {
      io.log(
        'error',
        `Ranking failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return;
  }

  if (sub === 'context') {
    const sessionId = args[0];
    const text = args.slice(1).join(' ');
    if (!sessionId) {
      io.log('error', 'Usage: mem.context <sessionId> <text>');
      return;
    }
    const session = await getSessionById(sessionId);
    if (!session) {
      io.log('error', `Session ${sessionId} not found.`);
      return;
    }
    const config = await loadPromptConfig();
    const settings = loadMemorySettings(session.characterId);
    const memoryConfig = getMemoryConfig(settings, config);
    const scopeId = memoryScopeId(
      memoryConfig.scope,
      session.characterId,
      sessionId,
    );
    const block = await buildMemoryContext({
      scopeId,
      sessionId,
      priorLastMessageId: session.messages[session.messages.length - 1]?.id,
      userText: text,
      settings,
      config,
    });
    io.log('output', block.block || '(nothing injected)');
    return;
  }

  if (sub === 'extract') {
    const sessionId = args[0];
    const chunk = Number(args[1]) || 0;
    if (!sessionId) {
      io.log('error', 'Usage: mem.extract <sessionId> [messagesPerCall]');
      return;
    }
    const session = await getSessionById(sessionId);
    if (!session) {
      io.log('error', `Session ${sessionId} not found.`);
      return;
    }
    const config = await loadPromptConfig();
    const settings = loadMemorySettings(session.characterId);
    const memoryConfig = getMemoryConfig(settings, config);
    const characterRow = getDbConnection().execute(
      'SELECT name FROM characters WHERE id = ?',
      [session.characterId],
    ).results?.[0];
    const characterName = (characterRow?.name as string) || 'Character';
    const scopeId = memoryScopeId(
      memoryConfig.scope,
      session.characterId,
      sessionId,
    );
    io.log(
      'info',
      `Backfilling ${session.messages.length} messages into ${scopeId}...`,
    );
    try {
      const outcome = await runMemoryBackfill({
        sessionId,
        characterName,
        scopeId,
        messages: session.messages,
        settings,
        config,
        chunkSize: chunk || undefined,
        onProgress: progress =>
          io.log(
            'info',
            `  chunk ${progress.done}/${progress.total} · ${progress.facts} facts`,
          ),
      });
      io.log(
        'output',
        outcome.cancelled
          ? 'Cancelled.'
          : `Done: ${outcome.facts} facts from ${outcome.calls} calls.`,
      );
    } catch (e) {
      io.log(
        'error',
        `Backfill failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return;
  }

  io.log('error', `Unknown mem subcommand: "${sub}". Type: help mem`);
};

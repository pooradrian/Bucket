import {loadPromptConfig} from '../PromptHandler';
import {getLorebookEntriesFromDB, getAllLorebooksFromDB} from '../Database';
import {embeddingsUrl, getEmbeddings} from '../Endpoint';
import {rankLorebookEntries, MIN_SIMILARITY, ScoredEntry} from '../RAGHandler';
import {CommandHandler} from './types';

export const embedCommand: CommandHandler = async (rest, env, io) => {
  const text = rest.join(' ') || 'The quick brown fox jumps over the lazy dog.';
  const config = await loadPromptConfig();
  if (!config.apiUrl?.trim()) {
    io.log('error', 'No API URL configured. Run: config.set apiurl <url>');
    return;
  }
  const model = config.ragModel?.trim() || config.model;
  io.log('info', `POST ${embeddingsUrl(config.apiUrl)}\nModel: ${model}\nInput: "${text}"`);
  try {
    const t0 = performance.now();
    const vectors = await getEmbeddings([text], model, config);
    const ms = (performance.now() - t0).toFixed(0);
    const vec = vectors[0];
    const sample = vec
      .slice(0, 8)
      .map(v => v.toFixed(4))
      .join(', ');
    io.log(
      'output',
      [
        `OK: 1 vector in ${ms}ms`,
        `Dimensions: ${vec.length}`,
        `First values: [${sample}${vec.length > 8 ? ', ...' : ''}]`,
      ].join('\n'),
    );
  } catch (e: unknown) {
    io.log('error', `Embeddings failed: ${e instanceof Error ? e.message : String(e)}`);
    io.log('info', 'Set an embedding model with config.set ragmodel <name> — your server must expose the /embeddings endpoint.');
  }
};

export const ragCommand: CommandHandler = async (rest, env, io) => {
  const id = rest[0];
  const query = rest.slice(1).join(' ');
  if (!id || !query.trim()) {
    io.log('error', 'Usage: rag <lorebook-id> <query>');
    return;
  }
  const lorebooks = await getAllLorebooksFromDB();
  const lb = lorebooks.find(l => l.id === id || l.fileName.toLowerCase().startsWith(id.toLowerCase()));
  if (!lb) {
    io.log('error', `Lorebook "${id}" not found.`);
    return;
  }

  const entries = await getLorebookEntriesFromDB(lb.id);
  if (entries.length === 0) {
    io.log('info', `${lb.fileName} has no entries.`);
    return;
  }

  const config = await loadPromptConfig();
  const model = config.ragModel?.trim() || config.model;
  const ragConfig = {
    enabled: true,
    model,
    maxEntriesToSend: config.ragMaxEntriesToSend,
    maxResults: config.ragMaxResults,
  };
  const maxResults = Number(ragConfig.maxResults) || 5;

  io.log(
    'info',
    `Ranking ${Math.min(entries.length, Number(ragConfig.maxEntriesToSend) || 50)}/${entries.length} entries of "${lb.fileName}" against:\n"${query}"\n(model: ${model})`,
  );

  try {
    const t0 = performance.now();
    const ranked: ScoredEntry[] = await rankLorebookEntries(query, entries, ragConfig, config);
    const ms = (performance.now() - t0).toFixed(0);

    const lines = ranked.map((r, i) => {
      const injected = i < maxResults && r.score >= MIN_SIMILARITY ? '=> ' : '   ';
      const snippet = r.entry.text.slice(0, 60) + (r.entry.text.length > 60 ? '...' : '');
      return `  ${injected}${r.score.toFixed(4)}  #${r.entry.id + 1}  ${snippet}`;
    });
    const above = ranked.filter(r => r.score >= MIN_SIMILARITY).length;

    io.log(
      'output',
      [
        `Scores in ${ms}ms (cosine; threshold ${MIN_SIMILARITY}, max results ${maxResults}):`,
        ...lines,
        '',
        `${above}/${ranked.length} entries above threshold — injecting top ${Math.min(maxResults, above)}.`,
      ].join('\n'),
    );
  } catch (e: unknown) {
    io.log('error', `RAG ranking failed: ${e instanceof Error ? e.message : String(e)}`);
    io.log('info', 'Set an embedding model with config.set ragmodel <name> — your server must expose the /embeddings endpoint.');
  }
};

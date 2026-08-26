import {
  loadPromptConfig,
  savePromptConfig,
} from '../PromptHandler';
import {
  getKV,
  setKV,
  getAllKVKeys,
  getAllLorebooksFromDB,
  getLorebookEntriesFromDB,
} from '../Database';
import {
  getProviders,
  getActiveProviderId,
  getProviderKey,
  maskKey,
} from '../SecureStore';
import {CommandHandler} from './types';

export const configCommand: CommandHandler = async (rest, env, io) => {
  const config = await loadPromptConfig();
  io.log(
    'output',
    [
      `Prefix:        ${config.prefix}`,
      `Suffix:        ${config.suffix}`,
      `User Desc:     ${config.userDescription || '(empty)'}`,
      `Active Persona:${config.activePersonaId ? ' ' + (config.personas?.find(p => p.id === config.activePersonaId)?.name ?? config.activePersonaId) : ' (none)'}`,
      `Cutoff Mode:   ${config.historyCutoffMode}`,
      `Cutoff Amount: ${config.historyCutoffAmount}`,
      `Provider ID:   ${config.providerId || '(none)'}`,
      `API URL:       ${config.apiUrl || '(not set)'}`,
      `API Key:       ${config.apiKey ? '****' + config.apiKey.slice(-4) : '(not set)'}`,
      `Model:         ${config.model}`,
      `Temperature:   ${config.temperature || '(default)'}`,
      `Embedding Model: ${config.ragModel || '(uses main model)'}`,
      `RAG Enabled:   ${config.ragEnabled ? 'yes' : 'no'}`,
      `RAG Max Entry: ${config.ragMaxEntriesToSend}`,
      `RAG Max Res:   ${config.ragMaxResults}`,
    ].join('\n'),
  );
};

export const configSetCommand: CommandHandler = async (rest, env, io) => {
  const key = rest[0]?.toLowerCase();
  const value = rest.slice(1).join(' ');
  if (!key || !value) {
    io.log('error', 'Usage: config.set <prefix|suffix|usr|model|apiurl|apikey|cutoffmode|cutoffamount> <value>');
    return;
  }
  const config = await loadPromptConfig();
  if (key === 'prefix') {
    config.prefix = value;
  } else if (key === 'suffix') {
    config.suffix = value;
  } else if (key === 'usr' || key === 'user' || key === 'userdescription') {
    config.userDescription = value;
  } else if (key === 'model') {
    config.model = value;
  } else if (key === 'apiurl' || key === 'url') {
    config.apiUrl = value;
  } else if (key === 'apikey' || key === 'key') {
    config.apiKey = value;
  } else if (key === 'cutoffmode' || key === 'mode') {
    if (value !== 'tokens' && value !== 'messages') {
      io.log('error', 'cutoffmode must be "tokens" or "messages"');
      return;
    }
    config.historyCutoffMode = value;
  } else if (key === 'cutoffamount' || key === 'amount') {
    config.historyCutoffAmount = value;
  } else if (key === 'ragmodel' || key === 'embedmodel') {
    config.ragModel = value;
  } else {
    io.log('error', `Unknown key "${key}". Use: prefix, suffix, usr, model, apiurl, apikey, cutoffmode, cutoffamount`);
    return;
  }
  await savePromptConfig(config);
  io.log('output', `Updated ${key}.`);
};

export const storageCommand: CommandHandler = async (rest, env, io) => {
  const sub = rest[0]?.toLowerCase();
  if (sub === 'set') {
    const key = rest[1];
    const value = rest.slice(2).join(' ');
    if (!key || !value) {
      io.log('error', 'Usage: storage.set <key> <value>');
      return;
    }
    setKV(key, value);
    io.log('output', `Set "${key}" = "${value}"`);
  } else if (sub === 'keys') {
    const allKeys = getAllKVKeys();
    io.log('output', `Keys (${allKeys.length}):\n${allKeys.map(k => '  ' + k).join('\n')}`);
  } else if (sub) {
    const value = getKV(sub);
    io.log('output', value !== null ? `${sub} = ${value}` : `${sub} not found`);
  } else {
    io.log('error', 'Usage: storage <key> | storage.set <key> <value> | storage.keys');
  }
};

export const providersCommand: CommandHandler = async (rest, env, io) => {
  const providers = getProviders();
  const activeId = getActiveProviderId();
  if (providers.length === 0) {
    io.log('info', 'No providers configured.');
  } else {
    const lines = await Promise.all(providers.map(async p => {
      const key = await getProviderKey(p.id);
      const masked = key ? maskKey(key) : '(none)';
      const active = p.id === activeId ? ' [ACTIVE]' : '';
      return `  [${p.id}] ${p.name}${active}\n    URL: ${p.url}\n    Key: ${masked}`;
    }));
    io.log('output', `Providers (${providers.length}):\n${lines.join('\n')}`);
  }
};

export const providerCommand: CommandHandler = async (rest, env, io) => {
  const sub = rest[0]?.toLowerCase();
  if (sub === 'active') {
    const activeId = getActiveProviderId();
    if (!activeId) {
      io.log('info', 'No active provider set.');
    } else {
      const providers = getProviders();
      const p = providers.find(x => x.id === activeId);
      if (p) {
        const key = await getProviderKey(p.id);
        io.log('output', `Active: ${p.name}\nURL: ${p.url}\nKey: ${key ? maskKey(key) : '(none)'}`);
      } else {
        io.log('output', `Active ID: ${activeId} (provider not found)`);
      }
    }
    return;
  }
  if (sub === 'key') {
    const id = rest[1];
    if (!id) {
      io.log('error', 'Usage: provider.key <id>');
      return;
    }
    const key = await getProviderKey(id);
    io.log('output', key ? `Key: ${maskKey(key)}\nLength: ${key.length}` : 'No key found for this provider.');
    return;
  }
  io.log('error', 'Usage: provider <active|key <id>>');
};

export const lorebooksCommand: CommandHandler = async (rest, env, io) => {
  const lorebooks = await getAllLorebooksFromDB();
  if (lorebooks.length === 0) {
    io.log('info', 'No lorebooks found.');
  } else {
    const lines = lorebooks.map(
      l => `  [${l.id}] ${l.fileName} — ${l.entryCount} entries`,
    );
    io.log('output', `Lorebooks (${lorebooks.length}):\n${lines.join('\n')}`);
  }
};

export const lorebookCommand: CommandHandler = async (rest, env, io) => {
  const id = rest[0];
  if (!id) {
    io.log('error', 'Usage: lorebook <id>');
    return;
  }
  const lorebooks = await getAllLorebooksFromDB();
  const lb = lorebooks.find(l => l.id === id || l.fileName.toLowerCase().startsWith(id.toLowerCase()));
  if (!lb) {
    io.log('error', `Lorebook "${id}" not found.`);
    return;
  }
  const entries = await getLorebookEntriesFromDB(lb.id);
  const lines = entries.map(e => `  ${e.id + 1}. ${e.text.slice(0, 100)}${e.text.length > 100 ? '...' : ''}`);
  io.log('output', `${lb.fileName} (${entries.length} entries):\n${lines.join('\n')}`);
};

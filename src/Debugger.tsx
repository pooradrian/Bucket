import {useState, useRef, useCallback, useEffect} from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import axios, {AxiosRequestConfig} from 'axios';
import {ChatMessage} from './useChat';
import {
  buildPrompt,
  sendToLLM,
  loadPromptConfig,
  savePromptConfig,
} from './PromptHandler';
// js-tiktoken loaded dynamically in tiktoken command
import {
  getDbConnection,
  getDBInfo,
  searchMessages,
  deleteAllByPrefix,
  getSessionForCharacter,
  getKV,
  setKV,
  getAllKVKeys,
  getAllLorebooksFromDB,
  getAllSessionsForCharacter,
} from './Database';
import {
  getProviders,
  getActiveProviderId,
  getProviderKey,
  maskKey,
} from './SecureStore';
import {useAppStore} from './store';
import {useTheme} from './ThemeContext';
import {crashExport} from './CrashExport';
import {encrypt, decrypt} from './Crypto';
import {LogEntry, parseArgs, findCharacter} from './debuggerUtils';

const encryptText = encrypt;
const decryptText = decrypt;

const reqMetaMap = new WeakMap<AxiosRequestConfig, {reqId: string; t0: number}>();

interface DebuggerProps {
  onClose: () => void;
  bottomInset: number;
}

export default function Debugger({onClose, bottomInset}: DebuggerProps) {
  const characters = useAppStore(st => st.characters);
  const appSettings = useAppStore(st => st.appSettings);
  const toggleSysStats = useAppStore(st => st.toggleSysStats);
  const st = useTheme();
  const [log, setLog] = useState<LogEntry[]>([
    {id: '0', type: 'info', text: 'Debugger ready. Type "help" for available commands.'},
  ]);
  const [input, setInput] = useState('');
  const flatListRef = useRef<FlatList<LogEntry>>(null);
  const verboseRef = useRef(false);
  const reqInterceptorRef = useRef<number | null>(null);
  const resInterceptorRef = useRef<number | null>(null);

  const appendLog = useCallback((type: LogEntry['type'], text: string) => {
    setLog(prev => [...prev, {id: Date.now().toString() + Math.random(), type, text}]);
  }, []);

  useEffect(() => {
    return () => {
      if (reqInterceptorRef.current !== null) {
        axios.interceptors.request.eject(reqInterceptorRef.current);
      }
      if (resInterceptorRef.current !== null) {
        axios.interceptors.response.eject(resInterceptorRef.current);
      }
    };
  }, []);

  const enableVerbose = useCallback(() => {
    if (verboseRef.current) return;
    verboseRef.current = true;

    reqInterceptorRef.current = axios.interceptors.request.use((config) => {
      const reqId = Math.random().toString(36).slice(2, 8);
      reqMetaMap.set(config, {reqId, t0: 0});

      let bodyPreview = '';
      if (config.data && typeof config.data === 'string') {
        try {
          const parsed = JSON.parse(config.data);
          bodyPreview = JSON.stringify(parsed, null, 2);
        } catch {
          bodyPreview = String(config.data).slice(0, 500);
        }
      } else if (config.data && typeof config.data === 'object') {
        bodyPreview = JSON.stringify(config.data, null, 2);
      }

      appendLog('info', `[${reqId}] >>> ${config.method?.toUpperCase() || 'GET'} ${config.url}`);
      if (bodyPreview) {
        appendLog('info', `[${reqId}] >>> Body:\n${bodyPreview}`);
      }
      if (config.headers) {
        appendLog('info', `[${reqId}] >>> Headers: ${JSON.stringify(config.headers)}`);
      }

      reqMetaMap.set(config, {reqId, t0: performance.now()});
      return config;
    });

    resInterceptorRef.current = axios.interceptors.response.use(
      (response) => {
        const meta = reqMetaMap.get(response.config) || {reqId: '???', t0: performance.now()};
        const reqId = meta.reqId;
        const t0 = meta.t0;
        const ms = (performance.now() - t0).toFixed(0);
        const resHeaders = response.headers || {};

        appendLog('info', [
          `[${reqId}] <<< ${response.status} ${response.statusText} in ${ms}ms`,
          `  Headers: ${JSON.stringify(resHeaders)}`,
        ].join('\n'));

        return response;
      },
      (error) => {
        const config = error.config || {};
        const meta = reqMetaMap.get(config) || {reqId: '???', t0: performance.now()};
        const reqId = meta.reqId;
        const t0 = meta.t0;
        const ms = (performance.now() - t0).toFixed(0);
        const status = error.response?.status;
        const statusText = error.response?.statusText || 'Error';

        appendLog('error', `[${reqId}] <<< ${status || '???'} ${statusText} in ${ms}ms`);
        return Promise.reject(error);
      },
    );

    appendLog('output', 'Verbose axios logging ON');
  }, [appendLog]);

  const disableVerbose = useCallback(() => {
    if (!verboseRef.current) return;
    if (reqInterceptorRef.current !== null) {
      axios.interceptors.request.eject(reqInterceptorRef.current);
      reqInterceptorRef.current = null;
    }
    if (resInterceptorRef.current !== null) {
      axios.interceptors.response.eject(resInterceptorRef.current);
      resInterceptorRef.current = null;
    }
    verboseRef.current = false;
    appendLog('output', 'Verbose axios logging OFF');
  }, [appendLog]);

  const executeCommand = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        return;
      }

      const args = parseArgs(trimmed);
      const cmd = args[0]?.toLowerCase();
      const rest = args.slice(1);
      const isSensitive = cmd === 'encrypt' || cmd === 'decrypt';
      appendLog('input', isSensitive ? `$ ${cmd} ${'*'.repeat(trimmed.length - cmd.length)}` : `$ ${trimmed}`);

      try {
        switch (cmd) {
          case 'help': {
            const sub = rest[0]?.toLowerCase();
            if (sub === 'db') {
              appendLog('info', [
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
              ].join('\n'));
              break;
            }
            if (sub === 'provider') {
              appendLog('info', [
                'Provider Commands:',
                '  providers                         List all API providers',
                '  provider.active                   Show the active provider',
                '  provider.key <id>                 Show masked API key for a provider',
              ].join('\n'));
              break;
            }
            if (sub === 'lorebook') {
              appendLog('info', [
                'Lorebook Commands:',
                '  lorebooks                         List all lorebooks',
                '  lorebook <id>                     Show lorebook entries',
              ].join('\n'));
              break;
            }
            appendLog('info', [
              'General:',
              '  help                              Show this help',
              '  help db                           Show DB commands',
              '  help provider                     Show provider commands',
              '  help lorebook                     Show lorebook commands',
              '  verbose [on|off]                  Toggle fetch request monitoring',
              '  test [--verbose]                  Diagnose API connection',
              '  clear                             Clear terminal output',
              '',
              'Characters & Chat:',
              '  chars                             List all characters',
              '  char <id|name>                    Show character details',
              '  prompt <id|name> <message>        Build prompt and show messages array',
              '  send <id|name> <message>          Build prompt and send to LLM',
              '  history <id|name>                 Show chat history',
              '',
              'Providers & API:',
              '  providers                         List all API providers',
              '  provider.active                   Show active provider',
              '  provider.key <id>                 Show masked API key',
              '  api <GET|POST|PUT|DELETE> <url>   Make HTTP request',
              '     [--body <json>]',
              '',
              'Prompt Config:',
              '  config                            Show current prompt config',
              '  config.set <key> <value>          Set config value',
              '     keys: prefix, suffix, usr, model, apiurl,',
              '           apikey, cutoffmode, cutoffamount',
              '',
              'Storage:',
              '  storage <key>                     Read stored value',
              '  storage.set <key> <value>         Write stored value',
              '  storage.keys                      List all stored keys',
              '',
              'Lorebooks:',
              '  lorebooks                         List all lorebooks',
              '  lorebook <id>                     Show lorebook entries',
              '',
              'Theme & Settings:',
              '  settings                          Show current app settings',
              '',
              'Tools:',
              '  unlock sysstats                   Toggle system stats overlay',
              '  tiktoken [text]                   Test tiktoken encoding',
              '  crash                             Trigger crash export (test)',
              '  encrypt <text>                   Test encryption',
              '  encrypt test                      Run encryption test suite',
              '',
              'DB (type "help db" for more):',
              '  db                                Show DB info',
              '  db lookat <character>             Session info for character',
              '  db lookfor <query>                Search messages',
              '  db sessions                       List all sessions',
              '  db tables                         List all tables',
              '  db schema <table>                 Show table schema',
              '  db stress size:<MB>               Stress test',
              '  db cleanup                        Remove stress test data',
            ].join('\n'));
            break;
          }

          case 'verbose': {
            const flag = rest[0]?.toLowerCase();
            if (flag === 'on' || flag === '1' || flag === 'true') {
              enableVerbose();
            } else if (flag === 'off' || flag === '0' || flag === 'false') {
              disableVerbose();
            } else {
              if (verboseRef.current) {
                disableVerbose();
              } else {
                enableVerbose();
              }
            }
            break;
          }

          case 'test': {
            const verboseFlag = rest.includes('--verbose');
            if (verboseFlag && !verboseRef.current) {
              enableVerbose();
            }
            const config = await loadPromptConfig();
            const url = config.apiUrl?.trim();
            const key = config.apiKey?.trim();

            appendLog('info', 'Running diagnostics...');

            if (!url) {
              appendLog('error', 'FAIL: No API URL configured. Run: config.set apiurl <url>');
              break;
            }
            appendLog('info', `URL:  ${url}`);
            appendLog('info', `Key:  ${key ? key.slice(0, 8) + '...' + key.slice(-4) : '(none)'}`);
            appendLog('info', `Model: ${config.model}`);

            const baseUrl = url.replace(/\/chat\/completions\/?$/, '').replace(/\/v1\/?$/, '');
            appendLog('info', `\nTesting connectivity to ${baseUrl} ...`);
            try {
              const t0 = performance.now();
              const res = await axios.get(baseUrl, {timeout: 8000});
              const ms = (performance.now() - t0).toFixed(0);
              appendLog('output', `Connected in ${ms}ms — status ${res.status}`);
            } catch (e: unknown) {
              const msg = axios.isCancel(e)
                ? 'Timed out after 8s'
                : e instanceof Error ? e.message : String(e);
              appendLog('error', `FAIL: Could not reach server — ${msg}`);
              appendLog('info', 'Check that the URL is correct and reachable from your device.');
              break;
            }

            appendLog('info', '\nSending minimal test POST (streaming)...');
            try {
              const headers: Record<string, string> = {'Content-Type': 'application/json'};
              if (key) { headers.Authorization = `Bearer ${key}`; }
              const t0 = performance.now();
              let gotFirstToken = false;
              let chunks = 0;
              let processedLen = 0;
              await axios({
                method: 'POST',
                url,
                headers,
                data: {
                  model: config.model || 'gpt-4o',
                  messages: [{role: 'user', content: 'hi'}],
                  stream: true,
                  max_tokens: 5,
                },
                onDownloadProgress: (progressEvent) => {
                  const fullText = typeof progressEvent.event.target.responseText === 'string'
                    ? progressEvent.event.target.responseText
                    : '';
                  if (fullText.length > processedLen) {
                    chunks++;
                    processedLen = fullText.length;
                    if (!gotFirstToken) {
                      gotFirstToken = true;
                      appendLog('output', `First token in ${(performance.now() - t0).toFixed(0)}ms`);
                    }
                  }
                },
              });
              const ms = (performance.now() - t0).toFixed(0);
              appendLog('output', `\nDone in ${ms}ms (${chunks} chunks) — streaming works.`);
            } catch (e: unknown) {
              const msg = axios.isCancel(e)
                ? 'Timed out'
                : e instanceof Error ? e.message : String(e);
              appendLog('error', `FAIL: POST failed — ${msg}`);
            }
            break;
          }

          case 'clear': {
            setLog([]);
            break;
          }

          case 'chars': {
            if (characters.length === 0) {
              appendLog('info', 'No characters found.');
            } else {
              const lines = characters.map(
                c => `  [${c.id}] ${c.name}${c.description ? ' - ' + c.description.slice(0, 60) : ''}`,
              );
              appendLog('output', `Characters (${characters.length}):\n${lines.join('\n')}`);
            }
            break;
          }

          case 'char': {
            const query = rest[0];
            if (!query) {
              appendLog('error', 'Usage: char <id|name>');
              break;
            }
            const char = findCharacter(characters, query);
            if (!char) {
              appendLog('error', `Character "${query}" not found.`);
              break;
            }
            const sessions = getAllSessionsForCharacter(char.id);
            const lorebooks = await getAllLorebooksFromDB();
            const assignedLorebooks = lorebooks.filter(l => (char.lorebookIds || []).includes(l.id));
            appendLog(
              'output',
              [
                `ID:          ${char.id}`,
                `Name:        ${char.name}`,
                `Description: ${char.description || '(none)'}`,
                `Personality: ${char.personality || '(none)'}`,
                `Writing:     ${char.writingStyle || '(none)'}`,
                `Scenario:    ${char.scenario || '(none)'}`,
                `First Msg:   ${char.initialMessage || '(none)'}`,
                `Examples:    ${char.exampleMessages ? char.exampleMessages.slice(0, 80) + (char.exampleMessages.length > 80 ? '...' : '') : '(none)'}`,
                `Lorebooks:   ${assignedLorebooks.length > 0 ? assignedLorebooks.map(l => `${l.fileName} (${l.entries.length} entries)`).join(', ') : '(none)'}`,
                `Sessions:    ${sessions.length}`,
                `Last Active: ${sessions.length > 0 ? new Date(sessions[0].updatedAt).toLocaleString() : 'never'}`,
              ].join('\n'),
            );
            break;
          }

          case 'prompt': {
            const query = rest[0];
            const message = rest.slice(1).join(' ');
            if (!query || !message) {
              appendLog('error', 'Usage: prompt <id|name> <message>');
              break;
            }
            const char = findCharacter(characters, query);
            if (!char) {
              appendLog('error', `Character "${query}" not found.`);
              break;
            }
            const config = await loadPromptConfig();
            const history: ChatMessage[] = [];
            const t0 = performance.now();
            const messages = buildPrompt(char, message, history, config);
            const buildMs = (performance.now() - t0).toFixed(1);
            appendLog('output', `${JSON.stringify(messages, null, 2)}\n\nPrompt built in ${buildMs}ms`);
            break;
          }

          case 'send': {
            const query = rest[0];
            const message = rest.slice(1).join(' ');
            if (!query || !message) {
              appendLog('error', 'Usage: send <id|name> <message>');
              break;
            }
            const char = findCharacter(characters, query);
            if (!char) {
              appendLog('error', `Character "${query}" not found.`);
              break;
            }
            appendLog('info', 'Sending to LLM...');
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
            appendLog('output', [
              '─'.repeat(40),
              result.content,
              '─'.repeat(40),
              `  Prompt build:  ${m.promptBuildMs.toFixed(1)}ms`,
              `  TTFB (ack):    ${m.ttfbMs.toFixed(1)}ms`,
              `  Body read:     ${m.bodyReadMs.toFixed(1)}ms`,
              `  Total:         ${m.totalMs.toFixed(1)}ms`,
            ].join('\n'));
            break;
          }

          case 'api': {
            const method = rest[0]?.toUpperCase();
            const url = rest[1];
            if (!method || !url) {
              appendLog('error', 'Usage: api <GET|POST|PUT|DELETE> <url> [--body <json>]');
              break;
            }
            const bodyIdx = rest.indexOf('--body');
            let body: string | undefined;
            if (bodyIdx !== -1) {
              body = rest.slice(bodyIdx + 1).join(' ');
            }
            appendLog('info', `${method} ${url}${body ? '\nBody: ' + body : ''}`);
            const axiosOpts: AxiosRequestConfig = {method, url};
            if (body && method !== 'GET') {
              axiosOpts.headers = {'Content-Type': 'application/json'};
              axiosOpts.data = body;
            }
            const res = await axios(axiosOpts);
            const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
            let formatted = `Status: ${res.status} ${res.statusText}`;
            try {
              const json = JSON.parse(text);
              formatted += '\n\n' + JSON.stringify(json, null, 2);
            } catch {
              formatted += '\n\n' + text;
            }
            appendLog('output', formatted);
            break;
          }

          case 'history': {
            const query = rest[0];
            if (!query) {
              appendLog('error', 'Usage: history <id|name>');
              break;
            }
            const char = findCharacter(characters, query);
            if (!char) {
              appendLog('error', `Character "${query}" not found.`);
              break;
            }
            try {
              const session = await getSessionForCharacter(char.id);
              if (!session || session.messages.length === 0) {
                appendLog('info', 'No chat history for this character.');
              } else {
                const lines = session.messages.map(
                  (m: {role: string; content: string}) => `[${m.role}] ${m.content.slice(0, 120)}${m.content.length > 120 ? '...' : ''}`,
                );
                appendLog('output', `History for ${char.name} (${session.messages.length} messages):\n${lines.join('\n')}`);
              }
            } catch (e) {
              appendLog('error', `Failed to load history: ${e}`);
            }
            break;
          }

          case 'config': {
            const config = await loadPromptConfig();
            appendLog(
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
                `RAG Model:     ${config.ragModel || '(uses main model)'}`,
                `RAG Enabled:   ${config.ragEnabled ? 'yes' : 'no'}`,
                `RAG Max Entry: ${config.ragMaxEntriesToSend}`,
                `RAG Max Res:   ${config.ragMaxResults}`,
              ].join('\n'),
            );
            break;
          }

          case 'config.set': {
            const key = rest[0]?.toLowerCase();
            const value = rest.slice(1).join(' ');
            if (!key || !value) {
              appendLog('error', 'Usage: config.set <prefix|suffix|usr|model|apiurl|apikey|cutoffmode|cutoffamount> <value>');
              break;
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
                appendLog('error', 'cutoffmode must be "tokens" or "messages"');
                break;
              }
              config.historyCutoffMode = value;
            } else if (key === 'cutoffamount' || key === 'amount') {
              config.historyCutoffAmount = value;
            } else {
              appendLog('error', `Unknown key "${key}". Use: prefix, suffix, usr, model, apiurl, apikey, cutoffmode, cutoffamount`);
              break;
            }
            await savePromptConfig(config);
            appendLog('output', `Updated ${key}.`);
            break;
          }

          case 'storage': {
            const sub = rest[0]?.toLowerCase();
            if (sub === 'set') {
              const key = rest[1];
              const value = rest.slice(2).join(' ');
              if (!key || !value) {
                appendLog('error', 'Usage: storage.set <key> <value>');
                break;
              }
              setKV(key, value);
              appendLog('output', `Set "${key}" = "${value}"`);
            } else if (sub === 'keys') {
              const allKeys = getAllKVKeys();
              appendLog('output', `Keys (${allKeys.length}):\n${allKeys.map(k => '  ' + k).join('\n')}`);
            } else if (sub) {
              const value = getKV(sub);
              appendLog('output', value !== null ? `${sub} = ${value}` : `${sub} not found`);
            } else {
              appendLog('error', 'Usage: storage <key> | storage.set <key> <value> | storage.keys');
            }
            break;
          }

          case 'providers': {
            const providers = getProviders();
            const activeId = getActiveProviderId();
            if (providers.length === 0) {
              appendLog('info', 'No providers configured.');
            } else {
              const lines = await Promise.all(providers.map(async p => {
                const key = await getProviderKey(p.id);
                const masked = key ? maskKey(key) : '(none)';
                const active = p.id === activeId ? ' [ACTIVE]' : '';
                return `  [${p.id}] ${p.name}${active}\n    URL: ${p.url}\n    Key: ${masked}`;
              }));
              appendLog('output', `Providers (${providers.length}):\n${lines.join('\n')}`);
            }
            break;
          }

          case 'provider': {
            const sub = rest[0]?.toLowerCase();
            if (sub === 'active') {
              const activeId = getActiveProviderId();
              if (!activeId) {
                appendLog('info', 'No active provider set.');
              } else {
                const providers = getProviders();
                const p = providers.find(x => x.id === activeId);
                if (p) {
                  const key = await getProviderKey(p.id);
                  appendLog('output', `Active: ${p.name}\nURL: ${p.url}\nKey: ${key ? maskKey(key) : '(none)'}`);
                } else {
                  appendLog('output', `Active ID: ${activeId} (provider not found)`);
                }
              }
              break;
            }
            if (sub === 'key') {
              const id = rest[1];
              if (!id) {
                appendLog('error', 'Usage: provider.key <id>');
                break;
              }
              const key = await getProviderKey(id);
              appendLog('output', key ? `Key: ${maskKey(key)}\nLength: ${key.length}` : 'No key found for this provider.');
              break;
            }
            appendLog('error', 'Usage: provider <active|key <id>>');
            break;
          }

          case 'lorebooks': {
            const lorebooks = await getAllLorebooksFromDB();
            if (lorebooks.length === 0) {
              appendLog('info', 'No lorebooks found.');
            } else {
              const lines = lorebooks.map(
                l => `  [${l.id}] ${l.fileName} — ${l.entries.length} entries`,
              );
              appendLog('output', `Lorebooks (${lorebooks.length}):\n${lines.join('\n')}`);
            }
            break;
          }

          case 'lorebook': {
            const id = rest[0];
            if (!id) {
              appendLog('error', 'Usage: lorebook <id>');
              break;
            }
            const lorebooks = await getAllLorebooksFromDB();
            const lb = lorebooks.find(l => l.id === id || l.fileName.toLowerCase().startsWith(id.toLowerCase()));
            if (!lb) {
              appendLog('error', `Lorebook "${id}" not found.`);
              break;
            }
            const lines = lb.entries.map(e => `  ${e.id + 1}. ${e.text.slice(0, 100)}${e.text.length > 100 ? '...' : ''}`);
            appendLog('output', `${lb.fileName} (${lb.entries.length} entries):\n${lines.join('\n')}`);
            break;
          }

          case 'settings': {
            const s = appSettings;
            appendLog(
              'output',
              [
                `Theme Mode:      ${s.themeMode}`,
                `BG Primary:      ${s.bgPrimary}`,
                `BG Secondary:    ${s.bgSecondary}`,
                `BG Pill:         ${s.bgPill}`,
                `Border:          ${s.borderPrimary}`,
                `Text Primary:    ${s.textPrimary}`,
                `Text Secondary:  ${s.textSecondary}`,
                `Text Muted:      ${s.textMuted}`,
                `Accent:          ${s.accentColor}`,
                `User Bubble:     ${s.userBubbleBg}`,
                `Card Radius:     ${s.cardRadius}`,
                `Pill Radius:     ${s.pillRadius}`,
                `Bubble Radius:   ${s.bubbleRadius}`,
                `Chat Max Width:  ${s.chatMaxWidth}%`,
                `Font Body:       ${s.fontSizeBody}`,
                `Font Header:     ${s.fontSizeHeader}`,
                `Font Tab:        ${s.fontSizeTab}`,
                `Bottom Bar Pad:  ${s.bottomBarPad}`,
                `Side Btn Size:   ${s.sideBtnSize}`,
                `Input Radius:    ${s.inputRadius}`,
                `Send Btn Size:   ${s.sendBtnSize}`,
                `Show Char Icons: ${s.showCharacterIcons}`,
              ].join('\n'),
            );
            break;
          }

          case 'tiktoken': {
            const testText = rest.length > 0
              ? rest.join(' ')
              : 'The quick brown fox jumps over the lazy dog. Hello world!';

            appendLog('info', `Testing tiktoken with text: "${testText.slice(0, 60)}${testText.length > 60 ? '...' : ''}"`);

            try {
              const {encodingForModel} = await import('js-tiktoken');
              const enc = encodingForModel('gpt-4o');

              const t0 = performance.now();
              const tokens = enc.encode(testText);
              const encodeMs = (performance.now() - t0).toFixed(2);

              const t1 = performance.now();
              const decoded = enc.decode(tokens);
              const decodeMs = (performance.now() - t1).toFixed(2);

              const fallbackTokens = Math.ceil(testText.length / 4);

              const firstFew = tokens.slice(0, 10).map(id => enc.decode([id]).replace(/\n/g, '\\n'));

              appendLog('output', [
                '─'.repeat(40),
                `Text length:   ${testText.length} chars`,
                `Token count:   ${tokens.length} tokens`,
                `Encode time:   ${encodeMs}ms`,
                `Decode time:   ${decodeMs}ms`,
                '',
                `Fallback (÷4): ${fallbackTokens} tokens`,
                `Accuracy:      ${Math.abs(tokens.length - fallbackTokens) <= 2 ? 'CLOSE' : 'DIFFERS'} (tiktoken=${tokens.length}, fallback=${fallbackTokens})`,
                '',
                `First 10 tokens (${tokens.slice(0, 10).join(', ')}):`,
                `  Decoded: ${firstFew.join(' | ')}`,
                '',
                `Roundtrip OK:  ${decoded === testText ? 'YES' : 'NO'}`,
                '─'.repeat(40),
              ].join('\n'));
            } catch (e: unknown) {
              appendLog('error', `tiktoken FAILED: ${e instanceof Error ? e.message : String(e)}`);
              appendLog('info', 'The divide-by-4 fallback is being used. tiktoken may not work in this environment.');
            }
            break;
          }

          case 'crash': {
            appendLog('info', 'Triggering crash export...');
            const path = await crashExport();
            if (path) {
              appendLog('output', `Crash export saved to: ${path}`);
            } else {
              appendLog('error', 'Crash export failed.');
            }
            break;
          }

          case 'unlock': {
            const sub = rest[0]?.toLowerCase();
            if (sub === 'sysstats') {
              toggleSysStats();
              appendLog('output', 'System stats overlay toggled.');
            } else {
              appendLog('error', 'Usage: unlock sysstats');
            }
            break;
          }

          case 'encrypt': {
            const sub = rest[0]?.toLowerCase();
            if (sub === 'help' || !sub) {
              appendLog('info', [
                'Encryption Commands:',
                '  encrypt <text>                    Encrypt text and show ciphertext',
                '  decrypt <hex>                     Decrypt hex ciphertext and show plaintext',
                '  encrypt roundtrip <text>          Encrypt then decrypt, verify roundtrip',
                '  encrypt test                      Run full encryption test suite',
              ].join('\n'));
              break;
            }
            if (sub === 'test') {
              try {
                const testCases = [
                  'Hello, world!',
                  '',
                  'A longer string with special chars: !@#$%^&*()_+-=[]{}|;:,.<>?/~`',
                  'Unicode: 你好世界 🎉 émojis ñ',
                  'a'.repeat(1000),
                ];
                let passed = 0;
                let failed = 0;
                for (const tc of testCases) {
                  const enc = await encryptText(tc);
                  const dec = await decryptText(enc);
                  if (dec === tc) {
                    passed++;
                  } else {
                    failed++;
                    appendLog('error', `FAIL: roundtrip mismatch for "${tc.slice(0, 50)}..."`);
                    appendLog('error', `  expected: ${tc}`);
                    appendLog('error', `  got:      ${dec}`);
                  }
                }
                appendLog('output', `Encryption test: ${passed} passed, ${failed} failed`);
                if (failed === 0) {
                  appendLog('output', 'All roundtrip tests passed. AES-256-GCM encryption is working correctly.');
                }
              } catch (e: unknown) {
                appendLog('error', `Encryption test failed: ${e instanceof Error ? e.message : String(e)}`);
              }
              break;
            }
            if (sub === 'roundtrip') {
              const text = rest.slice(1).join(' ');
              if (!text) {
                appendLog('error', 'Usage: encrypt roundtrip <text>');
                break;
              }
              try {
                const enc = await encryptText(text);
                const dec = await decryptText(enc);
                const match = dec === text;
                appendLog('output', [
                  `Encrypted:  ${enc.slice(0, 80)}${enc.length > 80 ? '...' : ''} (${enc.length} chars)`,
                  `Decrypted:  ${dec}`,
                  `Roundtrip:  ${match ? 'OK' : 'MISMATCH'}`,
                ].join('\n'));
                if (!match) {
                  appendLog('error', 'Roundtrip failed! Decrypted output does not match input.');
                }
              } catch (e: unknown) {
                appendLog('error', `Encrypt/decrypt failed: ${e instanceof Error ? e.message : String(e)}`);
              }
              break;
            }
            if (sub === 'decrypt') {
              const hex = rest.slice(1).join(' ');
              if (!hex) {
                appendLog('error', 'Usage: encrypt decrypt <hex>');
                break;
              }
              try {
                const dec = await decryptText(hex);
                appendLog('output', `Decrypted: ${dec}`);
              } catch (e: unknown) {
                appendLog('error', `Decrypt failed: ${e instanceof Error ? e.message : String(e)}`);
              }
              break;
            }
            const text = rest.join(' ');
            if (!text) {
              appendLog('error', 'Usage: encrypt <text>');
              break;
            }
            try {
              const enc = await encryptText(text);
              appendLog('output', [
                `Encrypted: ${enc}`,
                `Length:    ${enc.length} chars`,
              ].join('\n'));
            } catch (e: unknown) {
              appendLog('error', `Encrypt failed: ${e instanceof Error ? e.message : String(e)}`);
            }
            break;
          }

          case 'db': {
            const sub = rest[0]?.toLowerCase();

            if (!sub || sub === 'help') {
              appendLog('info', [
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
              ].join('\n'));
              break;
            }

            if (sub === 'info') {
              const info = getDBInfo();
              const journalResult = getDbConnection().execute('PRAGMA journal_mode');
              const journalMode = journalResult.results?.[0]?.journal_mode as string ?? '?';
              appendLog('output', `Sessions: ${info.sessionCount}\nMessages: ${info.messageCount}\nJournal:  ${journalMode}`);
              break;
            }

            if (sub === 'tables') {
              const d = getDbConnection();
              const tables = d.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
              if (!tables.results || tables.results.length === 0) {
                appendLog('info', 'No tables found.');
                break;
              }
              const lines: string[] = [];
              for (const row of tables.results) {
                const name = row.name as string;
                const count = d.execute(`SELECT COUNT(*) as count FROM "${name}"`);
                const cnt = count.results?.[0]?.count as number ?? 0;
                lines.push(`  ${name}: ${cnt} rows`);
              }
              appendLog('output', `Tables:\n${lines.join('\n')}`);
              break;
            }

            if (sub === 'schema') {
              const table = rest[1];
              if (!table) {
                appendLog('error', 'Usage: db schema <table>');
                break;
              }
              const d = getDbConnection();
              const result = d.execute(`PRAGMA table_info("${table}")`);
              if (!result.results || result.results.length === 0) {
                appendLog('error', `Table "${table}" not found.`);
                break;
              }
              const lines = result.results.map(row =>
                `  ${row.name} ${row.type}${row.notnull ? ' NOT NULL' : ''}${row.dflt_value !== null ? ` DEFAULT ${row.dflt_value}` : ''}${row.pk ? ' PRIMARY KEY' : ''}`
              );
              appendLog('output', `Schema for ${table}:\n${lines.join('\n')}`);
              break;
            }

            if (sub === 'lookat') {
              const query = rest[1];
              if (!query) {
                appendLog('error', 'Usage: db lookat <character>');
                break;
              }
              const char = findCharacter(characters, query);
              if (!char) {
                appendLog('error', `Character "${query}" not found.`);
                break;
              }
              const session = getDbConnection().execute(
                'SELECT id, created_at, updated_at FROM chat_sessions WHERE character_id = ?',
                [char.id],
              );
              if (!session.results || session.results.length === 0) {
                appendLog('info', `No session for ${char.name}.`);
                break;
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
              appendLog('output', `Character: ${char.name} (${char.id})\n\n${lines.join('\n\n')}`);
              break;
            }

            if (sub === 'lookfor') {
              const query = rest.slice(1).join(' ');
              if (!query) {
                appendLog('error', 'Usage: db lookfor <query>');
                break;
              }
              const results = await searchMessages(query);
              if (results.length === 0) {
                appendLog('info', `No messages matching "${query}".`);
                break;
              }
              const lines = results.map(
                r => `  [${r.role}] ${r.content.slice(0, 100)}${r.content.length > 100 ? '...' : ''}`,
              );
              appendLog('output', `Results (${results.length}):\n${lines.join('\n')}`);
              break;
            }

            if (sub === 'sessions') {
              const d = getDbConnection();
              const result = d.execute(
                'SELECT s.id, s.character_id, s.created_at, s.updated_at, COUNT(m.id) as msg_count FROM chat_sessions s LEFT JOIN chat_messages m ON m.session_id = s.id GROUP BY s.id ORDER BY s.updated_at DESC',
              );
              if (!result.results || result.results.length === 0) {
                appendLog('info', 'No sessions found.');
                break;
              }
              const lines = result.results.map(row => {
                const charName = characters.find(c => c.id === row.character_id)?.name || '?';
                return `  [${row.id}] ${charName} — ${row.msg_count} msgs — updated ${new Date(row.updated_at as number).toLocaleString()}`;
              });
              appendLog('output', `Sessions (${result.results.length}):\n${lines.join('\n')}`);
              break;
            }

            if (sub === 'cleanup') {
              appendLog('info', 'Removing all stress test data...');
              const cleanupStart = performance.now();
              const result = deleteAllByPrefix('_stress_');
              const cleanupMs = (performance.now() - cleanupStart).toFixed(0);
              appendLog('output', `Cleanup done in ${cleanupMs}ms — removed ${result.messages} messages, ${result.sessions} sessions`);
              break;
            }

            if (sub === 'stress') {
              const sizeArg = rest[1];
              if (!sizeArg) {
                appendLog('error', 'Usage: db stress size:<MB> or db stress entries:<N>');
                break;
              }

              let targetEntries = 0;
              let targetBytes = 0;
              const isSize = sizeArg.toLowerCase().startsWith('size:');
              const isEntries = sizeArg.toLowerCase().startsWith('entries:');

              if (isSize) {
                const mb = parseFloat(sizeArg.split(':')[1]);
                if (isNaN(mb) || mb <= 0) {
                  appendLog('error', 'Invalid size. Example: db stress size:8');
                  break;
                }
                targetBytes = mb * 1024 * 1024;
                targetEntries = Math.ceil(targetBytes / 300);
              } else if (isEntries) {
                targetEntries = parseInt(sizeArg.split(':')[1], 10);
                if (isNaN(targetEntries) || targetEntries <= 0) {
                  appendLog('error', 'Invalid entry count. Example: db stress entries:1000');
                  break;
                }
              } else {
                appendLog('error', 'Usage: db stress size:<MB> or db stress entries:<N>');
                break;
              }

              const d = getDbConnection();
              const stressPrefix = '_stress_';
              const msgsPerSession = 10;
              const totalSessions = Math.ceil(targetEntries / msgsPerSession);
              const t0 = performance.now();

              const yieldToUI = () => new Promise<void>(r => setTimeout(r, 0));

              appendLog('info', `Stress test: ${isSize ? `~${targetEntries} entries (${sizeArg.split(':')[1]}MB)` : `${targetEntries} entries`}`);

              appendLog('info', 'Phase 1: Inserting (batched)...');
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
                  appendLog('info', `  ... ${inserted}/${targetEntries} entries`);
                  await yieldToUI();
                }
              }
              const insertMs = (performance.now() - insertStart).toFixed(0);
              appendLog('output', `Bulk insert: ${insertMs}ms (${inserted} rows in batched transactions)`);

              appendLog('info', 'Phase 2: Single-row insert benchmark...');
              const benchId = `${stressPrefix}_bench_${Date.now()}`;
              const singleInsertStart = performance.now();
              d.execute(
                'INSERT INTO chat_messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
                [benchId, firstSessionId, 'user', 'Benchmark row', Date.now()],
              );
              const singleInsertMs = (performance.now() - singleInsertStart).toFixed(1);
              appendLog('output', `Single insert: ${singleInsertMs}ms (1 row, auto-commit)`);

              appendLog('info', 'Phase 3: Reading back...');
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
              appendLog('output', `Read: ${readMs}ms (${readCount}/${sampleSize} verified)`);

              appendLog('info', 'Phase 4: Updating...');
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
              appendLog('output', `Bulk update: ${updateMs}ms (${updateCount} rows)`);

              const singleUpdateStart = performance.now();
              d.execute(
                'UPDATE chat_messages SET content = ? WHERE id = ?',
                ['Benchmark updated', benchId],
              );
              const singleUpdateMs = (performance.now() - singleUpdateStart).toFixed(1);
              appendLog('output', `Single update: ${singleUpdateMs}ms (1 row, auto-commit)`);

              appendLog('info', 'Phase 5: Deleting half...');
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
              appendLog('output', `Delete: ${deleteMs}ms (${deleteCount} rows)`);

              appendLog('info', 'Phase 6: Cleaning up...');
              const cleanupStart = performance.now();
              const cleanup = deleteAllByPrefix(stressPrefix);
              const cleanupMs = (performance.now() - cleanupStart).toFixed(0);
              appendLog('output', `Cleanup: ${cleanupMs}ms (${cleanup.messages} msgs, ${cleanup.sessions} sessions)`);

              const totalMs = (performance.now() - t0).toFixed(0);
              appendLog('output', [
                '─'.repeat(40),
                `DONE — ${inserted} entries in ${totalMs}ms`,
                `  Bulk insert:    ${insertMs}ms (${inserted} rows)`,
                `  Single insert:  ${singleInsertMs}ms (1 row)`,
                `  Read:           ${readMs}ms (${readCount}/${sampleSize})`,
                `  Bulk update:    ${updateMs}ms (${updateCount} rows)`,
                `  Single update:  ${singleUpdateMs}ms (1 row)`,
                `  Delete:         ${deleteMs}ms (${deleteCount} rows)`,
                `  Cleanup:        ${cleanupMs}ms`,
                '─'.repeat(40),
              ].join('\n'));
              break;
            }

            appendLog('error', `Unknown DB subcommand: "${sub}". Type "help db" for available commands.`);
            break;
          }

          default: {
            appendLog('error', `Unknown command: "${cmd}". Type "help" for available commands.`);
          }
        }
      } catch (e: unknown) {
        appendLog('error', `Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [characters, appSettings, appendLog, enableVerbose, disableVerbose, toggleSysStats],
  );

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) {
      return;
    }
    setInput('');
    executeCommand(text);
  };

  const renderLogEntry = ({item}: {item: LogEntry}) => {
    const textStyle = item.type === 'input'
      ? st.debugLogInput
      : item.type === 'output'
      ? st.debugLogOutput
      : item.type === 'error'
      ? st.debugLogError
      : st.debugLogInfo;

    return (
      <View style={st.debugLogEntry}>
        <Text style={textStyle}>
          {item.text}
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={st.debugScreen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}>
      {/* Header */}
      <View style={st.debugHeader}>
        <TouchableOpacity onPress={onClose} style={st.debugClose}>
          <Text style={st.debugCloseText}>Close</Text>
        </TouchableOpacity>
        <Text style={st.debugTitle}>
          Debugger
        </Text>
      </View>

      {/* Output */}
      <FlatList
        ref={flatListRef}
        data={log}
        keyExtractor={item => item.id}
        renderItem={renderLogEntry}
        contentContainerStyle={st.debugOutput}
        style={st.debugFlatList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({animated: false})}
        onLayout={() => flatListRef.current?.scrollToEnd({animated: false})}
      />

      {/* Input */}
      <View style={[st.debugInputBar, {paddingBottom: bottomInset}]}>
        <TextInput
          style={st.debugTextInput}
          value={input}
          onChangeText={setInput}
          placeholder="$ "
          placeholderTextColor="#444"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={handleSubmit}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={st.debugSendBtn}
          onPress={handleSubmit}>
          <Text style={st.debugSendBtnText}>{'›'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

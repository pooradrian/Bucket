import axios, {AxiosRequestConfig} from 'axios';
import {loadPromptConfig} from '../PromptHandler';
import {crashExport} from '../CrashExport';
import {encrypt, decrypt} from '../Crypto';
import {
  getEvents,
  loadPersistedEvents,
  clearEvents,
  isLoggingEnabled,
} from '../EventLogger';
import {CommandHandler} from './types';

export const testCommand: CommandHandler = async (rest, env, io) => {
  const verboseFlag = rest.includes('--verbose');
  if (verboseFlag && !env.isVerbose()) {
    env.enableVerbose();
  }
  const config = await loadPromptConfig();
  const url = config.apiUrl?.trim();
  const key = config.apiKey?.trim();

  io.log('info', 'Running diagnostics...');

  if (!url) {
    io.log('error', 'FAIL: No API URL configured. Run: config.set apiurl <url>');
    return;
  }
  io.log('info', `URL:  ${url}`);
  io.log('info', `Key:  ${key ? key.slice(0, 8) + '...' + key.slice(-4) : '(none)'}`);
  io.log('info', `Model: ${config.model}`);

  const baseUrl = url.replace(/\/chat\/completions\/?$/, '').replace(/\/v1\/?$/, '');
  io.log('info', `\nTesting connectivity to ${baseUrl} ...`);
  try {
    const t0 = performance.now();
    const res = await axios.get(baseUrl, {timeout: 8000});
    const ms = (performance.now() - t0).toFixed(0);
    io.log('output', `Connected in ${ms}ms — status ${res.status}`);
  } catch (e: unknown) {
    const msg = axios.isCancel(e)
      ? 'Timed out after 8s'
      : e instanceof Error ? e.message : String(e);
    io.log('error', `FAIL: Could not reach server — ${msg}`);
    io.log('info', 'Check that the URL is correct and reachable from your device.');
    return;
  }

  io.log('info', '\nSending minimal test POST (streaming)...');
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
            io.log('output', `First token in ${(performance.now() - t0).toFixed(0)}ms`);
          }
        }
      },
    });
    const ms = (performance.now() - t0).toFixed(0);
    io.log('output', `\nDone in ${ms}ms (${chunks} chunks) — streaming works.`);
  } catch (e: unknown) {
    const msg = axios.isCancel(e)
      ? 'Timed out'
      : e instanceof Error ? e.message : String(e);
    io.log('error', `FAIL: POST failed — ${msg}`);
  }
};

export const apiCommand: CommandHandler = async (rest, env, io) => {
  const method = rest[0]?.toUpperCase();
  const url = rest[1];
  if (!method || !url) {
    io.log('error', 'Usage: api <GET|POST|PUT|DELETE> <url> [--body <json>]');
    return;
  }
  const bodyIdx = rest.indexOf('--body');
  let body: string | undefined;
  if (bodyIdx !== -1) {
    body = rest.slice(bodyIdx + 1).join(' ');
  }
  io.log('info', `${method} ${url}${body ? '\nBody: ' + body : ''}`);
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
  io.log('output', formatted);
};

export const tiktokenCommand: CommandHandler = async (rest, env, io) => {
  const testText = rest.length > 0
    ? rest.join(' ')
    : 'The quick brown fox jumps over the lazy dog. Hello world!';

  io.log('info', `Testing tiktoken with text: "${testText.slice(0, 60)}${testText.length > 60 ? '...' : ''}"`);

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

    io.log('output', [
      '\u2500'.repeat(40),
      `Text length:   ${testText.length} chars`,
      `Token count:   ${tokens.length} tokens`,
      `Encode time:   ${encodeMs}ms`,
      `Decode time:   ${decodeMs}ms`,
      '',
      `Fallback (\u00f74): ${fallbackTokens} tokens`,
      `Accuracy:      ${Math.abs(tokens.length - fallbackTokens) <= 2 ? 'CLOSE' : 'DIFFERS'} (tiktoken=${tokens.length}, fallback=${fallbackTokens})`,
      '',
      `First 10 tokens (${tokens.slice(0, 10).join(', ')}):`,
      `  Decoded: ${firstFew.join(' | ')}`,
      '',
      `Roundtrip OK:  ${decoded === testText ? 'YES' : 'NO'}`,
      '\u2500'.repeat(40),
    ].join('\n'));
  } catch (e: unknown) {
    io.log('error', `tiktoken FAILED: ${e instanceof Error ? e.message : String(e)}`);
    io.log('info', 'The divide-by-4 fallback is being used. tiktoken may not work in this environment.');
  }
};

export const crashCommand: CommandHandler = async (rest, env, io) => {
  io.log('info', 'Triggering crash export...');
  const path = await crashExport();
  if (path) {
    io.log('output', `Crash export saved to: ${path}`);
  } else {
    io.log('error', 'Crash export failed.');
  }
};

export const unlockCommand: CommandHandler = (rest, env, io) => {
  const sub = rest[0]?.toLowerCase();
  if (sub === 'sysstats') {
    env.toggleSysStats();
    io.log('output', 'System stats overlay toggled.');
  } else {
    io.log('error', 'Usage: unlock sysstats');
  }
};

export const activityCommand: CommandHandler = (rest, env, io) => {
  const sub = rest[0]?.toLowerCase();
  if (sub === 'clear') {
    clearEvents();
    io.log('output', 'Activity log cleared.');
    return;
  }
  if (sub === 'status') {
    io.log('output', isLoggingEnabled() ? 'Activity logging is ON (toggle in Settings > Developer).' : 'Activity logging is OFF (toggle in Settings > Developer).');
    return;
  }
  const limit = sub ? parseInt(sub, 10) : 20;
  const count = isNaN(limit) || limit < 1 ? 20 : Math.min(limit, 200);
  const events = getEvents(count);
  const persisted = loadPersistedEvents();
  const all = events.length > 0 ? events : persisted.slice(-count).reverse();
  if (all.length === 0) {
    io.log('info', isLoggingEnabled() ? 'No activity yet. Perform some actions and they will appear here.' : 'Activity logging is disabled. Enable it in Settings > Developer first.');
  } else {
    const lines = all.map(e => {
      const ts = new Date(e.timestamp).toLocaleTimeString();
      return `  ${ts}  ${e.summary}`;
    });
    io.log('output', `Activity (last ${all.length}):\n${lines.join('\n')}`);
  }
};

export const encryptCommand: CommandHandler = async (rest, env, io) => {
  const sub = rest[0]?.toLowerCase();
  if (sub === 'help' || !sub) {
    io.log('info', [
      'Encryption Commands:',
      '  encrypt <text>                    Encrypt text and show ciphertext',
      '  decrypt <hex>                     Decrypt hex ciphertext and show plaintext',
      '  encrypt roundtrip <text>          Encrypt then decrypt, verify roundtrip',
      '  encrypt test                      Run full encryption test suite',
    ].join('\n'));
    return;
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
        const enc = await encrypt(tc);
        const dec = await decrypt(enc);
        if (dec === tc) {
          passed++;
        } else {
          failed++;
          io.log('error', `FAIL: roundtrip mismatch for "${tc.slice(0, 50)}..."`);
          io.log('error', `  expected: ${tc}`);
          io.log('error', `  got:      ${dec}`);
        }
      }
      io.log('output', `Encryption test: ${passed} passed, ${failed} failed`);
      if (failed === 0) {
        io.log('output', 'All roundtrip tests passed. AES-256-GCM encryption is working correctly.');
      }
    } catch (e: unknown) {
      io.log('error', `Encryption test failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }
  if (sub === 'roundtrip') {
    const text = rest.slice(1).join(' ');
    if (!text) {
      io.log('error', 'Usage: encrypt roundtrip <text>');
      return;
    }
    try {
      const enc = await encrypt(text);
      const dec = await decrypt(enc);
      const match = dec === text;
      io.log('output', [
        `Encrypted:  ${enc.slice(0, 80)}${enc.length > 80 ? '...' : ''} (${enc.length} chars)`,
        `Decrypted:  ${dec}`,
        `Roundtrip:  ${match ? 'OK' : 'MISMATCH'}`,
      ].join('\n'));
      if (!match) {
        io.log('error', 'Roundtrip failed! Decrypted output does not match input.');
      }
    } catch (e: unknown) {
      io.log('error', `Encrypt/decrypt failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }
  if (sub === 'decrypt') {
    const hex = rest.slice(1).join(' ');
    if (!hex) {
      io.log('error', 'Usage: encrypt decrypt <hex>');
      return;
    }
    try {
      const dec = await decrypt(hex);
      io.log('output', `Decrypted: ${dec}`);
    } catch (e: unknown) {
      io.log('error', `Decrypt failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }
  const text = rest.join(' ');
  if (!text) {
    io.log('error', 'Usage: encrypt <text>');
    return;
  }
  try {
    const enc = await encrypt(text);
    io.log('output', [
      `Encrypted: ${enc}`,
      `Length:    ${enc.length} chars`,
    ].join('\n'));
  } catch (e: unknown) {
    io.log('error', `Encrypt failed: ${e instanceof Error ? e.message : String(e)}`);
  }
};

export const settingsCommand: CommandHandler = (rest, env, io) => {
  const s = env.appSettings;
  io.log(
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
};

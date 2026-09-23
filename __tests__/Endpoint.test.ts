jest.mock('react-native-nitro-sqlite', () => ({open: jest.fn()}));
jest.mock('axios', () =>
  Object.assign(jest.fn(), {
    isCancel: jest.fn(() => false),
    post: jest.fn(),
  }),
);
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: {},
  saveDocuments: jest.fn(),
  isKnownType: jest.fn(),
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: {},
}));

import axios from 'axios';
import {getAIResponse, chatCompletionsUrl, embeddingsUrl, isPlainHttpUrl, normalizeProviderUrl, parseThinkCommand} from '../src/Endpoint';
import {splitThinking} from '../src/thinking';
import {DEFAULT_PROMPT_CONFIG} from '../src/PromptHandler';
import type {ChatMessageObject} from '../src/PromptHandler';

const CAT_SOUNDS = ['meow', 'merp', 'nya', 'purr'];

const catConfig = {
  ...DEFAULT_PROMPT_CONFIG,
  apiUrl: "cat's api",
};

function msg(content: string): ChatMessageObject[] {
  return [
    {role: 'system' as const, content: 'x'},
    {role: 'user' as const, content},
  ];
}

describe('built-in cat API', () => {
  test('returns one cat sound per number sent in the user message', async () => {
    const result = await getAIResponse(msg('6'), catConfig);
    const words = result.content.split(' ');
    expect(words).toHaveLength(6);
    for (const w of words) {
      expect(CAT_SOUNDS).toContain(w);
    }
  });

  test('streams each word as a token ending in a space except the last', async () => {
    const tokens: string[] = [];
    const result = await getAIResponse(msg('4'), catConfig, t => tokens.push(t), true);
    expect(tokens).toHaveLength(4);
    expect(tokens[0]).toMatch(/^meow|merp|nya|purr $/);
    expect(tokens[3]).not.toMatch(/ $/);
    expect(result.content).toBe(tokens.join(''));
  });

  test('matches the URL case-insensitively', async () => {
    const result = await getAIResponse(
      msg('2'),
      {...catConfig, apiUrl: "CAT'S API"},
    );
    expect(result.content.split(' ')).toHaveLength(2);
  });

  test('is trimmed of surrounding whitespace', async () => {
    const result = await getAIResponse(
      msg('2'),
      {...catConfig, apiUrl: "  cat's api  "},
    );
    expect(result.content.split(' ')).toHaveLength(2);
  });

  test('falls back to three sounds when no number is sent', async () => {
    const result = await getAIResponse(msg('hello'), catConfig);
    expect(result.content.split(' ')).toHaveLength(3);
  });

  test('does not cap the word count', async () => {
    const result = await getAIResponse(msg('10000'), catConfig, undefined, false);
    expect(result.content.split(' ')).toHaveLength(10000);
  });

  test('non-streaming returns the words immediately', async () => {
    const result = await getAIResponse(msg('3'), catConfig, undefined, false);
    expect(result.content.split(' ')).toHaveLength(3);
  });

  test('cancellation rejects with Request was cancelled', async () => {
    const ctrl = new AbortController();
    const pending = getAIResponse(msg('100'), catConfig, undefined, true, ctrl);
    ctrl.abort();
    await expect(pending).rejects.toThrow('Request was cancelled');
  });
});

describe('embeddingsUrl', () => {
  test('replaces /chat/completions with /embeddings', () => {
    expect(embeddingsUrl('http://h:8080/v1/chat/completions')).toBe('http://h:8080/v1/embeddings');
  });

  test('handles trailing slashes and whitespace', () => {
    expect(embeddingsUrl('  http://h/v1/chat/completions/  ')).toBe('http://h/v1/embeddings');
  });

  test('appends to a bare versioned base', () => {
    expect(embeddingsUrl('http://h/v1')).toBe('http://h/v1/embeddings');
  });

  test('appends to an unversioned URL', () => {
    expect(embeddingsUrl('http://h:8080')).toBe('http://h:8080/embeddings');
  });
});

describe('chatCompletionsUrl', () => {
  test('keeps a full completions URL as-is', () => {
    expect(chatCompletionsUrl('https://api.openai.com/v1/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
  });

  test('appends to a versioned or bare base, trimming slashes', () => {
    expect(chatCompletionsUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
    expect(chatCompletionsUrl('http://h:8080/')).toBe('http://h:8080/v1/chat/completions');
  });
});

describe('normalizeProviderUrl', () => {
  test('leaves the cat API url alone', () => {
    expect(normalizeProviderUrl("cat's api")).toBe("cat's api");
    expect(normalizeProviderUrl("  CAT'S API  ")).toBe("CAT'S API");
  });

  test('repairs a previously mangled cat API url', () => {
    expect(normalizeProviderUrl("cat's api/v1/chat/completions")).toBe("cat's api");
  });

  test('normalizes real urls and passes through empties', () => {
    expect(normalizeProviderUrl('http://h:8080')).toBe('http://h:8080/v1/chat/completions');
    expect(normalizeProviderUrl('')).toBe('');
  });
});
describe('isPlainHttpUrl', () => {
  test('flags http but not https', () => {
    expect(isPlainHttpUrl('http://192.168.1.2:8080')).toBe(true);
    expect(isPlainHttpUrl('  HTTP://h/v1 ')).toBe(true);
    expect(isPlainHttpUrl('https://api.openai.com/v1')).toBe(false);
    expect(isPlainHttpUrl('')).toBe(false);
  });
});

describe('cat API think command', () => {
  test('parses think N M', () => {
    expect(parseThinkCommand('think 30 90')).toEqual({think: 30, answer: 90});
    expect(parseThinkCommand('please THINK 5')).toEqual({think: 5, answer: 3});
    expect(parseThinkCommand('meow 6')).toBeNull();
  });

  test('think 30 90 outputs 30 thinking sounds and 90 answer sounds', async () => {
    const result = await getAIResponse(msg('think 30 90'), catConfig, undefined, false);
    const thought = splitThinking(result.content);
    expect(thought.hasThinking).toBe(true);
    expect(thought.open).toBe(false);
    expect(thought.thinking.split(' ')).toHaveLength(30);
    expect(thought.answer.split(' ')).toHaveLength(90);
    for (const w of [...thought.thinking.split(' '), ...thought.answer.split(' ')]) {
      expect(CAT_SOUNDS).toContain(w);
    }
  });

  test('plain numbers still skip thinking', async () => {
    const result = await getAIResponse(msg('6'), catConfig, undefined, false);
    expect(splitThinking(result.content).hasThinking).toBe(false);
    expect(result.content.split(' ')).toHaveLength(6);
  });
});

const realConfig = {...DEFAULT_PROMPT_CONFIG, apiUrl: 'http://h:8080'};

let sseLines: string[] = [];
let lastBody = '';

class FakeXHR {
  responseText = '';
  status = 200;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open() {}
  setRequestHeader() {}
  abort() {}
  send(body: string) {
    lastBody = body;
    this.responseText = sseLines.join('\n') + '\n';
    this.onprogress?.();
    this.onload?.();
  }
}

function sse(payload: object): string {
  return 'data: ' + JSON.stringify(payload);
}

describe('reasoning capture', () => {
  beforeEach(() => {
    (global as {XMLHttpRequest?: unknown}).XMLHttpRequest = FakeXHR;
    sseLines = [];
    lastBody = '';
  });

  test('streams reasoning deltas wrapped in thinking tags', async () => {
    sseLines = [
      sse({choices: [{delta: {reasoning_content: 'hmm '}}]}),
      sse({choices: [{delta: {reasoning: 'and more'}}]}),
      sse({choices: [{delta: {content: 'hi there'}}]}),
      'data: [DONE]',
    ];
    const tokens: string[] = [];
    const result = await getAIResponse(msg('x'), realConfig, t => tokens.push(t), true);
    const thought = splitThinking(result.content);
    expect(thought.hasThinking).toBe(true);
    expect(thought.open).toBe(false);
    expect(thought.thinking).toBe('hmm and more');
    expect(thought.answer).toBe('hi there');
    expect(tokens.join('')).toBe(result.content);
  });

  test('content-only stream gets no thinking tags', async () => {
    sseLines = [
      sse({choices: [{delta: {content: 'plain'}}]}),
      'data: [DONE]',
    ];
    const result = await getAIResponse(msg('x'), realConfig, undefined, true);
    expect(result.content).toBe('plain');
    expect(splitThinking(result.content).hasThinking).toBe(false);
  });

  test('non-streaming wraps message.reasoning_content', async () => {
    const axiosMock = axios as unknown as jest.Mock;
    axiosMock.mockResolvedValueOnce({
      data: {choices: [{message: {content: 'answer', reasoning_content: 'deep thoughts'}}]},
    });
    const result = await getAIResponse(msg('x'), realConfig, undefined, false);
    const thought = splitThinking(result.content);
    expect(thought.hasThinking).toBe(true);
    expect(thought.thinking).toBe('deep thoughts');
    expect(thought.answer).toBe('answer');
  });
});

describe('extra body', () => {
  beforeEach(() => {
    (global as {XMLHttpRequest?: unknown}).XMLHttpRequest = FakeXHR;
    sseLines = [];
    lastBody = '';
  });

  test('merges into the sent request body', async () => {
    sseLines = [sse({choices: [{delta: {content: 'ok'}}]}), 'data: [DONE]'];
    await getAIResponse(
      msg('x'),
      {...realConfig, extraBody: '{"reasoning_effort":"high"}'},
      undefined,
      true,
    );
    const body = JSON.parse(lastBody);
    expect(body.reasoning_effort).toBe('high');
    expect(body.model).toBe(realConfig.model);
    expect(body.stream).toBe(true);
    expect(body.temperature).toBe(1);
  });

  test('rejects invalid JSON', async () => {
    await expect(
      getAIResponse(msg('x'), {...realConfig, extraBody: 'nope'}, undefined, true),
    ).rejects.toThrow('Extra body must be valid JSON');
  });

  test('rejects non-object JSON', async () => {
    await expect(
      getAIResponse(msg('x'), {...realConfig, extraBody: '[1]'}, undefined, true),
    ).rejects.toThrow('Extra body must be a valid JSON object');
  });

  test('empty extra body is skipped', async () => {
    sseLines = [sse({choices: [{delta: {content: 'ok'}}]}), 'data: [DONE]'];
    const result = await getAIResponse(
      msg('x'),
      {...realConfig, extraBody: '  '},
      undefined,
      true,
    );
    expect(result.content).toBe('ok');
    expect(JSON.parse(lastBody).reasoning_effort).toBeUndefined();
  });
});

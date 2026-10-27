import RNFS from 'react-native-fs';

jest.mock('react-native-nitro-sqlite', () => ({ open: jest.fn() }));

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: {},
  keepLocalCopy: jest.fn(),
  saveDocuments: jest.fn(),
  isKnownType: jest.fn(),
}));

jest.mock('../src/Endpoint', () => ({
  getEmbeddings: jest.fn(async (inputs: string[]) =>
    inputs.map(() => [0, 1]),
  ),
}));

jest.mock('../src/LocalEmbeddings', () => ({
  embedLocal: jest.fn(async (inputs: string[]) =>
    inputs.map(text => (text.startsWith('q') ? [1, 0] : [0.6, 0.8])),
  ),
  testLocalModel: jest.fn(),
  activeLocalModel: jest.fn(() => ''),
  releaseLocalModel: jest.fn(),
}));

import { getEmbeddings } from '../src/Endpoint';
import { embedLocal } from '../src/LocalEmbeddings';
import {
  embedTexts,
  rankLorebookEntries,
  MIN_SIMILARITY,
} from '../src/RAGHandler';
import { DEFAULT_PROMPT_CONFIG } from '../src/PromptHandler';
import { formatBytes, modelFileName, modelPath } from '../src/ModelFiles';
import type { RAGConfig } from '../src/RAGHandler';

const localRag = (overrides: Partial<RAGConfig> = {}): RAGConfig => ({
  enabled: true,
  model: '',
  source: 'local',
  localModel: 'nomic.gguf',
  maxEntriesToSend: '50',
  maxResults: '5',
  ...overrides,
});

beforeEach(() => {
  (getEmbeddings as jest.Mock).mockClear();
  (embedLocal as jest.Mock).mockClear();
});

describe('embedTexts source dispatch', () => {
  test('local source embeds on device and never calls the API', async () => {
    const vectors = await embedTexts(
      ['qlocal-one', 'other-local-one'],
      localRag(),
      DEFAULT_PROMPT_CONFIG,
    );
    expect(embedLocal).toHaveBeenCalledTimes(1);
    expect(embedLocal).toHaveBeenCalledWith(
      ['qlocal-one', 'other-local-one'],
      'nomic.gguf',
    );
    expect(getEmbeddings).not.toHaveBeenCalled();
    expect(vectors).toEqual([
      [1, 0],
      [0.6, 0.8],
    ]);
  });

  test('api source still uses the remote endpoint', async () => {
    await embedTexts(
      ['api-one'],
      localRag({ source: 'api', model: 'remote-embed', localModel: '' }),
      DEFAULT_PROMPT_CONFIG,
    );
    expect(getEmbeddings).toHaveBeenCalledTimes(1);
    expect(embedLocal).not.toHaveBeenCalled();
  });

  test('cache is keyed by model, so switching models re-embeds', async () => {
    await embedTexts(['cache-local-text'], localRag(), DEFAULT_PROMPT_CONFIG);
    await embedTexts(['cache-local-text'], localRag(), DEFAULT_PROMPT_CONFIG);
    expect(embedLocal).toHaveBeenCalledTimes(1);

    await embedTexts(
      ['cache-local-text'],
      localRag({ localModel: 'bge.gguf' }),
      DEFAULT_PROMPT_CONFIG,
    );
    expect(embedLocal).toHaveBeenCalledTimes(2);
  });

  test('local vectors flow into ranking', async () => {
    const ranked = await rankLorebookEntries(
      'qquery',
      [
        { id: 0, text: 'other-a' },
        { id: 1, text: 'other-b' },
      ],
      localRag(),
      DEFAULT_PROMPT_CONFIG,
    );
    expect(ranked).toHaveLength(2);
    expect(ranked[0].score).toBeGreaterThanOrEqual(MIN_SIMILARITY);
  });

  test('a short vector response is rejected', async () => {
    (embedLocal as jest.Mock).mockResolvedValueOnce([]);
    await expect(
      embedTexts(['mismatch'], localRag(), DEFAULT_PROMPT_CONFIG),
    ).rejects.toThrow(/0 vectors for 1 inputs/);
  });
});

describe('model file names', () => {
  test('keeps plain gguf names', () => {
    expect(modelFileName('nomic-embed-text-v1.5.Q8_0.gguf')).toBe(
      'nomic-embed-text-v1.5.Q8_0.gguf',
    );
  });

  test('strips directories and adds the extension', () => {
    expect(modelFileName('/sdcard/Download/bge-small')).toBe('bge-small.gguf');
    expect(modelFileName('C:\\models\\minilm.GGUF')).toBe('minilm.GGUF');
  });

  test('replaces unsafe characters', () => {
    expect(modelFileName('a:b*c?.gguf')).toBe('a_b_c_.gguf');
  });

  test('rejects traversal outside the models directory', () => {
    expect(modelPath('../secrets.gguf')).toBeNull();
    expect(modelPath('dir/model.gguf')).toBeNull();
    expect(modelPath('')).toBeNull();
    expect(modelPath(undefined)).toBeNull();
    expect(modelPath('model.gguf')).toBe('/tmp/documents/models/model.gguf');
  });
});

describe('formatBytes', () => {
  test('formats megabytes and gigabytes', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(6 * 1024 * 1024)).toBe('6.0 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });
});

describe('runtime urls', () => {
  test('are pinned to a release tag and the device abi', () => {
    const { runtimeUrl, runtimeDir } = require('../src/EmbeddingRuntime');
    expect(runtimeUrl('libllama.so')).toBe(
      'https://github.com/pooradrian/Bucket/releases/download/embedding-runtime-v1/arm64-v8a-libllama.so',
    );
    expect(runtimeDir()).toBe(
      '/tmp/documents/embedding-runtime/v1/arm64-v8a',
    );
    expect(RNFS.DocumentDirectoryPath).toBe('/tmp/documents');
  });
});

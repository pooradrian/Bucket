import {
  NativeEmbeddingsModule,
  isRuntimeInstalled,
  loadRuntime,
} from './EmbeddingRuntime';
import { modelExists, modelPath } from './ModelFiles';

const CONTEXT_SIZE = 512;

let activeModel = '';
let activeInfo: {
  dimensions: number;
  contextSize: number;
  description: string;
  pooling: string;
} = { dimensions: 0, contextSize: 0, description: '', pooling: '' };
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.catch(() => {});
  return result;
}

export function activeLocalModel(): string {
  return activeModel;
}

export async function releaseLocalModel(): Promise<void> {
  activeModel = '';
  await NativeEmbeddingsModule.releaseModel().catch(() => {});
}

async function ensureModel(name: string): Promise<void> {
  if (activeModel === name) return;
  if (!name) {
    throw new Error('No on-device embedding model selected');
  }
  const path = modelPath(name);
  if (!path) {
    throw new Error('Invalid on-device embedding model name');
  }
  if (!(await isRuntimeInstalled())) {
    throw new Error(
      'The on-device runtime is not installed. Install it in Settings → Lorebooks & RAG.',
    );
  }
  if (!(await modelExists(name))) {
    throw new Error(`Model "${name}" is missing. Import it again in Settings.`);
  }
  activeModel = '';
  await loadRuntime();
  const info = await NativeEmbeddingsModule.loadModel(path, 0, CONTEXT_SIZE);
  activeInfo = {
    dimensions: Number(info.dimensions),
    contextSize: Number(info.contextSize),
    description: info.description,
    pooling: info.pooling,
  };
  activeModel = name;
}

export async function embedLocal(
  texts: string[],
  model: string,
): Promise<number[][]> {
  return serial(async () => {
    await ensureModel(model);
    const vectors = await NativeEmbeddingsModule.embed(texts);
    if (vectors.length !== texts.length) {
      throw new Error(
        `On-device model returned ${vectors.length} vectors for ${texts.length} inputs`,
      );
    }
    return vectors;
  });
}

export interface LocalModelProbe {
  dimensions: number;
  contextSize: number;
  description: string;
  pooling: string;
  ms: number;
}

export async function testLocalModel(
  model: string,
  text: string,
): Promise<LocalModelProbe> {
  return serial(async () => {
    const started = Date.now();
    await ensureModel(model);
    const vectors = await NativeEmbeddingsModule.embed([text]);
    return {
      dimensions: vectors[0]?.length ?? 0,
      contextSize: activeInfo.contextSize,
      description: activeInfo.description,
      pooling: activeInfo.pooling,
      ms: Date.now() - started,
    };
  });
}

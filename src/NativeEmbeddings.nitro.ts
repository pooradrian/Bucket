import { type HybridObject } from 'react-native-nitro-modules';

export interface EmbeddingModelInfo {
  dimensions: number;
  contextSize: number;
  description: string;
  pooling: string;
}

export interface NativeEmbeddings extends HybridObject<{
  ios: 'c++';
  android: 'c++';
}> {
  getAbi(): string;
  readonly runtimeLoaded: boolean;
  loadRuntime(libDir: string): Promise<string>;
  loadModel(
    path: string,
    threads: number,
    contextSize: number,
  ): Promise<EmbeddingModelInfo>;
  embed(texts: string[]): Promise<number[][]>;
  releaseModel(): Promise<void>;
}

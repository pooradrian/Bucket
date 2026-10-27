import RNFS from 'react-native-fs';
import { NitroModules } from 'react-native-nitro-modules';
import type { NativeEmbeddings } from './NativeEmbeddings.nitro';

export const NativeEmbeddingsModule =
  NitroModules.createHybridObject<NativeEmbeddings>('NativeEmbeddings');

export const RUNTIME_VERSION = 1;
const RUNTIME_TAG = `embedding-runtime-v${RUNTIME_VERSION}`;
const RUNTIME_BASE_URL = `https://github.com/pooradrian/Bucket/releases/download/${RUNTIME_TAG}`;
const LIBS = ['libggml-base.so', 'libggml-cpu.so', 'libggml.so', 'libllama.so'];

export interface RuntimeInstallProgress {
  file: string;
  index: number;
  total: number;
  bytesWritten: number;
  bytesExpected: number;
}

function abi(): string {
  return NativeEmbeddingsModule.getAbi();
}

export function runtimeDir(): string {
  return `${RNFS.DocumentDirectoryPath}/embedding-runtime/v${RUNTIME_VERSION}/${abi()}`;
}

export function runtimeUrl(file: string): string {
  return `${RUNTIME_BASE_URL}/${abi()}-${file}`;
}

export async function isRuntimeInstalled(): Promise<boolean> {
  const dir = runtimeDir();
  for (const lib of LIBS) {
    try {
      const info = await RNFS.stat(`${dir}/${lib}`);
      if (!info.size || Number(info.size) <= 0) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function installRuntime(
  onProgress?: (progress: RuntimeInstallProgress) => void,
): Promise<void> {
  const dir = runtimeDir();
  await RNFS.mkdir(dir);
  for (let i = 0; i < LIBS.length; i++) {
    const lib = LIBS[i];
    const target = `${dir}/${lib}`;
    const options = {
      fromUrl: runtimeUrl(lib),
      toFile: target,
      progress: (res: { bytesWritten: number; contentLength: number }) => {
        onProgress?.({
          file: lib,
          index: i,
          total: LIBS.length,
          bytesWritten: res.bytesWritten,
          bytesExpected: res.contentLength,
        });
      },
    };
    try {
      const result = await RNFS.downloadFile(options).promise;
      if (result.statusCode !== 200) {
        throw new Error(`HTTP ${result.statusCode}`);
      }
      const info = await RNFS.stat(target);
      if (!info.size || Number(info.size) <= 0) {
        throw new Error('downloaded file is empty');
      }
    } catch (e) {
      await RNFS.unlink(dir).catch(() => {});
      throw new Error(
        `Could not download the on-device runtime (${lib}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
  await loadRuntime();
}

export async function loadRuntime(): Promise<void> {
  await NativeEmbeddingsModule.loadRuntime(runtimeDir());
}

export async function removeRuntime(): Promise<void> {
  await NativeEmbeddingsModule.releaseModel().catch(() => {});
  await RNFS.unlink(`${RNFS.DocumentDirectoryPath}/embedding-runtime`).catch(
    () => {},
  );
}

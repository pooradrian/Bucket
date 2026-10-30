import RNFS from 'react-native-fs';
import JSZip from 'jszip';
import { NitroModules } from 'react-native-nitro-modules';
import type { NativeEmbeddings } from './NativeEmbeddings.nitro';

export const NativeEmbeddingsModule =
  NitroModules.createHybridObject<NativeEmbeddings>('NativeEmbeddings');

export const RUNTIME_VERSION = 1;
const RUNTIME_TAG = `embedding-runtime-v${RUNTIME_VERSION}`;
const RUNTIME_BASE_URL = `https://github.com/pooradrian/Bucket/releases/download/${RUNTIME_TAG}`;
const LIBS = ['libggml-base.so', 'libggml-cpu.so', 'libggml.so', 'libllama.so'];
const PACKAGE_MANIFEST = 'Bucket/runtime.json';
const PACKAGE_LIB_DIR = 'runtime';

export interface RuntimePackage {
  version: number;
  abi: string;
}

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

export function runtimePackageName(): string {
  return `embedding-runtime-v${RUNTIME_VERSION}-${abi()}.buk`;
}

export function runtimePackageWarning(pkg: RuntimePackage): string {
  return [
    `This .buk file is an on-device embedding runtime module (v${pkg.version}, ${pkg.abi}), not a save backup.`,
    '',
    'It contains native code that Bucket will load and run with full access to the app. A malicious package could execute arbitrary code on this device.',
    '',
    'Only install it if you got it from a source you trust.',
  ].join('\n');
}

async function loadPackageZip(fileUri: string): Promise<JSZip> {
  const response = await fetch(fileUri);
  return JSZip.loadAsync(await response.arrayBuffer());
}

async function readManifest(zip: JSZip): Promise<RuntimePackage | null> {
  const file = zip.file(PACKAGE_MANIFEST);
  if (!file) return null;
  try {
    const parsed = JSON.parse(await file.async('string'));
    if (parsed?.type !== 'embedding-runtime') return null;
    if (typeof parsed.version !== 'number' || typeof parsed.abi !== 'string') {
      return null;
    }
    return { version: parsed.version, abi: parsed.abi };
  } catch {
    return null;
  }
}

export async function readRuntimePackage(
  fileUri: string,
): Promise<RuntimePackage | null> {
  try {
    return await readManifest(await loadPackageZip(fileUri));
  } catch {
    return null;
  }
}

export async function installRuntimeFromPackage(
  fileUri: string,
): Promise<RuntimePackage> {
  if (await isRuntimeInstalled()) {
    throw new Error(
      'The on-device runtime is already installed. Remove it in Settings → Lorebooks & RAG before installing a different one.',
    );
  }

  const zip = await loadPackageZip(fileUri);
  const manifest = await readManifest(zip);
  if (!manifest) {
    throw new Error('That .buk file is not an embedding runtime package.');
  }
  if (manifest.version !== RUNTIME_VERSION) {
    throw new Error(
      `This runtime is version ${manifest.version}, but this app needs version ${RUNTIME_VERSION}.`,
    );
  }
  const deviceAbi = abi();
  if (manifest.abi !== deviceAbi) {
    throw new Error(
      `This runtime was built for ${manifest.abi}, but this device uses ${deviceAbi}.`,
    );
  }

  const libs: Record<string, string> = {};
  for (const lib of LIBS) {
    const entry = zip.file(`${PACKAGE_LIB_DIR}/${lib}`);
    if (!entry) {
      throw new Error(`The runtime package is missing ${lib}.`);
    }
    const base64 = await entry.async('base64');
    if (!base64) {
      throw new Error(`The runtime package's ${lib} is empty.`);
    }
    libs[lib] = base64;
  }

  const dir = runtimeDir();
  await RNFS.mkdir(dir);
  try {
    for (const lib of LIBS) {
      await RNFS.writeFile(`${dir}/${lib}`, libs[lib], 'base64');
    }
    await loadRuntime();
  } catch (e) {
    await RNFS.unlink(dir).catch(() => {});
    throw new Error(
      `Could not install the runtime: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
  return manifest;
}

export async function exportRuntimePackage(): Promise<string> {
  if (!(await isRuntimeInstalled())) {
    throw new Error('Install the on-device runtime before saving it.');
  }
  const zip = new JSZip();
  const manifest: RuntimePackage = { version: RUNTIME_VERSION, abi: abi() };
  zip.file(
    PACKAGE_MANIFEST,
    JSON.stringify({ type: 'embedding-runtime', ...manifest }, null, 2),
  );
  const folder = zip.folder(PACKAGE_LIB_DIR);
  for (const lib of LIBS) {
    folder?.file(
      lib,
      await RNFS.readFile(`${runtimeDir()}/${lib}`, 'base64'),
      { base64: true },
    );
  }
  const base64 = await zip.generateAsync({
    type: 'base64',
    compression: 'STORE',
  });
  const path = `${RNFS.CachesDirectoryPath}/${runtimePackageName()}`;
  await RNFS.writeFile(path, base64, 'base64');
  return path;
}

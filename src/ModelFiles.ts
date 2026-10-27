import RNFS from 'react-native-fs';
import { pick, keepLocalCopy, types } from '@react-native-documents/picker';

const MODELS_DIR = `${RNFS.DocumentDirectoryPath}/models`;
const GGUF_MAGIC = 'GGUF';

export interface LocalModel {
  name: string;
  bytes: number;
}

export function modelsDir(): string {
  return MODELS_DIR;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

export function modelPath(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes('/') || trimmed.includes('..')) {
    return null;
  }
  return `${MODELS_DIR}/${trimmed}`;
}

export function modelFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? 'model.gguf';
  const cleaned = base.replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '');
  const named = cleaned.toLowerCase().endsWith('.gguf')
    ? cleaned
    : `${cleaned}.gguf`;
  return named.length > 0 ? named.slice(-96) : 'model.gguf';
}

async function hasGgufMagic(path: string): Promise<boolean> {
  try {
    const head = await RNFS.read(path, GGUF_MAGIC.length, 0, 'utf8');
    return head === GGUF_MAGIC;
  } catch {
    return false;
  }
}

export async function listModels(): Promise<LocalModel[]> {
  try {
    const entries = await RNFS.readDir(MODELS_DIR);
    return entries
      .filter(entry => entry.isFile() && /\.gguf$/i.test(entry.name))
      .map(entry => ({ name: entry.name, bytes: Number(entry.size) || 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function deleteModel(name: string): Promise<void> {
  const path = modelPath(name);
  if (!path) throw new Error('Invalid model name');
  await RNFS.unlink(path);
}

export async function importModel(): Promise<LocalModel | null> {
  let picked;
  try {
    picked = await pick({ type: [types.allFiles] });
  } catch (e: unknown) {
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      (e as { code: string }).code === 'OPERATION_CANCELED'
    ) {
      return null;
    }
    throw e;
  }
  const file = picked?.[0];
  if (!file) return null;

  const name = modelFileName(file.name || file.uri);
  let copied: string;
  try {
    const copies = await keepLocalCopy({
      destination: 'cachesDirectory',
      files: [{ uri: file.uri, fileName: name }],
    });
    const copy = copies[0];
    if (!copy || copy.status !== 'success') {
      throw new Error(
        copy && 'copyError' in copy && copy.copyError
          ? copy.copyError
          : 'could not copy the selected file',
      );
    }
    copied = copy.localUri;
  } catch (e) {
    throw new Error(
      `Could not read the selected file: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  if (!(await hasGgufMagic(copied))) {
    await RNFS.unlink(copied).catch(() => {});
    throw new Error('That file is not a GGUF model.');
  }

  await RNFS.mkdir(MODELS_DIR);
  const target = `${MODELS_DIR}/${name}`;
  await RNFS.unlink(target).catch(() => {});
  await RNFS.moveFile(copied, target);
  const info = await RNFS.stat(target);
  return { name, bytes: Number(info.size) || 0 };
}

export async function modelExists(name: string): Promise<boolean> {
  const path = modelPath(name);
  if (!path) return false;
  try {
    const info = await RNFS.stat(path);
    return Number(info.size) > 0;
  } catch {
    return false;
  }
}

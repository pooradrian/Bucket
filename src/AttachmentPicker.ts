import RNFS from 'react-native-fs';
import { PermissionsAndroid, Platform } from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { keepLocalCopy, pick, types } from '@react-native-documents/picker';
import {
  Attachment,
  MAX_ATTACHMENT_BYTES,
  deleteAttachmentFiles,
  formatBytes,
  kindForMime,
  saveAttachment,
} from './Attachments';
import { AudioRecorder } from './AudioRecorder';

function isCancel(e: unknown): boolean {
  return (
    !!e &&
    typeof e === 'object' &&
    'code' in e &&
    (e as { code: string }).code === 'OPERATION_CANCELED'
  );
}

export async function pickImages(
  source: 'library' | 'camera',
): Promise<Attachment[]> {
  const options = {
    mediaType: 'photo' as const,
    includeBase64: true,
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.8 as const,
    selectionLimit: 4,
  };
  const result =
    source === 'camera'
      ? await launchCamera(options)
      : await launchImageLibrary(options);
  if (result.didCancel) return [];
  if (result.errorCode) {
    throw new Error(result.errorMessage || result.errorCode);
  }
  const out: Attachment[] = [];
  try {
    for (const asset of result.assets ?? []) {
      if (!asset.base64) continue;
      out.push(
        await saveAttachment({
          kind: 'image',
          name: asset.fileName || 'image.jpg',
          mime: asset.type || 'image/jpeg',
          base64: asset.base64,
        }),
      );
    }
  } catch (e) {
    await deleteAttachmentFiles(out);
    throw e;
  }
  return out;
}

export async function pickFiles(): Promise<Attachment[]> {
  let picked;
  try {
    picked = await pick({ type: [types.allFiles], allowMultiSelection: true });
  } catch (e) {
    if (isCancel(e)) return [];
    throw e;
  }
  const out: Attachment[] = [];
  try {
    for (const file of picked) {
      const name = file.name || 'file';
      if (file.size != null && file.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(
          `${name} is ${formatBytes(file.size)}; the limit is ${formatBytes(
            MAX_ATTACHMENT_BYTES,
          )}.`,
        );
      }
      const copies = await keepLocalCopy({
        destination: 'cachesDirectory',
        files: [{ uri: file.uri, fileName: name }],
      });
      const copy = copies[0];
      if (!copy || copy.status !== 'success') {
        throw new Error(`Could not read ${name}.`);
      }
      try {
        const base64 = await RNFS.readFile(copy.localUri, 'base64');
        const mime = file.type || 'application/octet-stream';
        out.push(
          await saveAttachment({
            kind: kindForMime(mime, name),
            name,
            mime,
            base64,
          }),
        );
      } finally {
        await RNFS.unlink(copy.localUri).catch(() => {});
      }
    }
  } catch (e) {
    await deleteAttachmentFiles(out);
    throw e;
  }
  return out;
}

export async function startVoiceRecording(): Promise<void> {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error('Microphone permission was denied.');
    }
  }
  await AudioRecorder.start();
}

export async function finishVoiceRecording(): Promise<Attachment> {
  const { path, durationMs } = await AudioRecorder.stop();
  try {
    const base64 = await RNFS.readFile(path, 'base64');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return await saveAttachment({
      kind: 'audio',
      name: `voice-${stamp}.wav`,
      mime: 'audio/wav',
      base64,
      durationMs,
    });
  } finally {
    await RNFS.unlink(path).catch(() => {});
  }
}

export function cancelVoiceRecording(): Promise<void> {
  return AudioRecorder.cancel();
}

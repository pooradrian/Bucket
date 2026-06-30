import RNFS from 'react-native-fs';
import pako from 'pako';
import {Character} from '../CharacterEditor';
import {generateId, saveCharacterToDB} from '../Database';
import {readPngCharaMetadata, isPngSignature} from '../PngMetadata';
import {parseV1Json, parseV2Json} from './characterCardSchema';
import {isGzipSignature, readIconFile} from './util';
import {ImportFormat, ImportResult} from './types';

export async function detectImportFormat(fileUri: string, fileName: string): Promise<ImportFormat> {
  if (fileName.endsWith('.buk')) return 'buk';

  try {
    const response = await fetch(fileUri);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    if (isPngSignature(bytes)) {
      return 'ccv2';
    }

    let text: string;
    if (isGzipSignature(bytes)) {
      const decompressed = pako.ungzip(bytes);
      text = new TextDecoder().decode(decompressed);
    } else {
      text = new TextDecoder().decode(buffer);
    }

    const json = JSON.parse(text);

    if (json.formatName === 'dexie' && json.data?.tables) {
      return 'perchance';
    }
    if (json.spec === 'chara_card_v2') return 'ccv2';
    if (json.name || json.first_mes || json.description) return 'ccv1';
  } catch (e) { console.warn('Failed to detect import format:', e); }

  throw new Error('Unrecognized file format');
}

export async function importCharacter(fileUri: string): Promise<ImportResult> {
  const format = await detectImportFormat(fileUri, fileUri.split('/').pop() || '');

  if (format === 'buk') {
    throw new Error('Use importBuk() for .buk files');
  }

  const response = await fetch(fileUri);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let char: Character;
  let iconBase64: string | null = null;

  if (format === 'ccv2' && isPngSignature(bytes)) {
    const base64 = await readIconFile(fileUri);
    if (base64) {
      iconBase64 = base64;
      const metadata = readPngCharaMetadata(base64);
      if (metadata) {
        const json = JSON.parse(metadata);
        char = parseV2Json(json);
      } else {
        char = {id: generateId(), name: 'Unknown Character', description: '', personality: '', scenario: '', initialMessage: '', writingStyle: '', lorebookIds: []};
      }
    } else {
      char = {id: generateId(), name: 'Unknown Character', description: '', personality: '', scenario: '', initialMessage: '', writingStyle: '', lorebookIds: []};
    }
  } else {
    const text = new TextDecoder().decode(buffer);
    const json = JSON.parse(text);
    char = format === 'ccv2' ? parseV2Json(json) : parseV1Json(json);
  }

  if (iconBase64) {
    const iconPath = `${RNFS.DocumentDirectoryPath}/icons/${char.id}.png`;
    await RNFS.mkdir(`${RNFS.DocumentDirectoryPath}/icons`);
    await RNFS.writeFile(iconPath, iconBase64, 'base64');
    char.icon = `file://${iconPath}`;
  }

  await saveCharacterToDB({
    id: char.id,
    name: char.name,
    description: char.description,
    initial_message: char.initialMessage,
    writing_style: char.writingStyle,
    personality: char.personality,
    scenario: char.scenario,
    example_messages: char.exampleMessages || '',
    icon: char.icon || '',
    lorebook_id: '',
  });

  return {character: char, format};
}

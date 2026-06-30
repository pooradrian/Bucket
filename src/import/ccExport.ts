import RNFS from 'react-native-fs';
import JSZip from 'jszip';
import {Character} from '../CharacterEditor';
import {writePngWithCharaMetadata} from '../PngMetadata';
import {readIconFile} from './util';
import {serializeV1, serializeV2} from './characterCardSchema';

export async function exportCCV1(characters: Character[]): Promise<string> {
  const dir = `${RNFS.CachesDirectoryPath}/export`;
  await RNFS.mkdir(dir);

  if (characters.length === 1) {
    const json = serializeV1(characters[0]);
    const path = `${dir}/${characters[0].name || 'character'}.json`;
    await RNFS.writeFile(path, JSON.stringify(json, null, 2), 'utf8');
    return path;
  }

  const zip = new JSZip();
  for (const char of characters) {
    const json = serializeV1(char);
    zip.file(`${char.name || 'character'}.json`, JSON.stringify(json, null, 2));
  }
  const base64 = await zip.generateAsync({type: 'base64', compression: 'DEFLATE'});
  const path = `${dir}/characters.zip`;
  await RNFS.writeFile(path, base64, 'base64');
  return path;
}

export async function exportCCV2(characters: Character[]): Promise<string[]> {
  const dir = `${RNFS.CachesDirectoryPath}/export`;
  await RNFS.mkdir(dir);

  const paths: string[] = [];
  for (const char of characters) {
    const json = serializeV2(char);
    const jsonStr = JSON.stringify(json, null, 2);

    if (char.icon) {
      try {
        const iconBase64 = await readIconFile(char.icon);
        if (iconBase64) {
          const pngWithMeta = writePngWithCharaMetadata(iconBase64, jsonStr);
          const path = `${dir}/${char.name || 'character'}.png`;
          await RNFS.writeFile(path, pngWithMeta, 'base64');
          paths.push(path);
          continue;
        }
      } catch (e) { console.warn('Failed to export character icon:', e); }
    }

    const path = `${dir}/${char.name || 'character'}.json`;
    await RNFS.writeFile(path, jsonStr, 'utf8');
    paths.push(path);
  }

  return paths;
}

import RNFS from 'react-native-fs';
import JSZip from 'jszip';
import {
  getAllCharactersFromDB,
  getAllLorebooksFromDB,
  getAllSessionsForCharacter,
  getSessionById,
  getKV,
} from './Database';
import {saveToDisk} from './ImportExport';

const CRASH_EXPORT_DIR = `${RNFS.DocumentDirectoryPath}/crash_recovery`;

async function safeReadFileBase64(filePath: string): Promise<string | null> {
  try {
    const contents = await RNFS.readFile(filePath, 'base64');
    return contents || null;
  } catch {
    return null;
  }
}

export async function crashExport(): Promise<string | null> {
  try {
    await RNFS.mkdir(CRASH_EXPORT_DIR);

    const zip = new JSZip();

    const characters = await getAllCharactersFromDB();
    const charFolder = zip.folder('characters');
    for (const char of characters) {
      const cc = {
        spec: 'chara_card_v2',
        data: {
          name: char.name,
          description: char.description,
          personality: char.personality,
          scenario: char.scenario,
          first_mes: char.initial_message,
          mes_example: char.example_messages || '',
          alternate_greetings: [],
          system_prompt: '',
          post_history_instructions: '',
          creator_notes: char.writing_style || '',
          tags: [],
          creator: '',
          character_version: '1.0',
          extensions: {},
        },
      };
      charFolder?.file(`${char.id}.json`, JSON.stringify(cc, null, 2));
    }

    const iconFolder = zip.folder('icons');
    for (const char of characters) {
      if (!char.icon) continue;
      const base64 = await safeReadFileBase64(
        char.icon.replace('file://', ''),
      );
      if (base64) {
        const ext = char.icon.split('.').pop() || 'png';
        iconFolder?.file(`${char.id}.${ext}`, base64, {base64: true});
      }
    }

    const lorebooks = await getAllLorebooksFromDB();
    const lorebookFolder = zip.folder('lorebooks');
    for (const lorebook of lorebooks) {
      const content = lorebook.entries.map((e: {text: string}) => e.text).join('\n');
      lorebookFolder?.file(lorebook.fileName, content);
    }

    const chatFolder = zip.folder('chats');
    for (const char of characters) {
      const sessions = getAllSessionsForCharacter(char.id);
      for (const summary of sessions) {
        const session = await getSessionById(summary.id);
        if (session) {
          chatFolder?.file(`${session.id}.json`, JSON.stringify(session, null, 2));
        }
      }
    }

    const settingsRaw = getKV('settings');
    if (settingsRaw) {
      zip.file('Bucket/settings.json', settingsRaw);
    }
    const promptRaw = getKV('promptConfig');
    if (promptRaw) {
      const prompt = JSON.parse(promptRaw);
      delete prompt.apiUrl;
      delete prompt.apiKey;
      zip.file('Bucket/prompt.json', JSON.stringify(prompt, null, 2));
    }

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `CRASH-${dateStr}@${timeStr}.buk`;

    const base64 = await zip.generateAsync({type: 'base64', compression: 'DEFLATE'});
    const path = `${CRASH_EXPORT_DIR}/${filename}`;
    await RNFS.writeFile(path, base64, 'base64');

    saveToDisk(path, 'application/octet-stream', filename).catch((e) => console.warn('CrashExport save failed:', e));

    return path;
  } catch {
    return null;
  }
}

let installed = false;

function writeCrashMarker(): void {
  try {
    const now = new Date();
    const ts = now.toISOString();
    RNFS.mkdir(CRASH_EXPORT_DIR)
      .then(() => RNFS.writeFile(`${CRASH_EXPORT_DIR}/crash_marker.txt`, ts, 'utf8'))
      .catch((e) => console.warn('CrashExport marker write failed:', e));
  } catch {
    // never throw
  }
}

export function installCrashExport(): void {
  if (installed) return;
  installed = true;

  const originalHandler = ErrorUtils.getGlobalHandler();

  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    if (isFatal) {
      writeCrashMarker();
      crashExport().catch((e) => console.warn('CrashExport failed:', e));
    }
    if (originalHandler) {
      originalHandler(error, isFatal);
    }
  });
}

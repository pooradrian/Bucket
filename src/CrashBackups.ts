import { Alert } from 'react-native';
import RNFS from 'react-native-fs';
import { formatBytes } from './Attachments';
import { saveToDisk } from './ImportExport';

export const CRASH_BACKUP_DIR = `${RNFS.DocumentDirectoryPath}/crash_backups`;

/** Once this many crash backups pile up, the user is asked to clean up. */
export const CRASH_BACKUP_WARN_COUNT = 5;

export interface CrashBackup {
  name: string;
  path: string;
  size: number;
  /** Milliseconds since epoch. */
  time: number;
}

export async function listCrashBackups(): Promise<CrashBackup[]> {
  let items: Awaited<ReturnType<typeof RNFS.readDir>>;
  try {
    items = await RNFS.readDir(CRASH_BACKUP_DIR);
  } catch {
    return [];
  }
  return items
    .filter(i => i.isFile() && i.name.endsWith('.buk'))
    .map(i => ({
      name: i.name,
      path: i.path,
      size: Number(i.size) || 0,
      time: i.mtime ? new Date(i.mtime).getTime() : 0,
    }))
    .sort((a, b) => b.time - a.time || (a.name < b.name ? 1 : -1));
}

export function totalBackupSize(backups: CrashBackup[]): number {
  return backups.reduce((sum, b) => sum + b.size, 0);
}

/** Moves a freshly exported .buk into persistent crash backup storage. */
export async function storeCrashBackup(
  sourcePath: string,
  filename: string,
): Promise<string> {
  await RNFS.mkdir(CRASH_BACKUP_DIR);
  const dest = `${CRASH_BACKUP_DIR}/${filename}`;
  await RNFS.moveFile(sourcePath, dest);
  return dest;
}

export async function deleteCrashBackup(path: string): Promise<void> {
  await RNFS.unlink(path).catch(() => {});
}

/** Deletes every backup except the newest `keep`. Returns how many went. */
export async function pruneCrashBackups(keep: number): Promise<number> {
  const stale = (await listCrashBackups()).slice(keep);
  await Promise.all(stale.map(b => deleteCrashBackup(b.path)));
  return stale.length;
}

export async function exportCrashBackup(backup: CrashBackup): Promise<void> {
  await saveToDisk(backup.path, 'application/octet-stream', backup.name);
}

/**
 * If too many crash backups have accumulated, asks whether to delete all but
 * the latest one.
 */
export async function promptCrashBackupCleanup(): Promise<void> {
  const backups = await listCrashBackups();
  if (backups.length < CRASH_BACKUP_WARN_COUNT) return;
  const reclaim = totalBackupSize(backups.slice(1));
  Alert.alert(
    'Crash backups are piling up',
    `Bucket has kept ${backups.length} automatic crash backups. Deleting all but the latest would free ${formatBytes(reclaim)}. You can also manage them under Settings > Crash Backups.`,
    [
      { text: 'Keep all', style: 'cancel' },
      {
        text: 'Delete older',
        style: 'destructive',
        onPress: () => {
          pruneCrashBackups(1).catch(() => {});
        },
      },
    ],
  );
}

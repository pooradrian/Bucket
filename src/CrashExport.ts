import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import pkg from '../package.json';
import {
  getAllCharactersFromDB,
  getAllGroupChatsFromDB,
  getAllFoldersFromDB,
} from './Database';
import {
  listCrashBackups,
  promptCrashBackupCleanup,
  storeCrashBackup,
} from './CrashBackups';
import { exportBuk, saveToDisk } from './ImportExport';
import {
  getEvents,
  isLoggingEnabled,
  logEvent,
  readLogFile,
} from './EventLogger';

const CRASH_EXPORT_DIR = `${RNFS.DocumentDirectoryPath}/crash_recovery`;
const CRASH_MARKER_PATH = `${CRASH_EXPORT_DIR}/crash_marker.txt`;
const NATIVE_CRASH_MARKER_PATH = `${CRASH_EXPORT_DIR}/native_crash_marker.txt`;

export type CrashKind = 'crash' | 'roadblock';

export interface CrashLogEvent {
  type: string;
  timestamp: number;
  summary: string;
}

export interface CrashReport {
  timestamp: string;
  kind: CrashKind;
  context: string;
  errorName: string;
  errorMessage: string;
  errorStack: string;
  appVersion: string;
  platform: string;
  events: CrashLogEvent[];
}

function errorInfo(error: unknown): {
  errorName: string;
  errorMessage: string;
  errorStack: string;
} {
  if (error instanceof Error) {
    return {
      errorName: error.name || 'Error',
      errorMessage: error.message || '',
      errorStack: error.stack || '',
    };
  }
  return {
    errorName: 'Error',
    errorMessage: typeof error === 'string' ? error : String(error),
    errorStack: '',
  };
}

export function buildCrashReport(
  kind: CrashKind,
  error: unknown,
  context = '',
): CrashReport {
  return {
    timestamp: new Date().toISOString(),
    kind,
    context,
    ...errorInfo(error),
    appVersion: pkg.version,
    platform: `${Platform.OS} ${Platform.Version}`,
    events: getEvents(30)
      .map(e => ({ type: e.type, timestamp: e.timestamp, summary: e.summary }))
      .reverse(),
  };
}

function writeCrashReport(report: CrashReport): void {
  try {
    RNFS.writeFile(CRASH_MARKER_PATH, JSON.stringify(report), 'utf8').catch(e =>
      console.warn('CrashReport write failed:', e),
    );
  } catch {
    // never throw from the crash path
  }
}

export function reportRoadblock(error: unknown, context = ''): CrashReport {
  const report = buildCrashReport('roadblock', error, context);
  writeCrashReport(report);
  return report;
}

function isCrashReport(value: unknown): value is CrashReport {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<CrashReport>;
  return (
    typeof r.timestamp === 'string' &&
    typeof r.errorName === 'string' &&
    typeof r.errorMessage === 'string'
  );
}

function parseCrashMarker(raw: string): CrashReport | null {
  const text = raw.trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    if (isCrashReport(parsed)) {
      return {
        ...parsed,
        events: Array.isArray(parsed.events) ? parsed.events : [],
      };
    }
  } catch {
    // not JSON: pre-report versions wrote a bare ISO timestamp
  }

  return {
    timestamp: Number.isNaN(Date.parse(text)) ? new Date().toISOString() : text,
    kind: 'crash',
    context: 'Previous session',
    errorName: 'Crash',
    errorMessage: 'Bucket closed unexpectedly during the previous session.',
    errorStack: '',
    appVersion: pkg.version,
    platform: `${Platform.OS} ${Platform.Version}`,
    events: [],
  };
}

async function readMarker(path: string): Promise<string | null> {
  try {
    return await RNFS.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function readPendingCrash(): Promise<CrashReport | null> {
  const [jsMarker, nativeMarker] = await Promise.all([
    readMarker(CRASH_MARKER_PATH),
    readMarker(NATIVE_CRASH_MARKER_PATH),
  ]);

  for (const marker of [jsMarker, nativeMarker]) {
    if (!marker) continue;
    const report = parseCrashMarker(marker);
    if (report) return report;
  }
  return null;
}

export function clearPendingCrash(): void {
  RNFS.unlink(CRASH_MARKER_PATH).catch(() => {});
  RNFS.unlink(NATIVE_CRASH_MARKER_PATH).catch(() => {});
}

export function formatCrashLog(report: CrashReport, eventLog = ''): string {
  const header = [
    'Bucket crash report',
    `Time: ${report.timestamp}`,
    `App: v${report.appVersion} (${report.platform})`,
    `Kind: ${report.kind}${report.context ? ` - ${report.context}` : ''}`,
    `Error: ${report.errorName}: ${report.errorMessage}`,
  ];

  const parts = [header.join('\n')];

  if (report.errorStack.trim()) {
    parts.push(`Stack:\n${report.errorStack.trim()}`);
  }

  if (report.events.length > 0) {
    parts.push(
      'Recent activity:\n' +
        report.events
          .map(
            e =>
              `${new Date(e.timestamp).toISOString()} ${e.type}: ${e.summary}`,
          )
          .join('\n'),
    );
  }

  const tail = eventLog.split('\n').filter(Boolean).slice(-200).join('\n');
  if (tail) {
    parts.push(`Event log tail:\n${tail}`);
  }

  return parts.join('\n\n');
}

export async function getCrashLogText(report: CrashReport): Promise<string> {
  let log = '';
  if (isLoggingEnabled()) {
    try {
      log = await readLogFile();
    } catch {}
  }
  return formatCrashLog(report, log);
}

function crashBackupFilename(): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  return `CRASH-${dateStr}@${timeStr}.buk`;
}

/** Builds a full export (with crash log) in the cache; returns its path. */
async function buildCrashExportFile(
  report?: CrashReport | null,
): Promise<string> {
  const characters = await getAllCharactersFromDB();
  const groups = await getAllGroupChatsFromDB();
  const folders = getAllFoldersFromDB();
  const crash = report === undefined ? await readPendingCrash() : report;

  return exportBuk({
    format: 'buk',
    characterIds: characters.map(c => c.id),
    groupIds: groups.map(g => g.id),
    folderIds: folders.map(f => f.id),
    includeSettings: true,
    includeLorebooks: true,
    includeChats: true,
    extraFiles: crash
      ? { 'Bucket/crash_log.txt': await getCrashLogText(crash) }
      : undefined,
  });
}

/**
 * Exports everything into persistent crash backup storage and returns the
 * stored path, or null on failure.
 */
export async function createCrashBackup(
  report?: CrashReport | null,
): Promise<string | null> {
  try {
    const path = await buildCrashExportFile(report);
    return await storeCrashBackup(path, crashBackupFilename());
  } catch (e) {
    console.warn('Crash backup failed:', e);
    return null;
  }
}

/**
 * Automatic backup run on the launch after a crash. Skips when a backup
 * newer than the crash already exists (the app was killed before the prompt
 * was dismissed), then asks to clean up if backups have bunched up.
 */
export async function autoCrashBackup(report: CrashReport): Promise<void> {
  const crashedAt = Date.parse(report.timestamp);
  const [latest] = await listCrashBackups();
  const covered =
    latest && !Number.isNaN(crashedAt) && latest.time >= crashedAt;
  if (!covered) await createCrashBackup(report);
  await promptCrashBackupCleanup();
}

/**
 * Manual full export (crash prompt / debugger). Builds a fresh export and
 * hands it to the share dialog; independent of the automatic crash backups.
 */
export async function crashExport(
  report?: CrashReport | null,
): Promise<string | null> {
  try {
    const path = await buildCrashExportFile(report);
    try {
      await saveToDisk(path, 'application/octet-stream', crashBackupFilename());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'User did not share') {
        console.warn('Crash export save failed:', e);
      }
    }
    return path;
  } catch (e) {
    console.warn('Crash export failed:', e);
    return null;
  }
}

let installed = false;

/**
 * Writes a detailed crash report when a fatal JS error happens.  The
 * report is picked up on the next launch by `readPendingCrash()`, which
 * is what drives the crash prompt.
 *
 * Doing heavy work (exporting data, showing UI) inside the global error
 * handler is unlikely to complete and may worsen the crash, so only the
 * small report file is written here.
 */
export function installCrashExport(): void {
  if (installed) return;
  installed = true;

  RNFS.mkdir(CRASH_EXPORT_DIR).catch(() => {});

  const originalHandler = ErrorUtils.getGlobalHandler();

  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    if (isFatal) {
      writeCrashReport(buildCrashReport('crash', error));
      logEvent('fatal_error', {
        errorName: error.name || 'Error',
        errorMsg: error.message || '',
        errorStack: error.stack || '',
        msgLen: error.message?.length || 0,
      });
    }
    if (originalHandler) {
      originalHandler(error, isFatal);
    }
  });
}

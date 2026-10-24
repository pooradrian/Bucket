jest.mock('react-native-fs', () => {
  const fs = {
    DocumentDirectoryPath: '/tmp/docs',
    CachesDirectoryPath: '/tmp/cache',
    mkdir: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockRejectedValue(new Error('ENOENT')),
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
  };
  return { __esModule: true, default: fs, ...fs };
});

jest.mock('../src/Database', () => ({
  getKV: jest.fn().mockReturnValue(null),
  setKV: jest.fn(),
  getAllCharactersFromDB: jest.fn().mockResolvedValue([]),
  getAllGroupChatsFromDB: jest.fn().mockResolvedValue([]),
  getAllFoldersFromDB: jest.fn().mockReturnValue([]),
}));

jest.mock('../src/ImportExport', () => ({
  exportBuk: jest.fn().mockResolvedValue('/tmp/cache/export/backup.buk'),
  saveToDisk: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/EventLogger', () => ({
  getEvents: jest.fn().mockReturnValue([]),
  logEvent: jest.fn(),
  readLogFile: jest.fn().mockResolvedValue(''),
  isLoggingEnabled: jest.fn().mockReturnValue(false),
}));

import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import pkg from '../package.json';
import { exportBuk, saveToDisk } from '../src/ImportExport';
import { isLoggingEnabled, readLogFile } from '../src/EventLogger';
import {
  buildCrashReport,
  clearPendingCrash,
  crashExport,
  formatCrashLog,
  getCrashLogText,
  installCrashExport,
  readPendingCrash,
  reportRoadblock,
} from '../src/CrashExport';

const mockReadFile = RNFS.readFile as jest.Mock;
const mockWriteFile = RNFS.writeFile as jest.Mock;
const mockExportBuk = exportBuk as jest.Mock;
const mockSaveToDisk = saveToDisk as jest.Mock;
const mockIsLoggingEnabled = isLoggingEnabled as jest.Mock;
const mockReadLogFile = readLogFile as jest.Mock;

const flush = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  mockReadFile.mockRejectedValue(new Error('ENOENT'));
  mockIsLoggingEnabled.mockReturnValue(false);
  mockReadLogFile.mockResolvedValue('');
});

describe('buildCrashReport', () => {
  it('captures the error and runtime info', () => {
    const report = buildCrashReport('crash', new TypeError('boom'));

    expect(report.kind).toBe('crash');
    expect(report.errorName).toBe('TypeError');
    expect(report.errorMessage).toBe('boom');
    expect(report.errorStack).toBeTruthy();
    expect(report.appVersion).toBe(pkg.version);
    expect(report.platform).toBe(`${Platform.OS} ${Platform.Version}`);
  });

  it('handles non-Error throw values', () => {
    const report = buildCrashReport('roadblock', 'plain failure', 'Startup');

    expect(report.errorName).toBe('Error');
    expect(report.errorMessage).toBe('plain failure');
    expect(report.errorStack).toBe('');
    expect(report.context).toBe('Startup');
  });
});

describe('formatCrashLog', () => {
  it('includes the header, stack, activity and event log tail', () => {
    const report = buildCrashReport('crash', new Error('kaboom'));
    report.events = [
      { type: 'message_sent', timestamp: 1000, summary: 'Sent message' },
    ];

    const text = formatCrashLog(report, 'line one\nline two');

    expect(text).toContain('Bucket crash report');
    expect(text).toContain(`App: v${pkg.version}`);
    expect(text).toContain('Kind: crash');
    expect(text).toContain('Error: Error: kaboom');
    expect(text).toContain('Recent activity:');
    expect(text).toContain('message_sent: Sent message');
    expect(text).toContain('Event log tail:');
    expect(text).toContain('line one');
  });
});

describe('getCrashLogText', () => {
  it('omits the event log when activity logging is off', async () => {
    const text = await getCrashLogText(
      buildCrashReport('crash', new Error('quiet')),
    );

    expect(text).not.toContain('Event log tail');
    expect(readLogFile).not.toHaveBeenCalled();
  });

  it('appends the event log when activity logging is on', async () => {
    mockIsLoggingEnabled.mockReturnValue(true);
    mockReadLogFile.mockResolvedValueOnce('activity line');

    const text = await getCrashLogText(
      buildCrashReport('crash', new Error('loud')),
    );

    expect(text).toContain('Event log tail:\nactivity line');
  });
});

describe('readPendingCrash', () => {
  it('returns null when there is no marker', async () => {
    expect(await readPendingCrash()).toBeNull();
  });

  it('parses a JSON report', async () => {
    const report = buildCrashReport('crash', new Error('stored'));
    mockReadFile.mockResolvedValueOnce(JSON.stringify(report));

    const read = await readPendingCrash();

    expect(read?.errorMessage).toBe('stored');
    expect(read?.kind).toBe('crash');
  });

  it('reads a native crash marker when the JS marker is missing', async () => {
    const report = buildCrashReport('crash', new Error('native boom'));
    mockReadFile.mockImplementation((path: string) =>
      path.endsWith('native_crash_marker.txt')
        ? Promise.resolve(JSON.stringify(report))
        : Promise.reject(new Error('ENOENT')),
    );

    const read = await readPendingCrash();

    expect(read?.errorMessage).toBe('native boom');
    expect(read?.kind).toBe('crash');
  });

  it('falls back to the legacy timestamp marker', async () => {
    mockReadFile.mockResolvedValueOnce('2026-07-01T10:00:00.000Z');

    const read = await readPendingCrash();

    expect(read?.timestamp).toBe('2026-07-01T10:00:00.000Z');
    expect(read?.kind).toBe('crash');
    expect(read?.errorMessage).toContain('closed unexpectedly');
  });

  it('clears both the JS and native markers', () => {
    clearPendingCrash();

    expect(RNFS.unlink).toHaveBeenCalledWith(
      '/tmp/docs/crash_recovery/crash_marker.txt',
    );
    expect(RNFS.unlink).toHaveBeenCalledWith(
      '/tmp/docs/crash_recovery/native_crash_marker.txt',
    );
  });
});

describe('reportRoadblock', () => {
  it('writes the report to the crash marker', async () => {
    const report = reportRoadblock(new Error('db gone'), 'Startup');

    await flush();

    expect(report.kind).toBe('roadblock');
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/docs/crash_recovery/crash_marker.txt',
      expect.stringContaining('"kind":"roadblock"'),
      'utf8',
    );
  });
});

describe('crashExport', () => {
  it('exports all data and bundles the pending crash log', async () => {
    const report = buildCrashReport('crash', new Error('to be exported'));
    mockReadFile.mockResolvedValueOnce(JSON.stringify(report));

    const path = await crashExport();

    expect(path).toBe('/tmp/cache/export/backup.buk');
    expect(mockExportBuk).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'buk',
        includeSettings: true,
        includeLorebooks: true,
        includeChats: true,
        extraFiles: {
          'Bucket/crash_log.txt': expect.stringContaining('to be exported'),
        },
      }),
    );
    expect(mockSaveToDisk).toHaveBeenCalledWith(
      '/tmp/cache/export/backup.buk',
      'application/octet-stream',
      expect.stringMatching(/^CRASH-.*\.buk$/),
    );
  });

  it('bundles activity in the crash log when logging is on', async () => {
    const report = buildCrashReport('crash', new Error('to be exported'));
    mockReadFile.mockResolvedValueOnce(JSON.stringify(report));
    mockIsLoggingEnabled.mockReturnValue(true);
    mockReadLogFile.mockResolvedValueOnce('{"type":"message_sent"}');

    await crashExport();

    expect(mockExportBuk).toHaveBeenCalledWith(
      expect.objectContaining({
        extraFiles: {
          'Bucket/crash_log.txt': expect.stringContaining(
            'Event log tail:\n{"type":"message_sent"}',
          ),
        },
      }),
    );
  });

  it('returns null when the export throws', async () => {
    mockExportBuk.mockRejectedValueOnce(new Error('no space'));

    expect(await crashExport()).toBeNull();
  });
});

describe('installCrashExport', () => {
  it('writes a report on fatal errors and calls the original handler', async () => {
    const original = jest.fn();
    const setGlobalHandler = jest.fn();
    const globals = globalThis as unknown as {
      ErrorUtils: {
        getGlobalHandler: () => (error: Error, isFatal?: boolean) => void;
        setGlobalHandler: jest.Mock;
      };
    };
    globals.ErrorUtils = {
      getGlobalHandler: () => original,
      setGlobalHandler,
    };

    installCrashExport();
    const handler = setGlobalHandler.mock.calls[0][0];
    handler(new Error('fatal test'), true);

    await flush();

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/docs/crash_recovery/crash_marker.txt',
      expect.stringContaining('"errorMessage":"fatal test"'),
      'utf8',
    );
    expect(original).toHaveBeenCalledTimes(1);
  });
});

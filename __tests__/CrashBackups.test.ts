import RNFS from 'react-native-fs';
import {
  listCrashBackups,
  pruneCrashBackups,
  totalBackupSize,
} from '../src/CrashBackups';

jest.mock('../src/ImportExport', () => ({ saveToDisk: jest.fn() }));

function file(name: string, size: number, mtime: number) {
  return {
    name,
    path: `/tmp/documents/crash_backups/${name}`,
    size,
    mtime: new Date(mtime),
    isFile: () => true,
  };
}

beforeEach(() => {
  (RNFS.unlink as jest.Mock).mockClear();
  (RNFS.readDir as jest.Mock).mockResolvedValue([
    file('CRASH-a.buk', 100, 1000),
    file('CRASH-c.buk', 300, 3000),
    file('notes.txt', 5, 5000),
    file('CRASH-b.buk', 200, 2000),
  ]);
});

it('lists only .buk files, newest first, and sums their size', async () => {
  const list = await listCrashBackups();
  expect(list.map(b => b.name)).toEqual([
    'CRASH-c.buk',
    'CRASH-b.buk',
    'CRASH-a.buk',
  ]);
  expect(totalBackupSize(list)).toBe(600);
});

it('prunes everything except the newest backups', async () => {
  expect(await pruneCrashBackups(1)).toBe(2);
  const removed = (RNFS.unlink as jest.Mock).mock.calls.map(c => c[0]);
  expect(removed).toEqual([
    '/tmp/documents/crash_backups/CRASH-b.buk',
    '/tmp/documents/crash_backups/CRASH-a.buk',
  ]);
});

it('returns an empty list when the directory is missing', async () => {
  (RNFS.readDir as jest.Mock).mockRejectedValue(new Error('ENOENT'));
  expect(await listCrashBackups()).toEqual([]);
});

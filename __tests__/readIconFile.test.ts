import RNFS from 'react-native-fs';
import {readIconFile} from '../src/import/util';

const fsReadFile = RNFS.readFile as jest.Mock;

afterEach(() => {
  jest.restoreAllMocks();
  fsReadFile.mockResolvedValue(undefined);
});

test('data URIs return their embedded bytes without touching the filesystem', async () => {
  const spy = jest.spyOn(globalThis, 'fetch');
  await expect(readIconFile('data:image/png;base64,aWNvbg==')).resolves.toBe('aWNvbg==');
  expect(spy).not.toHaveBeenCalled();
});

test('falls back to the filesystem when fetch cannot read the uri', async () => {
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unsupported scheme'));
  fsReadFile.mockResolvedValue('Zm9v');
  await expect(readIconFile('content://media/images/1')).resolves.toBe('Zm9v');
  expect(fsReadFile).toHaveBeenCalledWith('content://media/images/1', 'base64');
});

test('returns null when both fetch and the filesystem fail', async () => {
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('nope'));
  fsReadFile.mockRejectedValue(new Error('ENOENT'));
  await expect(readIconFile('file:///missing.png')).resolves.toBeNull();
});

test('returns null when the filesystem yields nothing', async () => {
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('nope'));
  fsReadFile.mockResolvedValue('');
  await expect(readIconFile('file:///empty.png')).resolves.toBeNull();
});

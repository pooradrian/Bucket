jest.mock('react-native-fs', () => ({}));
jest.mock('react-native-nitro-sqlite', () => ({open: jest.fn()}));
jest.mock('../src/CharacterEditor', () => ({}));

import {detectImportFormat} from '../src/import/characterImport';

describe('detectImportFormat', () => {
  it('routes .txt files to lorebook without reading content', async () => {
    await expect(detectImportFormat('content://x', 'notes.txt')).resolves.toBe('lorebook');
    await expect(detectImportFormat('content://x', 'NOTES.TXT')).resolves.toBe('lorebook');
  });

  it('still routes .buk files', async () => {
    await expect(detectImportFormat('content://x', 'backup.buk')).resolves.toBe('buk');
  });
});

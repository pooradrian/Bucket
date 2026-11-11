import RNFS from 'react-native-fs';

jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: { allFiles: '*/*' },
  keepLocalCopy: jest.fn(),
}));
jest.mock('../src/Attachments', () => ({
  MAX_ATTACHMENT_BYTES: 1000,
  formatBytes: (n: number) => `${n} B`,
  kindForMime: () => 'file',
  saveAttachment: jest.fn(),
  deleteAttachmentFiles: jest.fn(),
}));

import { launchImageLibrary } from 'react-native-image-picker';
import { keepLocalCopy, pick } from '@react-native-documents/picker';
import { deleteAttachmentFiles, saveAttachment } from '../src/Attachments';
import { pickFiles, pickImages } from '../src/AttachmentPicker';

let saved: { id: string }[];
beforeEach(() => {
  jest.clearAllMocks();
  saved = [];
  (saveAttachment as jest.Mock).mockImplementation(
    async (input: { name: string }) => {
      const att = { id: `att-${input.name}` };
      saved.push(att);
      return att;
    },
  );
  (deleteAttachmentFiles as jest.Mock).mockResolvedValue(undefined);
  (RNFS.readFile as jest.Mock).mockResolvedValue('QUJD');
  (RNFS.unlink as jest.Mock).mockResolvedValue(undefined);
  (keepLocalCopy as jest.Mock).mockImplementation(
    async ({ files }: { files: { fileName: string }[] }) => [
      { status: 'success', localUri: `/cache/${files[0].fileName}` },
    ],
  );
});

describe('pickFiles', () => {
  test('returns every saved file and deletes nothing on success', async () => {
    (pick as jest.Mock).mockResolvedValue([
      { name: 'a.txt', uri: 'content://a', size: 10, type: 'text/plain' },
      { name: 'b.txt', uri: 'content://b', size: 10, type: 'text/plain' },
    ]);
    const out = await pickFiles();
    expect(out.map(a => a.id)).toEqual(['att-a.txt', 'att-b.txt']);
    expect(deleteAttachmentFiles).not.toHaveBeenCalled();
  });

  test('deletes files already saved when a later file is too large', async () => {
    (pick as jest.Mock).mockResolvedValue([
      { name: 'a.txt', uri: 'content://a', size: 10, type: 'text/plain' },
      { name: 'big.bin', uri: 'content://big', size: 5000 },
    ]);
    await expect(pickFiles()).rejects.toThrow('big.bin is 5000 B');
    expect(deleteAttachmentFiles).toHaveBeenCalledWith(saved);
    expect(saved.map(a => a.id)).toEqual(['att-a.txt']);
  });

  test('deletes files already saved when a later file cannot be read', async () => {
    (pick as jest.Mock).mockResolvedValue([
      { name: 'a.txt', uri: 'content://a', size: 10, type: 'text/plain' },
      { name: 'b.txt', uri: 'content://b', size: 10, type: 'text/plain' },
    ]);
    (keepLocalCopy as jest.Mock)
      .mockResolvedValueOnce([{ status: 'success', localUri: '/cache/a.txt' }])
      .mockResolvedValueOnce([{ status: 'error' }]);
    await expect(pickFiles()).rejects.toThrow('Could not read b.txt.');
    expect(deleteAttachmentFiles).toHaveBeenCalledWith([{ id: 'att-a.txt' }]);
  });
});

describe('pickImages', () => {
  test('deletes images already saved when a later save fails', async () => {
    (launchImageLibrary as jest.Mock).mockResolvedValue({
      assets: [
        { base64: 'AAAA', fileName: 'one.jpg', type: 'image/jpeg' },
        { base64: 'BBBB', fileName: 'two.jpg', type: 'image/jpeg' },
      ],
    });
    (saveAttachment as jest.Mock)
      .mockImplementationOnce(async () => ({ id: 'att-one' }))
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(pickImages('library')).rejects.toThrow('disk full');
    expect(deleteAttachmentFiles).toHaveBeenCalledWith([{ id: 'att-one' }]);
  });

  test('returns all images and deletes nothing on success', async () => {
    (launchImageLibrary as jest.Mock).mockResolvedValue({
      assets: [{ base64: 'AAAA', fileName: 'one.jpg', type: 'image/jpeg' }],
    });
    const out = await pickImages('library');
    expect(out).toEqual([{ id: 'att-one.jpg' }]);
    expect(deleteAttachmentFiles).not.toHaveBeenCalled();
  });
});

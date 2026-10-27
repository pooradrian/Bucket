const RNFS = {
  DocumentDirectoryPath: '/tmp/documents',
  CachesDirectoryPath: '/tmp/caches',
  ExternalDirectoryPath: '/tmp/external',
  readDir: jest.fn().mockResolvedValue([]),
  stat: jest.fn().mockRejectedValue(new Error('ENOENT')),
  exists: jest.fn().mockResolvedValue(false),
  read: jest.fn().mockResolvedValue('GGUF'),
  readFile: jest.fn().mockResolvedValue(''),
  writeFile: jest.fn().mockResolvedValue(undefined),
  appendFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  moveFile: jest.fn().mockResolvedValue(undefined),
  downloadFile: jest.fn().mockReturnValue({
    jobId: 1,
    promise: Promise.resolve({ statusCode: 200, jobId: 1 }),
  }),
};

export default RNFS;

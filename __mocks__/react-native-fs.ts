const RNFS = {
  DocumentDirectoryPath: '/tmp/documents',
  CachesDirectoryPath: '/tmp/caches',
  ExternalDirectoryPath: '/tmp/external',
  readDir: jest.fn().mockResolvedValue([]),
  stat: jest.fn().mockRejectedValue(new Error('ENOENT')),
  exists: jest.fn().mockResolvedValue(false),
  readFile: jest.fn().mockResolvedValue(''),
  writeFile: jest.fn().mockResolvedValue(undefined),
  appendFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
};

export default RNFS;

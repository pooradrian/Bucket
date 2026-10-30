jest.mock('react-native-nitro-sqlite', () => ({ open: jest.fn() }));

import RNFS from 'react-native-fs';
import JSZip from 'jszip';
import {
  exportRuntimePackage,
  installRuntimeFromPackage,
  readRuntimePackage,
  runtimePackageName,
} from '../src/EmbeddingRuntime';

const LIBS = [
  'libggml-base.so',
  'libggml-cpu.so',
  'libggml.so',
  'libllama.so',
];

async function packageZip(manifest: unknown, libs: string[] = LIBS) {
  const zip = new JSZip();
  zip.file('Bucket/runtime.json', JSON.stringify(manifest));
  const folder = zip.folder('runtime');
  for (const lib of libs) {
    folder?.file(lib, 'AAAA');
  }
  const buffer = await zip.generateAsync({ type: 'arraybuffer' });
  return { arrayBuffer: async () => buffer };
}

const serve = (payload: unknown) => {
  global.fetch = jest.fn().mockResolvedValue(payload) as unknown as typeof fetch;
};

beforeEach(() => {
  jest.clearAllMocks();
  (RNFS.stat as jest.Mock).mockRejectedValue(new Error('ENOENT'));
  (RNFS.readFile as jest.Mock).mockResolvedValue('');
  (RNFS.writeFile as jest.Mock).mockResolvedValue(undefined);
});

describe('runtime packages', () => {
  test('the file name identifies the package', () => {
    expect(runtimePackageName()).toBe(
      'embedding-runtime-v1-arm64-v8a.buk',
    );
  });

  test('a save backup is not a runtime package', async () => {
    const zip = new JSZip();
    zip.file('Bucket/settings.json', '{}');
    serve({
      arrayBuffer: async () => zip.generateAsync({ type: 'arraybuffer' }),
    });
    await expect(readRuntimePackage('file:///save.buk')).resolves.toBeNull();
  });

  test('reads the manifest', async () => {
    serve(
      await packageZip({
        type: 'embedding-runtime',
        version: 1,
        abi: 'arm64-v8a',
      }),
    );
    await expect(readRuntimePackage('file:///runtime.buk')).resolves.toEqual({
      version: 1,
      abi: 'arm64-v8a',
    });
  });

  test('refuses to overwrite an installed runtime', async () => {
    (RNFS.stat as jest.Mock).mockResolvedValue({ size: 8 });
    serve(
      await packageZip({
        type: 'embedding-runtime',
        version: 1,
        abi: 'arm64-v8a',
      }),
    );
    await expect(
      installRuntimeFromPackage('file:///runtime.buk'),
    ).rejects.toThrow(/already installed/);
    expect(RNFS.writeFile).not.toHaveBeenCalled();
  });

  test('rejects a package for another abi', async () => {
    serve(
      await packageZip({
        type: 'embedding-runtime',
        version: 1,
        abi: 'armeabi-v7a',
      }),
    );
    await expect(
      installRuntimeFromPackage('file:///runtime.buk'),
    ).rejects.toThrow(/built for armeabi-v7a/);
  });

  test('rejects a package missing a library', async () => {
    serve(
      await packageZip(
        { type: 'embedding-runtime', version: 1, abi: 'arm64-v8a' },
        LIBS.slice(1),
      ),
    );
    await expect(
      installRuntimeFromPackage('file:///runtime.buk'),
    ).rejects.toThrow(/missing libggml-base\.so/);
  });

  test('installs every library and loads the runtime', async () => {
    serve(
      await packageZip({
        type: 'embedding-runtime',
        version: 1,
        abi: 'arm64-v8a',
      }),
    );
    await installRuntimeFromPackage('file:///runtime.buk');
    expect(RNFS.writeFile).toHaveBeenCalledTimes(LIBS.length);
    for (const lib of LIBS) {
      expect(RNFS.writeFile).toHaveBeenCalledWith(
        `/tmp/documents/embedding-runtime/v1/arm64-v8a/${lib}`,
        'QUFBQQ==',
        'base64',
      );
    }
  });

  test('exports the installed runtime as a package', async () => {
    (RNFS.stat as jest.Mock).mockResolvedValue({ size: 8 });
    (RNFS.readFile as jest.Mock).mockResolvedValue('AAAA');
    const path = await exportRuntimePackage();
    expect(path).toBe('/tmp/caches/embedding-runtime-v1-arm64-v8a.buk');

    const [, base64] = (RNFS.writeFile as jest.Mock).mock.calls[0];
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const manifest = JSON.parse(
      await zip.file('Bucket/runtime.json')!.async('string'),
    );
    expect(manifest).toEqual({
      type: 'embedding-runtime',
      version: 1,
      abi: 'arm64-v8a',
    });
    for (const lib of LIBS) {
      expect(zip.file(`runtime/${lib}`)).not.toBeNull();
    }
  });
});

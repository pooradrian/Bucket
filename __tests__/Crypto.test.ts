jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
  },
}));

import * as Keychain from 'react-native-keychain';
import { encrypt, decrypt } from '../src/Crypto';

beforeAll(() => {
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
});

describe('encrypt / decrypt round-trip', () => {
  test('round-trips a plain ASCII string', async () => {
    const ciphertext = await encrypt('hello world');
    expect(ciphertext).not.toBe('hello world');
    expect(await decrypt(ciphertext)).toBe('hello world');
  });

  test('round-trips unicode and newlines', async () => {
    const text = 'héllo 🌍\nline two\ttabbed';
    expect(await decrypt(await encrypt(text))).toBe(text);
  });

  test('round-trips a long string', async () => {
    const text = 'a'.repeat(10_000);
    expect(await decrypt(await encrypt(text))).toBe(text);
  });

  test('empty input passes through unchanged', async () => {
    expect(await encrypt('')).toBe('');
    expect(await decrypt('')).toBe('');
  });
});

describe('decrypt tamper detection', () => {
  test('rejects a modified ciphertext (GCM auth tag mismatch)', async () => {
    const ciphertext = await encrypt('secret');
    const tampered =
      ciphertext.slice(0, -1) + (ciphertext.slice(-1) === '0' ? '1' : '0');
    await expect(decrypt(tampered)).rejects.toThrow();
  });

  test('rejects truncated input', async () => {
    const ciphertext = await encrypt('secret');
    await expect(decrypt(ciphertext.slice(0, 10))).rejects.toThrow();
  });
});

describe('key caching', () => {
  test('only touches the keychain once for multiple encrypts', async () => {
    const before = (Keychain.getGenericPassword as jest.Mock).mock.calls.length;
    await encrypt('a');
    await encrypt('b');
    await encrypt('c');
    expect((Keychain.getGenericPassword as jest.Mock).mock.calls.length).toBe(
      before,
    );
  });
});

// Fresh copies of Crypto (empty key cache) and the keychain mock, backed by a
// stateful in-memory keychain whose calls resolve asynchronously so concurrent
// callers really interleave.
function loadFresh(): {
  crypto: typeof import('../src/Crypto');
  keychain: { get: jest.Mock; set: jest.Mock; stored: () => string | null };
} {
  let stored: string | null = null;
  let crypto!: typeof import('../src/Crypto');
  let kc!: typeof import('react-native-keychain');
  jest.isolateModules(() => {
    kc = require('react-native-keychain');
    crypto = require('../src/Crypto');
  });
  const tick = () => new Promise(r => setTimeout(r, 1));
  const get = kc.getGenericPassword as jest.Mock;
  const set = kc.setGenericPassword as jest.Mock;
  // The factory mock fns can be shared across registries; start counts at 0.
  get.mockReset();
  set.mockReset();
  get.mockImplementation(async () => {
    await tick();
    return stored === null ? false : { username: 'bucket', password: stored };
  });
  set.mockImplementation(async (_u: string, pw: string) => {
    await tick();
    stored = pw;
    return { service: 'bucket-db-encryption', storage: 'test' };
  });
  return { crypto, keychain: { get, set, stored: () => stored } };
}

describe('concurrent key initialisation', () => {
  test('parallel encrypts on an empty keychain generate and store one key', async () => {
    const { crypto, keychain } = loadFresh();
    const plaintexts = Array.from({ length: 20 }, (_, i) => `value ${i}`);
    const ciphertexts = await Promise.all(plaintexts.map(p => crypto.encrypt(p)));

    expect(keychain.set).toHaveBeenCalledTimes(1);
    expect(keychain.get).toHaveBeenCalledTimes(1);
    expect(await Promise.all(ciphertexts.map(c => crypto.decrypt(c)))).toEqual(
      plaintexts,
    );

    // A new process reading the stored key can decrypt everything too.
    const second = loadFresh();
    second.keychain.get.mockResolvedValue({
      username: 'bucket',
      password: keychain.stored(),
    });
    expect(
      await Promise.all(ciphertexts.map(c => second.crypto.decrypt(c))),
    ).toEqual(plaintexts);
    expect(second.keychain.set).not.toHaveBeenCalled();
  });

  test('parallel encrypt and decrypt mixed share the in-flight load', async () => {
    const { crypto, keychain } = loadFresh();
    const results = await Promise.all([
      crypto.encrypt('a'),
      crypto.decrypt(''),
      crypto.encrypt('b'),
    ]);
    expect(keychain.set).toHaveBeenCalledTimes(1);
    expect(await crypto.decrypt(results[0])).toBe('a');
    expect(await crypto.decrypt(results[2])).toBe('b');
  });

  test('a rejected keychain read fails all waiters, then a later call retries', async () => {
    const { crypto, keychain } = loadFresh();
    keychain.get.mockRejectedValueOnce(new Error('keystore locked'));

    const first = await Promise.allSettled([
      crypto.encrypt('x'),
      crypto.encrypt('y'),
    ]);
    expect(first.map(r => r.status)).toEqual(['rejected', 'rejected']);
    expect(keychain.get).toHaveBeenCalledTimes(1);
    // A failed read must never be treated as "no key" and overwrite one.
    expect(keychain.set).not.toHaveBeenCalled();

    const ct = await crypto.encrypt('x');
    expect(keychain.get).toHaveBeenCalledTimes(2);
    expect(keychain.set).toHaveBeenCalledTimes(1);
    expect(await crypto.decrypt(ct)).toBe('x');
  });

  test('a rejected keychain write does not poison later calls', async () => {
    const { crypto, keychain } = loadFresh();
    keychain.set.mockRejectedValueOnce(new Error('write failed'));

    await expect(crypto.encrypt('x')).rejects.toThrow('write failed');
    expect(keychain.stored()).toBeNull();

    const ct = await crypto.encrypt('x');
    expect(keychain.set).toHaveBeenCalledTimes(2);
    expect(await crypto.decrypt(ct)).toBe('x');
  });

  test('a keychain write that resolves false is treated as a failure', async () => {
    const { crypto, keychain } = loadFresh();
    keychain.set.mockResolvedValueOnce(false);

    await expect(crypto.encrypt('x')).rejects.toThrow(/store encryption key/);
    const ct = await crypto.encrypt('x');
    expect(await crypto.decrypt(ct)).toBe('x');
  });
});

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: {WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly'},
}));

import * as Keychain from 'react-native-keychain';
import {encrypt, decrypt} from '../src/Crypto';

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
    const tampered = ciphertext.slice(0, -1) + (ciphertext.slice(-1) === '0' ? '1' : '0');
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
    expect((Keychain.getGenericPassword as jest.Mock).mock.calls.length).toBe(before);
  });
});

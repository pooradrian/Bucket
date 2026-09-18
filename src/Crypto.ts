import * as Keychain from 'react-native-keychain';
import {NitroModules} from 'react-native-nitro-modules';
import type {NativeCrypto} from './NativeCrypto.nitro';

const NativeCryptoModule = NitroModules.createHybridObject<NativeCrypto>('NativeCrypto');

/**
 * ── Threat model ──────────────────────────────────────────────────
 *
 * The AES-GCM key protects chat content, character fields, and lorebook
 * entries at rest in the SQLite database.  The key itself is stored in
 * the OS keychain with the following hardening:
 *
 *   • accessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY
 *       – the key can only be read while the device is unlocked
 *       – the key is NOT included in iCloud / iTunes backups, so it
 *         cannot be restored onto a different device
 *
 * Limitations (what this does NOT protect against):
 *   • An attacker with root/jailbreak access to the running device can
 *     still read the key from the keychain and decrypt the database.
 *   • Once the key is loaded into the JS heap (`cachedKey`) it stays in
 *     memory for the lifetime of the process.
 *
 * In short: this encryption protects against casual inspection of the
 * DB file (e.g. extracted via a file browser or backup viewer), not
 * against a determined attacker with full device access.
 * ──────────────────────────────────────────────────────────────────
 */

const KEYCHAIN_SERVICE = 'bucket-db-encryption';
const KEY_LENGTH = 32;

let cachedKey: Uint8Array | null = null;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function getKey(): Promise<Uint8Array> {
  if (cachedKey) {
    return cachedKey;
  }

  const existing = await Keychain.getGenericPassword({service: KEYCHAIN_SERVICE});
  let rawKey: string;

  if (existing) {
    rawKey = existing.password;
  } else {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(KEY_LENGTH));
    rawKey = bytesToHex(bytes);
    await Keychain.setGenericPassword('bucket', rawKey, {
      service: KEYCHAIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }

  cachedKey = hexToBytes(rawKey);
  return cachedKey!;
}

export async function encrypt(plaintext: string): Promise<string> {
  if (!plaintext) {
    return plaintext;
  }
  const keyBytes = await getKey();
  const keyHex = bytesToHex(keyBytes);
  return NativeCryptoModule.encrypt(plaintext, keyHex);
}

export async function decrypt(data: string): Promise<string> {
  if (!data) {
    return data;
  }
  const keyBytes = await getKey();
  const keyHex = bytesToHex(keyBytes);
  return NativeCryptoModule.decrypt(data, keyHex);
}

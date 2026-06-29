import * as Keychain from 'react-native-keychain';
import {gcm} from '@noble/ciphers/aes.js';
import {randomBytes, bytesToHex, hexToBytes, utf8ToBytes, bytesToUtf8} from '@noble/ciphers/utils.js';

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
const NONCE_LENGTH = 12;

let cachedKey: Uint8Array | null = null;

async function getKey(): Promise<Uint8Array> {
  if (cachedKey) {
    return cachedKey;
  }

  const existing = await Keychain.getGenericPassword({service: KEYCHAIN_SERVICE});
  let rawKey: string;

  if (existing) {
    rawKey = existing.password;
  } else {
    const bytes = randomBytes(KEY_LENGTH);
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
  const key = await getKey();
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = gcm(key, nonce);
  const ciphertext = cipher.encrypt(utf8ToBytes(plaintext));
  return bytesToHex(nonce) + bytesToHex(ciphertext);
}

export async function decrypt(data: string): Promise<string> {
  if (!data) {
    return data;
  }
  const key = await getKey();
  const nonce = hexToBytes(data.slice(0, NONCE_LENGTH * 2));
  const ciphertext = hexToBytes(data.slice(NONCE_LENGTH * 2));
  const cipher = gcm(key, nonce);
  const plaintext = cipher.decrypt(ciphertext);
  return bytesToUtf8(plaintext);
}

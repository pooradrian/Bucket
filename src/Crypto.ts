import * as Keychain from 'react-native-keychain';
import {gcm} from '@noble/ciphers/aes.js';
import {randomBytes, bytesToHex, hexToBytes, utf8ToBytes, bytesToUtf8} from '@noble/ciphers/utils.js';

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

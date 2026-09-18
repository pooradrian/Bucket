import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';

const NONCE_HEX_LEN = 24;
const TAG_HEX_LEN = 32;

const NativeCrypto = {
  encrypt(plaintext: string, keyHex: string): string {
    const key = Buffer.from(keyHex, 'hex');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return nonce.toString('hex') + ciphertext.toString('hex') + cipher.getAuthTag().toString('hex');
  },
  decrypt(ciphertextHex: string, keyHex: string): string {
    const key = Buffer.from(keyHex, 'hex');
    const nonce = Buffer.from(ciphertextHex.slice(0, NONCE_HEX_LEN), 'hex');
    const tag = Buffer.from(ciphertextHex.slice(-TAG_HEX_LEN), 'hex');
    const ciphertext = Buffer.from(
      ciphertextHex.slice(NONCE_HEX_LEN, ciphertextHex.length - TAG_HEX_LEN),
      'hex',
    );
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  },
};

export const NitroModules = {
  createHybridObject: jest.fn().mockImplementation((name: string) => {
    if (name === 'NativeCrypto') {
      return NativeCrypto;
    }
    throw new Error(`Unknown HybridObject: ${name}`);
  }),
};

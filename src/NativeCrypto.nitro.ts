import { type HybridObject } from 'react-native-nitro-modules'

export interface NativeCrypto extends HybridObject<{ ios: 'c++', android: 'c++' }> {
  encrypt(plaintext: string, keyHex: string): string;
  decrypt(ciphertextHex: string, keyHex: string): string;
}

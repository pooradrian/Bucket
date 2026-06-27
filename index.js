/**
 * @format
 */
/* eslint-disable no-undef */
/* eslint-disable no-bitwise */

import 'react-native-get-random-values';

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = class {
    constructor(encoding) {
      this.encoding = encoding || 'utf-8';
    }
    decode(buffer) {
      const bytes = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer || buffer);
      let result = '';
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b < 0x80) {
          result += String.fromCharCode(b);
        } else if (b < 0xe0) {
          result += String.fromCharCode(((b & 0x1f) << 6) | (bytes[++i] & 0x3f));
        } else if (b < 0xf0) {
          result += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f));
        } else {
          const cp = ((b & 0x07) << 18) | ((bytes[++i] & 0x3f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f);
          result += String.fromCodePoint(cp);
        }
      }
      return result;
    }
  };
}

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

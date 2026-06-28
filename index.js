/**
 * @format
 */
/* eslint-disable no-undef */
/* eslint-disable no-bitwise */

import 'react-native-get-random-values';

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = class {
    constructor(encoding) {
      this.encoding = (encoding || 'utf-8').toLowerCase();
    }
    decode(buffer) {
      const bytes = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer || buffer);
      let result = '';
      let i = 0;
      while (i < bytes.length) {
        const b = bytes[i];
        if (b < 0x80) {
          result += String.fromCharCode(b);
          i++;
          continue;
        }
        let cp, min, needed;
        if (b < 0xc0) {
          result += '\uFFFD';
          i++;
          continue;
        } else if (b < 0xe0) {
          cp = b & 0x1f; min = 0x80; needed = 1;
        } else if (b < 0xf0) {
          cp = b & 0x0f; min = 0x800; needed = 2;
        } else if (b < 0xf8) {
          cp = b & 0x07; min = 0x10000; needed = 3;
        } else {
          result += '\uFFFD';
          i++;
          continue;
        }
        if (i + needed >= bytes.length) {
          result += '\uFFFD';
          i++;
          continue;
        }
        let valid = true;
        for (let j = 1; j <= needed; j++) {
          const c = bytes[i + j];
          if (c < 0x80 || c > 0xbf) { valid = false; break; }
          cp = (cp << 6) | (c & 0x3f);
        }
        if (!valid || cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
          result += '\uFFFD';
          i++;
          continue;
        }
        result += String.fromCodePoint(cp);
        i += 1 + needed;
      }
      return result;
    }
  };
}

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

import RNFS from 'react-native-fs';

export function isGzipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function readIconFile(uri: string): Promise<string | null> {
  if (uri.startsWith('data:')) {
    return uri.split(',')[1] || null;
  }
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1] || null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    if (dataUrl) {
      return dataUrl;
    }
  } catch {
  }
  try {
    const base64 = await RNFS.readFile(uri, 'base64');
    return base64 || null;
  } catch {
    return null;
  }
}

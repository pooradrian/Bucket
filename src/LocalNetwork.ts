import { PermissionsAndroid, Platform, Permission } from 'react-native';

const LOCAL_NETWORK_PERMISSION =
  'android.permission.ACCESS_LOCAL_NETWORK' as Permission;

function hostFromUrl(raw: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(raw.trim());
  if (!match) return null;
  let host = match[1];
  const at = host.lastIndexOf('@');
  if (at !== -1) host = host.slice(at + 1);
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? null : host.slice(1, end).toLowerCase();
  }
  return host.split(':')[0].toLowerCase();
}

function isPrivateIpv4(host: string): boolean {
  const octets = host.split('.').map(Number);
  if (octets.length !== 4) return false;
  if (octets.some(o => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIpv6(host: string): boolean {
  return (
    host === '::1' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  );
}

export function isLocalNetworkUrl(raw: string): boolean {
  const host = hostFromUrl(raw);
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (host.includes(':')) return isPrivateIpv6(host);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateIpv4(host);
  return !host.includes('.');
}

function requiresLocalNetworkPermission(): boolean {
  return (
    Platform.OS === 'android' &&
    typeof Platform.Version === 'number' &&
    Platform.Version >= 37
  );
}

export async function ensureLocalNetworkAccess(raw: string): Promise<void> {
  if (!requiresLocalNetworkPermission() || !isLocalNetworkUrl(raw)) return;
  if (await PermissionsAndroid.check(LOCAL_NETWORK_PERMISSION)) return;
  const result = await PermissionsAndroid.request(LOCAL_NETWORK_PERMISSION);
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error(
      'Local network access denied. Allow Nearby devices for Bucket in Android settings to reach LAN servers.',
    );
  }
}

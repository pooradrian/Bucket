import * as Keychain from 'react-native-keychain';
import {getKV, setKV} from './Database';

const PROVIDERS_KEY = 'providers';
const ACTIVE_PROVIDER_KEY = 'activeProvider';
const KEY_SERVICE_PREFIX = 'bucket-provider-';

export interface Provider {
  id: string;
  name: string;
  url: string;
}

export function getProviders(): Provider[] {
  try {
    const stored = getKV(PROVIDERS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveProviders(providers: Provider[]): void {
  setKV(PROVIDERS_KEY, JSON.stringify(providers));
}

export function getActiveProviderId(): string | null {
  try {
    return getKV(ACTIVE_PROVIDER_KEY);
  } catch {
    return null;
  }
}

export function setActiveProviderId(id: string): void {
  setKV(ACTIVE_PROVIDER_KEY, id);
}

export async function setProviderKey(providerId: string, key: string): Promise<void> {
  if (!key) {
    await Keychain.resetGenericPassword({service: KEY_SERVICE_PREFIX + providerId});
    return;
  }
  await Keychain.setGenericPassword(providerId, key, {
    service: KEY_SERVICE_PREFIX + providerId,
  });
}

export async function getProviderKey(providerId: string): Promise<string | null> {
  const result = await Keychain.getGenericPassword({service: KEY_SERVICE_PREFIX + providerId});
  if (result) {
    return result.password;
  }
  return null;
}

async function deleteProviderKey(providerId: string): Promise<void> {
  await Keychain.resetGenericPassword({service: KEY_SERVICE_PREFIX + providerId});
}

export async function deleteProvider(providerId: string): Promise<void> {
  const providers = getProviders();
  saveProviders(providers.filter(p => p.id !== providerId));
  await deleteProviderKey(providerId);
  const activeId = getActiveProviderId();
  if (activeId === providerId) {
    const remaining = getProviders();
    setActiveProviderId(remaining.length > 0 ? remaining[0].id : '');
  }
}

export function maskKey(key: string): string {
  if (!key) {return '';}
  if (key.length <= 5) {return '•'.repeat(key.length);}
  return key.slice(0, 5) + '•'.repeat(key.length - 5);
}

import {NativeModules, Platform} from 'react-native';

interface NotificationModuleType {
  playNotificationSound(uri?: string | null): void;
  vibrate(): void;
}

const rawModule = (NativeModules as {NotificationModule?: unknown}).NotificationModule;
const notificationModule: NotificationModuleType | null =
  rawModule &&
  typeof (rawModule as NotificationModuleType).playNotificationSound === 'function' &&
  typeof (rawModule as NotificationModuleType).vibrate === 'function'
    ? (rawModule as NotificationModuleType)
    : null;

export function playNotificationSound(uri?: string | null): void {
  if (Platform.OS !== 'android') return;
  try {
    notificationModule?.playNotificationSound(uri ?? null);
  } catch {}
}

export function vibrateDevice(): void {
  if (Platform.OS !== 'android') return;
  try {
    notificationModule?.vibrate();
  } catch {}
}

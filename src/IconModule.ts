import {NativeModules} from 'react-native';

interface IconModuleType {
  setIcon(mode: 'dark' | 'light'): void;
}

const rawModule = (NativeModules as {IconModule?: unknown}).IconModule;
const iconModule: IconModuleType | null =
  rawModule && typeof (rawModule as IconModuleType).setIcon === 'function'
    ? (rawModule as IconModuleType)
    : null;

export function setIcon(mode: 'dark' | 'light'): void {
  try {
    iconModule?.setIcon(mode);
  } catch {
  }
}

export const hasIconModule = (): boolean => iconModule !== null;

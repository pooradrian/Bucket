import { DeviceEventEmitter, NativeModules, ToastAndroid } from 'react-native';
import { useAppStore } from './store';
import { executeDebuggerCommand } from './debugger/commands';
import { DebuggerEnv, DebuggerIO, DebuggerLogType } from './debugger/types';

/**
 * Debug-build-only: runs in-app debugger commands sent over USB, without
 * opening the debugger screen. Send one with
 *
 *   adb shell am broadcast -a com.bucket.DEBUG -p com.bucket --es cmd 'settings'
 *
 * (or scripts/usb-debug.sh). The output is returned as the broadcast's result
 * data and logged under `adb logcat -s BucketUsb`; the user just sees a toast.
 */

interface UsbDebugModuleType {
  start(): void;
  reply(id: number, ok: boolean, text: string): void;
}

const TOAST_MAX = 120;

export interface CommandResult {
  ok: boolean;
  text: string;
}

/** Runs a debugger command headlessly and collects its output. */
export async function runHeadless(cmd: string): Promise<CommandResult> {
  const lines: { type: DebuggerLogType; text: string }[] = [];
  const io: DebuggerIO = {
    log: (type, text) => lines.push({ type, text }),
    clear: () => {},
  };
  const unsupported = () =>
    io.log('error', 'verbose needs the debugger screen open');
  const state = useAppStore.getState();
  const env: DebuggerEnv = {
    characters: state.characters,
    appSettings: state.appSettings,
    toggleSysStats: state.toggleSysStats,
    enableVerbose: unsupported,
    disableVerbose: unsupported,
    isVerbose: () => false,
  };
  try {
    await executeDebuggerCommand(cmd, env, io);
  } catch (e) {
    io.log('error', e instanceof Error ? e.message : String(e));
  }
  const body = lines.filter(l => l.type !== 'input');
  return {
    ok: !body.some(l => l.type === 'error'),
    text: body
      .map(l => (l.type === 'error' ? `! ${l.text}` : l.text))
      .join('\n'),
  };
}

export function toastText(cmd: string, result: CommandResult): string {
  const first = result.text.split('\n').find(l => l.trim()) ?? 'done';
  const msg = `USB ${result.ok ? '✓' : '✗'} ${cmd.trim()}: ${first.replace(/^! /, '')}`;
  return msg.length > TOAST_MAX ? `${msg.slice(0, TOAST_MAX - 1)}…` : msg;
}

let started = false;

export function startUsbDebugBridge(): void {
  const native = (NativeModules as { UsbDebugModule?: UsbDebugModuleType })
    .UsbDebugModule;
  if (started || !native) return;
  started = true;
  DeviceEventEmitter.addListener(
    'UsbDebugCommand',
    async ({ id, cmd }: { id: number; cmd: string }) => {
      const result = await runHeadless(cmd);
      ToastAndroid.show(toastText(cmd, result), ToastAndroid.SHORT);
      native.reply(id, result.ok, result.text || '(no output)');
    },
  );
  native.start();
}

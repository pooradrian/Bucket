import { NativeModules } from 'react-native';

interface AudioRecorderNative {
  start(): Promise<void>;
  stop(): Promise<{ path: string; durationMs: number }>;
  cancel(): Promise<void>;
}

const native = (NativeModules as { AudioRecorderModule?: AudioRecorderNative })
  .AudioRecorderModule;

function requireNative(): AudioRecorderNative {
  if (!native) {
    throw new Error(
      'Voice recording needs a rebuilt app (native module missing).',
    );
  }
  return native;
}

export const hasAudioRecorder = (): boolean => !!native;

export const AudioRecorder = {
  start: (): Promise<void> => requireNative().start(),
  stop: (): Promise<{ path: string; durationMs: number }> =>
    requireNative().stop(),
  cancel: async (): Promise<void> => {
    try {
      await native?.cancel();
    } catch {}
  },
};

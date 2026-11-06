import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Animated,
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Attachment,
  deleteAttachmentFiles,
  formatBytes,
  formatDuration,
  loadAttachmentBase64,
} from '../Attachments';
import {
  cancelVoiceRecording,
  finishVoiceRecording,
  pickFiles,
  pickImages,
  startVoiceRecording,
} from '../AttachmentPicker';

const MAX_PENDING = 8;
const MAX_RECORD_MS = 5 * 60 * 1000;

function showError(e: unknown) {
  Alert.alert('Attachment', e instanceof Error ? e.message : String(e));
}

export function useAttachmentComposer() {
  const [pending, setPending] = useState<Attachment[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const recordingRef = useRef(false);

  const add = useCallback((items: Attachment[]) => {
    if (items.length === 0) return;
    const room = MAX_PENDING - pendingRef.current.length;
    const kept = items.slice(0, Math.max(0, room));
    deleteAttachmentFiles(items.slice(kept.length));
    if (kept.length < items.length) {
      Alert.alert(
        'Attachment',
        `At most ${MAX_PENDING} attachments per message.`,
      );
    }
    setPending(prev => [...prev, ...kept]);
  }, []);

  const run = useCallback(
    async (job: () => Promise<Attachment[]>) => {
      setMenuOpen(false);
      setBusy(true);
      try {
        add(await job());
      } catch (e) {
        showError(e);
      } finally {
        setBusy(false);
      }
    },
    [add],
  );

  const addImages = useCallback(
    (source: 'library' | 'camera') => run(() => pickImages(source)),
    [run],
  );
  const addFiles = useCallback(() => run(() => pickFiles()), [run]);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    setBusy(true);
    try {
      add([await finishVoiceRecording()]);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  }, [add]);

  const startRecording = useCallback(async () => {
    setMenuOpen(false);
    try {
      await startVoiceRecording();
      recordingRef.current = true;
      setElapsed(0);
      setRecording(true);
    } catch (e) {
      showError(e);
    }
  }, []);

  const cancelRecording = useCallback(async () => {
    recordingRef.current = false;
    setRecording(false);
    await cancelVoiceRecording();
  }, []);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const ms = Date.now() - started;
      setElapsed(ms);
      if (ms >= MAX_RECORD_MS) {
        stopRecording();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [recording, stopRecording]);

  const remove = useCallback((id: string) => {
    const gone = pendingRef.current.find(a => a.id === id);
    setPending(prev => prev.filter(a => a.id !== id));
    deleteAttachmentFiles(gone ? [gone] : []);
  }, []);

  const peek = useCallback((): Attachment[] => pendingRef.current, []);

  /** Hands the pending list to the caller (e.g. on send) without deleting files. */
  const take = useCallback((): Attachment[] => {
    const current = pendingRef.current;
    setPending([]);
    return current;
  }, []);

  // Unsent attachments (and a live recording) must not outlive the screen.
  useEffect(
    () => () => {
      deleteAttachmentFiles(pendingRef.current);
      if (recordingRef.current) {
        cancelVoiceRecording();
      }
    },
    [],
  );

  return {
    pending,
    menuOpen,
    setMenuOpen,
    busy,
    recording,
    elapsed,
    addImages,
    addFiles,
    startRecording,
    stopRecording,
    cancelRecording,
    remove,
    peek,
    take,
  };
}

interface Colors {
  accent: string;
  bg: string;
  border: string;
  text: string;
  muted: string;
  danger: string;
}

const KIND_ICON: Record<Attachment['kind'], string> = {
  image: '▣',
  audio: '♪',
  file: '▤',
};

function describe(att: Attachment): string {
  if (att.kind === 'audio' && att.durationMs) {
    return formatDuration(att.durationMs);
  }
  return formatBytes(att.size);
}

export function AttachmentThumb({
  att,
  size,
}: {
  att: Attachment;
  size: number;
}) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadAttachmentBase64(att.id)
      .then(b64 => {
        if (alive) setUri(`data:${att.mime || 'image/jpeg'};base64,${b64}`);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [att.id, att.mime]);
  return uri ? (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: 8 }}
    />
  ) : (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        backgroundColor: 'rgba(128,128,128,0.25)',
      }}
    />
  );
}

/** Attachments shown inside a sent message bubble. */
export function AttachmentList({
  attachments,
  textColor,
  onPressItem,
}: {
  attachments: Attachment[];
  textColor: string;
  onPressItem?: (index: number) => void;
}) {
  const images = attachments.filter(a => a.kind === 'image');
  const others = attachments.filter(a => a.kind !== 'image');
  return (
    <View>
      {images.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {images.map(a => (
            <TouchableOpacity
              key={a.id}
              activeOpacity={0.8}
              onPress={() => onPressItem?.(attachments.indexOf(a))}
            >
              <AttachmentThumb att={a} size={images.length > 1 ? 96 : 180} />
            </TouchableOpacity>
          ))}
        </View>
      )}
      {others.map(a => (
        <TouchableOpacity
          key={a.id}
          activeOpacity={0.8}
          onPress={() => onPressItem?.(attachments.indexOf(a))}
        >
          <Text
            numberOfLines={1}
            style={{
              color: textColor,
              fontSize: 13,
              marginTop: 4,
              opacity: 0.85,
            }}
          >
            {KIND_ICON[a.kind]} {a.name} · {describe(a)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function PendingAttachments({
  items,
  busy,
  onRemove,
  colors,
}: {
  items: Attachment[];
  busy: boolean;
  onRemove: (id: string) => void;
  colors: Colors;
}) {
  if (items.length === 0 && !busy) return null;
  return (
    <View
      style={{
        flexGrow: 0,
        flexShrink: 0,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingVertical: 8,
          alignItems: 'center',
          gap: 8,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {items.map(a => (
          <View
            key={a.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colors.bg,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 10,
              padding: 4,
              paddingRight: 8,
            }}
          >
            {a.kind === 'image' ? (
              <AttachmentThumb att={a} size={44} />
            ) : (
              <Text style={{ fontSize: 22, marginHorizontal: 6 }}>
                {KIND_ICON[a.kind]}
              </Text>
            )}
            <View style={{ marginLeft: 8, maxWidth: 120 }}>
              <Text
                numberOfLines={1}
                style={{ color: colors.text, fontSize: 12 }}
              >
                {a.name}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 11 }}>
                {describe(a)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => onRemove(a.id)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ marginLeft: 8 }}
            >
              <Text style={{ color: colors.danger, fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        {busy && <ActivityIndicator color={colors.accent} />}
      </ScrollView>
    </View>
  );
}

export function AttachMenu({
  visible,
  bottomOffset,
  onClose,
  onImage,
  onCamera,
  onFile,
  onVoice,
  colors,
}: {
  visible: boolean;
  bottomOffset: number;
  onClose: () => void;
  onImage: () => void;
  onCamera: () => void;
  onFile: () => void;
  onVoice: () => void;
  colors: Colors;
}) {
  const entries: [string, string, () => void][] = [
    ['▣', 'Image', onImage],
    ['◎', 'Camera', onCamera],
    ['▤', 'File', onFile],
    ['♪', 'Voice', onVoice],
  ];
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) {
      fade.setValue(0);
      return;
    }
    Animated.timing(fade, {
      toValue: 1,
      duration: 90,
      useNativeDriver: true,
    }).start();
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, fade, onClose]);
  if (!visible) return null;
  return (
    <Pressable
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
      }}
      onPress={onClose}
    >
      <Animated.View style={{ flex: 1, opacity: fade }}>
        <View
          style={{
            position: 'absolute',
            left: 16,
            bottom: bottomOffset,
            minWidth: 170,
            paddingVertical: 6,
            borderRadius: 14,
            backgroundColor: colors.bg,
            borderColor: colors.border,
            borderWidth: 1,
            elevation: 8,
          }}
        >
          {entries.map(([icon, label, onPress]) => (
            <TouchableOpacity
              key={label}
              onPress={onPress}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 12,
                paddingHorizontal: 16,
              }}
            >
              <Text
                style={{
                  color: colors.accent,
                  fontSize: 18,
                  width: 28,
                  textAlign: 'center',
                }}
              >
                {icon}
              </Text>
              <Text
                style={{ color: colors.text, fontSize: 15, marginLeft: 10 }}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Animated.View>
    </Pressable>
  );
}

export function RecordingBar({
  elapsed,
  onCancel,
  onStop,
  colors,
}: {
  elapsed: number;
  onCancel: () => void;
  onStop: () => void;
  colors: Colors;
}) {
  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 44,
      }}
    >
      <TouchableOpacity onPress={onCancel} style={{ padding: 8 }}>
        <Text style={{ color: colors.danger, fontSize: 14 }}>Cancel</Text>
      </TouchableOpacity>
      <Text style={{ color: colors.text, fontSize: 15 }}>
        <Text style={{ color: colors.danger }}>● </Text>
        {formatDuration(elapsed)}
      </Text>
      <TouchableOpacity
        onPress={onStop}
        style={{
          paddingVertical: 8,
          paddingHorizontal: 14,
          borderRadius: 16,
          backgroundColor: colors.accent,
        }}
      >
        <Text style={{ color: colors.bg, fontSize: 14, fontWeight: '600' }}>
          Attach
        </Text>
      </TouchableOpacity>
    </View>
  );
}

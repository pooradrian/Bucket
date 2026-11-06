import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  Attachment,
  formatBytes,
  formatDuration,
  loadAttachmentBase64,
} from '../Attachments';

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

function Page({
  att,
  width,
  colors,
}: {
  att: Attachment;
  width: number;
  colors: Colors;
}) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (att.kind !== 'image') return;
    let alive = true;
    loadAttachmentBase64(att.id)
      .then(b64 => {
        if (alive) setUri(`data:${att.mime || 'image/jpeg'};base64,${b64}`);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [att.id, att.kind, att.mime]);

  return (
    <View style={{ width, justifyContent: 'center', alignItems: 'center' }}>
      {att.kind === 'image' ? (
        uri ? (
          <Image
            source={{ uri }}
            resizeMode="contain"
            style={{ width: width - 24, height: '100%' }}
          />
        ) : null
      ) : (
        <View
          style={{
            alignItems: 'center',
            padding: 28,
            borderRadius: 16,
            backgroundColor: colors.bg,
            borderColor: colors.border,
            borderWidth: 1,
            maxWidth: width - 48,
          }}
        >
          <Text style={{ color: colors.accent, fontSize: 54 }}>
            {KIND_ICON[att.kind]}
          </Text>
          <Text
            style={{
              color: colors.text,
              fontSize: 15,
              marginTop: 12,
              textAlign: 'center',
            }}
          >
            {att.name}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
            {att.mime || 'unknown type'} · {formatBytes(att.size)}
            {att.durationMs ? ` · ${formatDuration(att.durationMs)}` : ''}
          </Text>
        </View>
      )}
    </View>
  );
}

/** Small full-screen pager over one message's attachments. */
export default function AttachmentViewer({
  attachments,
  startIndex,
  onDelete,
  onClose,
  colors,
}: {
  attachments: Attachment[];
  startIndex: number;
  onDelete: (attachmentId: string) => void;
  onClose: () => void;
  colors: Colors;
}) {
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Attachment>>(null);
  const [index, setIndex] = useState(
    Math.min(startIndex, Math.max(0, attachments.length - 1)),
  );
  const safeIndex = Math.min(index, Math.max(0, attachments.length - 1));
  const current = attachments[safeIndex];

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  const confirmDelete = () => {
    if (!current) return;
    Alert.alert('Delete attachment?', current.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => onDelete(current.id),
      },
    ]);
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 48,
            paddingHorizontal: 20,
            paddingBottom: 12,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 14 }}>
            {attachments.length
              ? `${safeIndex + 1} / ${attachments.length}`
              : ''}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={{ color: colors.text, fontSize: 22 }}>✕</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          ref={listRef}
          data={attachments}
          keyExtractor={a => a.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={safeIndex}
          getItemLayout={(_, i) => ({
            length: width,
            offset: width * i,
            index: i,
          })}
          onMomentumScrollEnd={onScrollEnd}
          renderItem={({ item }) => (
            <Page att={item} width={width} colors={colors} />
          )}
          style={{ flex: 1 }}
        />
        <View
          style={{
            alignItems: 'center',
            paddingTop: 12,
            paddingBottom: 36,
          }}
        >
          {current ? (
            <Text
              numberOfLines={1}
              style={{
                color: colors.muted,
                fontSize: 12,
                marginBottom: 12,
                maxWidth: width - 48,
              }}
            >
              {current.name}
            </Text>
          ) : null}
          <TouchableOpacity
            onPress={confirmDelete}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 28,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: colors.danger,
            }}
          >
            <Text style={{ color: colors.danger, fontSize: 14 }}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

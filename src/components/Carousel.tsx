import React, {useMemo, useRef, useState, useEffect, useCallback} from 'react';
import {
  Dimensions,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {BlurView} from '@react-native-community/blur';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  runOnJS,
  withTiming,
  withDecay,
  withRepeat,
  withSequence,
  withDelay,
  Easing,
  interpolate,
  Extrapolate,
  SharedValue,
} from 'react-native-reanimated';
import {useAppStore} from '../store';
import {ChatMessage, ReplyVariant} from '../useChat';
import {renderFormattedText} from '../textFormat';

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const CHAT_H_PADDING = 32;
// Must match the bubbles' `maxWidth: '72%'` of the chat content area
// (SCREEN_W - 2 * 16 padding) so text wraps at identical points.
const CARD_W = (SCREEN_W - CHAT_H_PADDING) * 0.72;
const PEEK = Math.round(SCREEN_W * 0.12);
// While editing: how far below the visible-area center the card sits (closer
// to the keyboard), the gap between the card bottom and the Save/Cancel row,
// and the geometry constants used to anchor that row to the card.
const KB_LIFT_DOWN = 40;

interface OriginFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  viewport?: {y: number; height: number};
}

interface CarouselProps {
  message: ChatMessage;
  origin?: OriginFrame | null;
  onReady: () => void;
  onClose: () => void;
  onSelectVariant: (msgId: string, slotIndex: number) => void;
  onEditEntry: (msgId: string, entryKey: string, newText: string) => Promise<void>;
  onFork: (msgId: string, sourceKey: string) => Promise<string | null>;
  onFresh: (msgId: string) => Promise<string | null>;
  onDeleteEntry: (msgId: string, entryKey: string) => Promise<void>;
  onDeleteMessage: (msg: ChatMessage) => void;
  onCopy: (msg: ChatMessage) => void;
  onRegenerate: () => void;
  canRegenerate: boolean;
  sending: boolean;
  isStreaming: boolean;
  streamingContent: string;
  replacingMessageId: string | null;
  onStop: () => void;
}

interface CardItem {
  key: string;
  content: string;
  timestamp: number;
  live: boolean;
}

interface Colors {
  accent: string;
  danger: string;
  bgPrimary: string;
  bgSecondary: string;
  borderPrimary: string;
  userBubbleBg: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  bubbleRadius: number;
  fontSizeBody: number;
  forceItalic: boolean;
  blurType: 'dark' | 'light';
  overlay: string;
}

function isDarkTheme(bgPrimary: string, textMuted: string): boolean {
  if (bgPrimary === '#000000') return true;
  if (bgPrimary === '#F5F5F5') return false;
  return textMuted === '#888888';
}

function overlayColor(bgPrimary: string): string {
  const hex = bgPrimary.replace('#', '');
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, 0.85)`;
  }
  return 'rgba(0,0,0,0.6)';
}

export default function Carousel({
  message,
  origin,
  onReady,
  onClose,
  onSelectVariant,
  onEditEntry,
  onFork,
  onFresh,
  onDeleteEntry,
  onDeleteMessage,
  onCopy,
  onRegenerate,
  canRegenerate,
  sending,
  isStreaming,
  streamingContent,
  replacingMessageId,
  onStop,
}: CarouselProps) {
  const theme = useAppStore(s => s.appSettings);
  const colors = useMemo<Colors>(() => ({
    accent: theme.accentColor,
    danger: theme.dangerColor,
    bgPrimary: theme.bgPrimary,
    bgSecondary: theme.bgSecondary,
    borderPrimary: theme.borderPrimary,
    userBubbleBg: theme.userBubbleBg,
    textPrimary: theme.textPrimary,
    textSecondary: theme.textSecondary,
    textMuted: theme.textMuted,
    bubbleRadius: theme.bubbleRadius,
    fontSizeBody: theme.fontSizeBody,
    forceItalic: theme.forceItalic,
    blurType: isDarkTheme(theme.bgPrimary, theme.textMuted) ? ('dark' as const) : ('light' as const),
    overlay: overlayColor(theme.bgPrimary),
  }), [theme.accentColor, theme.dangerColor, theme.bgPrimary, theme.bgSecondary, theme.borderPrimary, theme.userBubbleBg, theme.textPrimary, theme.textSecondary, theme.textMuted, theme.bubbleRadius, theme.fontSizeBody, theme.forceItalic]);

  const items = useMemo<CardItem[]>(() => {
    const variants: ReplyVariant[] = message.variants ?? [];
    const list: CardItem[] = variants.map(v => ({
      key: v.id,
      content: v.content,
      timestamp: v.timestamp,
      live: false,
    }));
    list.push({
      key: 'live',
      content: message.content,
      timestamp: message.timestamp,
      live: true,
    });
    list.sort((a, b) => a.timestamp - b.timestamp);
    return list;
  }, [message]);

  const count = items.length;
  const liveIndex = items.findIndex(it => it.live);
  const standardMaxW = CARD_W;
  const isUser = message.role === 'user';
  const isError = message.id === '__error__';
  const showCounter = !isUser && !isError && (message.variants?.length ?? 0) > 0;
  const streamingThis = isStreaming && replacingMessageId === message.id;
  const liveStreamText = streamingThis ? streamingContent : null;

  const pos = useSharedValue(liveIndex);
  const appear = useSharedValue(0);
  const kbHeight = useSharedValue(0);
  const pullY = useSharedValue(0);
  const dragging = useSharedValue(false);
  const overlayRef = useRef<View>(null);
  const [centered, setCentered] = useState(liveIndex);
  const [targetCenter, setTargetCenter] = useState<{x: number; y: number} | null>(null);
  const [overlayH, setOverlayH] = useState(SCREEN_H);
  const focusKeyRef = useRef<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [jsonVisible, setJsonVisible] = useState(false);
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});

  const handleCardHeight = useCallback((key: string, h: number) => {
    setCardHeights(prev => (prev[key] === h ? prev : {...prev, [key]: h}));
  }, []);

  const jsonText = useMemo(() => {
    if (!message.requestInfo) return null;
    try {
      const parsed: unknown = JSON.parse(message.requestInfo);
      return JSON.stringify(parsed, null, 2).replace(/\\n/g, '\n');
    } catch {
      return message.requestInfo;
    }
  }, [message.requestInfo]);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const centeredKeyRef = useRef<string | null>(items[liveIndex]?.key ?? null);
  const editingRef = useRef(false);
  editingRef.current = editing;

  const cIndex = Math.min(Math.max(centered, 0), count - 1);

  const centeredKey = items[cIndex]?.key ?? null;
  const cardH = (centeredKey && cardHeights[centeredKey]) || 0;
  const vh = overlayH;
  const maxPull = cardH > vh ? cardH / 2 : 0;
  const maxPullRef = useRef(maxPull);
  maxPullRef.current = maxPull;

  const initialPull = useMemo(() => {
    if (!origin?.viewport) return 0;
    const {y: by, height: bh, viewport} = origin;
    if (bh <= viewport.height) return 0;
    const visTop = Math.max(by, viewport.y);
    const visBot = Math.min(by + bh, viewport.y + viewport.height);
    if (visBot <= visTop) return 0;
    const p = ((visTop + visBot) / 2 - by) / bh;
    return (0.5 - p) * bh;
  }, [origin]);

  const [belowActions, setBelowActions] = useState(false);
  const setBelowSafe = useCallback((v: boolean) => {
    setBelowActions(prev => (prev === v ? prev : v));
  }, []);

  useAnimatedReaction(
    () => {
      const kbHalf = Math.max(0, kbHeight.value - KB_LIFT_DOWN * 2) / 2;
      const bottom = vh / 2 + cardH / 2 + pullY.value - kbHalf;
      return (
        appear.value >= 1 &&
        !dragging.value &&
        cardH > vh &&
        vh - bottom >= 114
      );
    },
    (cur, prev) => {
      if (cur !== prev) runOnJS(setBelowSafe)(cur);
    },
    [cardH, vh, setBelowSafe],
  );

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    type KbEvent = {endCoordinates: {height: number}};
    const showSub = Keyboard.addListener(showEvt, (e: KbEvent) => {
      kbHeight.value = withTiming(e.endCoordinates.height, {duration: 250});
    });
    const hideSub = Keyboard.addListener(hideEvt, () => {
      kbHeight.value = withTiming(0, {duration: 250});
    });
    return () => {
      showSub.remove();
      hideSub.remove();
      kbHeight.value = 0;
    };
  }, [kbHeight]);

  useEffect(() => {
    let cancelled = false;
    requestAnimationFrame(() => {
      overlayRef.current?.measureInWindow((x, y, w, h) => {
        if (cancelled) return;
        if (w > 0 && h > 0) {
          setTargetCenter({x: x + w / 2, y: y + h / 2});
          setOverlayH(h);
        } else {
          setTargetCenter({x: SCREEN_W / 2, y: SCREEN_H / 2});
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (origin === undefined || !targetCenter) return;
    appear.value = withTiming(1, {duration: Math.max(0, theme.carouselAnimMs), easing: Easing.inOut(Easing.cubic)});
    onReady();
  }, [appear, origin, targetCenter, onReady, theme.carouselAnimMs]);

  const prevItemsRef = useRef<CardItem[]>(items);
  useEffect(() => {
    const prev = prevItemsRef.current;
    prevItemsRef.current = items;
    if (prev === items) return;

    let desiredKey: string | null = focusKeyRef.current;
    if (desiredKey && !items.some(i => i.key === desiredKey)) desiredKey = null;
    if (!desiredKey && centeredKeyRef.current && items.some(i => i.key === centeredKeyRef.current)) {
      desiredKey = centeredKeyRef.current;
    }
    if (!desiredKey) {
      desiredKey = items.find(i => i.live)?.key ?? items[0]?.key ?? null;
    }
    if (desiredKey) {
      if (desiredKey !== centeredKeyRef.current) {
        pullY.value = 0;
      }
      const idx = items.findIndex(i => i.key === desiredKey);
      pos.value = idx;
      setCentered(idx);
      centeredKeyRef.current = desiredKey;
    }
    if (focusKeyRef.current) focusKeyRef.current = null;
  }, [items, pos, pullY]);

  const snapTo = useCallback((target: number) => {
    const clamped = Math.min(Math.max(Math.round(target), 0), items.length - 1);
    pos.value = withTiming(clamped, {duration: 260, easing: Easing.out(Easing.ease)});
    pullY.value = withTiming(0, {duration: 200});
    setCentered(clamped);
    centeredKeyRef.current = items[clamped]?.key ?? null;
  }, [items, pos, pullY]);
  const snapToRef = useRef(snapTo);
  snapToRef.current = snapTo;

  const commitAndClose = () => {
    Keyboard.dismiss();
    const slot = Math.min(Math.max(Math.round(pos.value), 0), items.length - 1);
    if (slot !== liveIndex) {
      onSelectVariant(message.id, slot);
    }
    onClose();
  };
  const commitAndCloseRef = useRef(commitAndClose);
  commitAndCloseRef.current = commitAndClose;

  const panRef = useRef({moved: false, anchor: 0, axis: null as 'x' | 'y' | null, pullAnchor: 0});
  const cardSpanRef = useRef(SCREEN_W / 2 + CARD_W / 2 - PEEK);
  cardSpanRef.current = SCREEN_W / 2 + (origin && origin.width > 0 ? origin.width : CARD_W) / 2 - PEEK;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !editingRef.current,
      onMoveShouldSetPanResponder: (_e, g) => {
        if (editingRef.current) {
          return Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx);
        }
        return Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6;
      },
      onPanResponderGrant: () => {
        pullY.value = pullY.value;
        dragging.value = true;
        panRef.current.moved = false;
        panRef.current.axis = editingRef.current ? 'y' : null;
        panRef.current.anchor = Math.round(pos.value);
        panRef.current.pullAnchor = pullY.value;
      },
      onPanResponderMove: (_e, g) => {
        const p = panRef.current;
        if (!p.axis && (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6)) {
          p.axis = Math.abs(g.dx) >= Math.abs(g.dy) ? 'x' : 'y';
        }
        if (!p.axis) return;
        if (p.axis === 'x') {
          if (Math.abs(g.dx) > 8) p.moved = true;
          pos.value = p.anchor - g.dx / cardSpanRef.current;
        } else {
          p.moved = true;
          const max = maxPullRef.current;
          pullY.value = Math.min(max, Math.max(-max, p.pullAnchor + g.dy));
        }
      },
      onPanResponderTerminate: () => {
        dragging.value = false;
      },
      onPanResponderRelease: (_e, g) => {
        dragging.value = false;
        const p = panRef.current;
        if (
          !editingRef.current &&
          !p.moved &&
          Math.abs(g.dx) < 6 &&
          Math.abs(g.dy) < 6
        ) {
          commitAndCloseRef.current();
          return;
        }
        if (p.axis === 'y') {
          const max = maxPullRef.current;
          pullY.value = withDecay({
            velocity: g.vy * 1000,
            deceleration: 0.994,
            clamp: [-max, max],
          });
          return;
        }
        const delta = Math.round(g.dx / cardSpanRef.current);
        const target = Math.round(p.anchor) - delta;
        snapToRef.current(target);
      },
    }),
  ).current;

  const startEdit = useCallback(() => {
    const item = items[cIndex];
    if (!item) return;
    setEditDraft(item.content);
    setEditing(true);
  }, [items, cIndex]);

  const saveEdit = useCallback(async () => {
    const item = items[cIndex];
    if (!item) return;
    const text = editDraft.trim();
    if (!text) {
      setEditing(false);
      return;
    }
    await onEditEntry(message.id, item.key, text);
    Keyboard.dismiss();
    setEditing(false);
  }, [items, cIndex, editDraft, message.id, onEditEntry]);

  const cancelEdit = useCallback(() => {
    Keyboard.dismiss();
    setEditing(false);
  }, []);

  const handleFork = useCallback(async () => {
    const item = items[cIndex];
    if (!item) return;
    const newId = await onFork(message.id, item.key);
    if (newId) focusKeyRef.current = newId;
  }, [items, cIndex, onFork, message.id]);

  const handleFresh = useCallback(async () => {
    const newId = await onFresh(message.id);
    if (newId) {
      focusKeyRef.current = newId;
      setEditDraft('');
      setEditing(true);
    }
  }, [onFresh, message.id]);

  const handleDelete = useCallback(async () => {
    const item = items[cIndex];
    if (!item) return;
    if (items.length <= 1) {
      onDeleteMessage(message);
      return;
    }
    const remaining = items.filter(i => i.key !== item.key);
    const replacementIdx = Math.min(cIndex, remaining.length - 1);
    const replacementKey = remaining[replacementIdx]?.key ?? null;
    if (replacementKey) focusKeyRef.current = replacementKey;
    await onDeleteEntry(message.id, item.key);
  }, [items, cIndex, onDeleteMessage, onDeleteEntry, message]);

  const handleDeleteAll = useCallback(() => {
    onDeleteMessage(message);
  }, [onDeleteMessage, message]);

  const canPrev = cIndex > 0;
  const canNext = cIndex < count - 1;

  const actionsNode = useMemo(() => isError ? (
    <View style={styles.actionRow}>
      <ActionButton label="Copy" onPress={() => onCopy(message)} color={colors.accent} />
    </View>
  ) : editing ? null : (
    <>
      <View style={styles.actionRow}>
        <ArrowButton disabled={!canPrev} onPress={() => snapTo(cIndex - 1)} colors={colors} dir="‹" />
        <ActionButton label="Edit" onPress={startEdit} color={colors.accent} disabled={streamingThis} />
        <ActionButton label="Fork" onPress={handleFork} color={colors.accent} disabled={streamingThis} />
        <ActionButton label="Fresh" onPress={handleFresh} color={colors.accent} disabled={streamingThis} />
        <ArrowButton disabled={!canNext} onPress={() => snapTo(cIndex + 1)} colors={colors} dir="›" />
      </View>
      <View style={styles.actionRow}>
        {streamingThis ? (
          <ActionButton label="Stop" onPress={onStop} color={colors.danger} />
        ) : canRegenerate && (
          <ActionButton
            label="Regen"
            onPress={onRegenerate}
            color={colors.accent}
            disabled={sending}
          />
        )}
        <ActionButton label="Copy" onPress={() => onCopy(message)} color={colors.accent} />
        <ActionButton label="JSON" onPress={() => setJsonVisible(true)} color={colors.accent} disabled={!jsonText || streamingThis} />
        <ActionButton label="Delete" onPress={handleDelete} onLongPress={handleDeleteAll} color={colors.danger} disabled={streamingThis} />
      </View>
    </>
  ), [isError, editing, message, colors, canPrev, canNext, cIndex, snapTo, startEdit, handleFork, handleFresh, streamingThis, onStop, canRegenerate, onRegenerate, sending, onCopy, jsonText, handleDelete, handleDeleteAll]);

  const overflows = cardH > vh;

  const cards = useMemo(() => {
    const out: React.ReactElement[] = [];
    const lo = Math.max(0, cIndex - 2);
    const hi = Math.min(count, cIndex + 3);
    for (let i = lo; i < hi; i++) {
      const item = items[i];
      const cardMaxW = standardMaxW;
      out.push(
        <CarouselCard
          key={item.key}
          item={item}
          i={i}
          pos={pos}
          enter={appear}
          pull={pullY}
          colors={colors}
          origin={origin}
          target={targetCenter}
          maxW={cardMaxW}
          counter={showCounter ? `${i + 1}/${count}` : null}
          isUser={isUser}
          editing={editing && i === cIndex}
          editDraft={editDraft}
          onEditDraftChange={setEditDraft}
          onHeight={handleCardHeight}
          entryPull={initialPull}
          vh={vh}
          animMs={Math.max(0, theme.carouselAnimMs)}
          actions={i === cIndex && cardH > 0 && !overflows ? actionsNode : null}
          liveStreamText={item.live ? liveStreamText : null}
        />,
      );
    }
    return out;
  }, [items, count, pos, appear, pullY, colors, origin, targetCenter, standardMaxW, isUser, showCounter, editing, editDraft, cIndex, liveStreamText, handleCardHeight, actionsNode, overflows, initialPull, vh, theme.carouselAnimMs, cardH]);

  const ready = origin !== undefined && targetCenter !== null;

  const blurStyle = useAnimatedStyle(() => ({opacity: appear.value}));

  const uiStyle = useAnimatedStyle(() => ({opacity: appear.value}));

  const belowOpenStyle = useAnimatedStyle(() => {
    const open =
      appear.value >= 1 &&
      cardH > vh &&
      vh - (vh / 2 + cardH / 2 + pullY.value) >= 114;
    return {
      top: vh / 2 + cardH / 2 + pullY.value + 12,
      opacity: open ? appear.value : 0,
    };
  }, [cardH, vh]);

  const sideFadeStyle = useAnimatedStyle(() => {
    const kbHalf = Math.max(0, kbHeight.value - KB_LIFT_DOWN * 2) / 2;
    const open =
      cardH > vh &&
      vh - (vh / 2 + cardH / 2 + pullY.value - kbHalf) >= 114;
    return {opacity: open && appear.value >= 1 ? 0 : appear.value};
  }, [cardH, vh]);

  const editStackStyle = useAnimatedStyle(() => {
    const kbHalf = Math.max(0, kbHeight.value - KB_LIFT_DOWN * 2) / 2;
    const open =
      cardH <= vh ||
      vh - (vh / 2 + cardH / 2 + pullY.value - kbHalf) >= 114;
    return {
      top: vh / 2 + cardH / 2 + pullY.value - kbHalf + 12,
      opacity: open ? appear.value : 0,
    };
  }, [cardH, vh]);

  const stageStyle = useAnimatedStyle(() => {
    // Zero shift while closed; ramps smoothly to "half the keyboard height,
    // minus a little" once it's up so the card sits closer to the keyboard.
    const kb = Math.max(0, kbHeight.value - KB_LIFT_DOWN * 2);
    return {
      transform: [
        {perspective: 1000},
        {translateY: -kb / 2},
      ],
    };
  });

  return (
    <View ref={overlayRef} style={styles.overlay} {...panResponder.panHandlers}>
      <Animated.View style={[StyleSheet.absoluteFill, blurStyle]}>
        <BlurView
          style={StyleSheet.absoluteFill}
          blurType={colors.blurType}
          blurAmount={24}
          overlayColor={colors.overlay}
        />
      </Animated.View>
      {ready && (
        <Animated.View style={[styles.stage, stageStyle]} pointerEvents="box-none">
          {cards}
        </Animated.View>
      )}

      <Animated.View style={[styles.topBar, uiStyle]}>
        <TouchableOpacity onPress={commitAndClose} style={styles.closeBtn}>
          <Text style={[styles.closeText, {color: colors.textPrimary}]}>Close</Text>
        </TouchableOpacity>
      </Animated.View>

      {overflows && !editing && (
        <>
          <Animated.View
            pointerEvents={belowActions ? 'none' : 'box-none'}
            style={[styles.sideCol, styles.sideColLeft, sideFadeStyle]}>
            <ArrowButton disabled={!canPrev} onPress={() => snapTo(cIndex - 1)} colors={colors} dir="‹" />
            <ActionButton label="Edit" onPress={startEdit} color={colors.accent} disabled={streamingThis} />
            <ActionButton label="Fork" onPress={handleFork} color={colors.accent} disabled={streamingThis} />
            <ActionButton label="Fresh" onPress={handleFresh} color={colors.accent} disabled={streamingThis} />
          </Animated.View>
          <Animated.View
            pointerEvents={belowActions ? 'none' : 'box-none'}
            style={[styles.sideCol, styles.sideColRight, sideFadeStyle]}>
            <ArrowButton disabled={!canNext} onPress={() => snapTo(cIndex + 1)} colors={colors} dir="›" />
            {streamingThis ? (
              <ActionButton label="Stop" onPress={onStop} color={colors.danger} />
            ) : canRegenerate && (
              <ActionButton
                label="Regen"
                onPress={onRegenerate}
                color={colors.accent}
                disabled={sending}
              />
            )}
            <ActionButton label="Copy" onPress={() => onCopy(message)} color={colors.accent} />
            <ActionButton label="JSON" onPress={() => setJsonVisible(true)} color={colors.accent} disabled={!jsonText || streamingThis} />
            <ActionButton label="Delete" onPress={handleDelete} onLongPress={handleDeleteAll} color={colors.danger} disabled={streamingThis} />
          </Animated.View>
          <Animated.View
            pointerEvents={belowActions ? 'box-none' : 'none'}
            style={[styles.belowStack, belowOpenStyle]}>
            {actionsNode}
          </Animated.View>
        </>
      )}

      {editing && (
        <Animated.View
          pointerEvents={belowActions || !overflows ? 'box-none' : 'none'}
          style={[styles.belowStack, editStackStyle]}>
          <ActionButton label="Save" onPress={saveEdit} color={colors.accent} />
          <ActionButton label="Cancel" onPress={cancelEdit} color={colors.danger} />
        </Animated.View>
      )}
      {editing && overflows && (
        <>
          <Animated.View
            pointerEvents={belowActions ? 'none' : 'box-none'}
            style={[styles.sideCol, styles.sideColLeft, sideFadeStyle]}>
            <ActionButton label="Save" onPress={saveEdit} color={colors.accent} />
          </Animated.View>
          <Animated.View
            pointerEvents={belowActions ? 'none' : 'box-none'}
            style={[styles.sideCol, styles.sideColRight, sideFadeStyle]}>
            <ActionButton label="Cancel" onPress={cancelEdit} color={colors.danger} />
          </Animated.View>
        </>
      )}

      <Modal
        visible={jsonVisible && jsonText !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setJsonVisible(false)}>
        <View style={[styles.jsonOverlay, {backgroundColor: 'rgba(0,0,0,0.6)'}]}>
          <View style={[styles.jsonModal, {
            backgroundColor: colors.bgSecondary,
            borderColor: colors.borderPrimary,
          }]}>
            <View style={styles.jsonHeader}>
              <Text style={[styles.jsonTitle, {color: colors.textPrimary}]}>Request</Text>
              <TouchableOpacity onPress={() => setJsonVisible(false)} style={styles.jsonCloseBtn}>
                <Text style={[styles.jsonCloseText, {color: colors.textPrimary}]}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.jsonScroll}
              contentContainerStyle={styles.jsonScrollContent}>
              <Text style={[styles.jsonText, {color: colors.textSecondary}]}>
                {jsonText}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function CarouselCard({
  item,
  i,
  pos,
  enter,
  pull,
  colors,
  origin,
  target,
  maxW,
  counter,
  isUser,
  editing,
  editDraft,
  onEditDraftChange,
  onHeight,
  actions,
  entryPull,
  vh,
  animMs,
  liveStreamText,
}: {
  item: CardItem;
  i: number;
  pos: SharedValue<number>;
  enter: SharedValue<number>;
  pull: SharedValue<number>;
  colors: Colors;
  origin?: OriginFrame | null;
  target: {x: number; y: number} | null;
  maxW: number;
  counter: string | null;
  isUser: boolean;
  editing?: boolean;
  editDraft?: string;
  onEditDraftChange?: (text: string) => void;
  onHeight?: (key: string, h: number) => void;
  actions?: React.ReactNode | null;
  entryPull?: number;
  vh?: number;
  animMs?: number;
  liveStreamText?: string | null;
}) {
  const [cardW, setCardW] = useState(0);
  const didSyncRef = useRef(false);
  const animatedStyle = useAnimatedStyle(() => {
    const rel = i - pos.value;
    const absRel = Math.abs(rel);
    const sign = rel >= 0 ? 1 : -1;
    const w = cardW > 0 ? cardW : CARD_W;
    const span = SCREEN_W / 2 + w / 2 - PEEK;
    let restX = 0;
    if (rel !== 0) {
      restX = rel * span;
      if (absRel > 1) {
        restX = sign * (span + (absRel - 1) * (w + 16));
      }
    }
    const scale = interpolate(absRel, [0, 1, 2], [1, 0.86, 0.74], Extrapolate.CLAMP);
    const opacity = interpolate(absRel, [0, 1, 2, 2.5], [1, 0.6, 0.3, 0], Extrapolate.CLAMP);
    const es = 1 - enter.value;
    let enterDx = 0;
    let enterTy = 0;
    let enterScale = 1;
    if (rel === 0) {
      if (origin && origin.width > 0 && target) {
        enterDx = (origin.x + origin.width / 2 - target.x) * es;
        enterTy = (origin.y + origin.height / 2 - target.y) * es;
      } else {
        enterDx = -SCREEN_W * 0.08 * es;
        enterTy = SCREEN_W * 0.18 * es;
        enterScale = 1 - 0.06 * es;
      }
    } else {
      enterDx = sign * (PEEK + 16) * es;
    }
    return {
      transform: [
        {translateX: restX + enterDx},
        {translateY: enterTy + pull.value},
        {scale: scale * enterScale},
      ],
      opacity,
      zIndex: 1000 - Math.round(absRel * 100),
      elevation: 1000 - Math.round(absRel * 100),
    };
  });

  const scrim = useAnimatedStyle(() => {
    const rel = i - pos.value;
    const s = interpolate(Math.abs(rel), [0, 1, 2], [0, 0.45, 0.7], Extrapolate.CLAMP);
    return {opacity: s};
  });

  const bubbleLook = isUser
    ? {
        backgroundColor: colors.userBubbleBg,
        borderWidth: 0,
        borderBottomRightRadius: 4,
      }
    : {
        backgroundColor: colors.bgSecondary,
        borderColor: colors.borderPrimary,
        borderBottomLeftRadius: 4,
      };
  const textColor = isUser ? colors.textPrimary : colors.textSecondary;
  const showTyping = liveStreamText != null && liveStreamText.length === 0;
  const displayContent = liveStreamText ?? item.content;

  const measureCard = (ev: {nativeEvent: {layout: {width: number; height: number}}}) => {
    const next = Math.round(ev.nativeEvent.layout.width);
    if (cardW !== next) setCardW(next);
    const nextH = Math.round(ev.nativeEvent.layout.height);
    if (!didSyncRef.current && nextH > 0) {
      didSyncRef.current = true;
      const max = vh && nextH > vh ? (nextH - vh) / 2 : 0;
      const pullTarget = Math.min(max, Math.max(-max, entryPull ?? 0));
      pull.value = withTiming(pullTarget, {
        duration: animMs ?? 0,
        easing: Easing.inOut(Easing.cubic),
      });
    }
    onHeight?.(item.key, nextH);
  };

  return (
    <View style={styles.cardWrap}>
      <View style={styles.centerShift}>
        <Animated.View
          style={[
            animatedStyle,
            styles.cardCluster,
            editing && {width: maxW},
          ]}>
        <View
          onLayout={measureCard}
          style={[
            styles.card,
            {maxWidth: maxW},
            {
              borderRadius: colors.bubbleRadius,
              ...bubbleLook,
            },
          ]}>
          <View style={styles.cardInner}>
            {editing ? (
              <TextInput
                style={[
                  styles.cardInput,
                  {color: textColor, fontSize: colors.fontSizeBody, lineHeight: 20},
                ]}
                value={editDraft}
                onChangeText={onEditDraftChange}
                multiline
                autoFocus
                textAlignVertical="top"
              />
            ) : (
              <>
                {showTyping ? (
                  <TypingDots color={textColor} />
                ) : (
                  <Text
                    style={[
                      styles.cardText,
                      {color: textColor, fontSize: colors.fontSizeBody, lineHeight: 20},
                    ]}>
                    {renderFormattedText(displayContent, {color: textColor, fontSize: colors.fontSizeBody, lineHeight: 20}, colors.forceItalic)}
                  </Text>
                )}
                <View style={styles.cardMetaRow}>
                  <Text style={[styles.cardMeta, {color: colors.textMuted}]}>
                    {new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                  </Text>
                  {counter && (
                    <Text style={[styles.cardMeta, {color: colors.textMuted, marginLeft: 8, fontSize: 12}]}>
                      {counter}
                    </Text>
                  )}
                </View>
              </>
            )}
          </View>
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, scrim, {backgroundColor: colors.overlay}]}
          />
        </View>
        {actions ? (
          <View pointerEvents="box-none" style={styles.clusterActions}>
            {actions}
          </View>
        ) : null}
        </Animated.View>
      </View>
    </View>
  );
}

function ArrowButton({
  disabled,
  onPress,
  dir,
  colors,
}: {
  disabled: boolean;
  onPress: () => void;
  dir: string;
  colors: Colors;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.arrowBtn, {borderColor: colors.accent}, disabled && {opacity: 0.35}]}>
      <Text style={[styles.arrowText, {color: colors.accent}]}>{dir}</Text>
    </TouchableOpacity>
  );
}

function ActionButton({
  label,
  onPress,
  onLongPress,
  color,
  disabled,
}: {
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  color: string;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      delayLongPress={500}
      style={[styles.actionBtn, {borderColor: color}, disabled && {opacity: 0.4}]}>
      <Text style={[styles.actionBtnText, {color}]}>{label}</Text>
    </TouchableOpacity>
  );
}

function TypingDots({color}: {color: string}) {
  const o1 = useSharedValue(0.3);
  const o2 = useSharedValue(0.3);
  const o3 = useSharedValue(0.3);

  useEffect(() => {
    const anim = () =>
      withRepeat(withSequence(withTiming(1, {duration: 400}), withTiming(0.3, {duration: 400})), -1);
    o1.value = withDelay(0, anim());
    o2.value = withDelay(200, anim());
    o3.value = withDelay(400, anim());
  }, [o1, o2, o3]);

  return (
    <View style={styles.typingDots}>
      {[o1, o2, o3].map((v, i) => (
        <Animated.View key={i} style={[styles.typingDot, {backgroundColor: color, opacity: v}]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  stage: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    alignItems: 'center',
  },
  centerShift: {
    transform: [{translateY: '-50%'}],
  },
  cardCluster: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 12,
  },
  card: {
    maxWidth: '72%',
    overflow: 'hidden',
    borderWidth: 1,
  },
  clusterActions: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: 12,
    gap: 10,
  },
  cardInner: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cardText: {},
  typingDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  cardInput: {
    padding: 0,
    minHeight: 60,
    width: '100%',
  },
  cardEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  cardEditBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  cardEditBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    justifyContent: 'space-between',
  },
  cardMeta: {
    fontSize: 11,
    flexShrink: 1,
  },
  topBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    width: SCREEN_W,
    paddingHorizontal: 20,
  },
  closeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  closeText: {
    fontSize: 15,
    fontWeight: '600',
  },
  belowStack: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 10,
  },
  sideCol: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  sideColLeft: {
    left: 4,
  },
  sideColRight: {
    right: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
  arrowBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  arrowText: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
  },
  jsonOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  jsonModal: {
    width: '100%',
    maxHeight: '80%',
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  jsonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  jsonTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  jsonCloseBtn: {
    paddingHorizontal: 8,
  },
  jsonCloseText: {
    fontSize: 22,
    lineHeight: 24,
  },
  jsonScroll: {
    paddingHorizontal: 16,
  },
  jsonScrollContent: {
    paddingVertical: 12,
  },
  jsonText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 17,
  },
});

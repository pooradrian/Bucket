import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FlatList } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Character } from './CharacterEditor';
import { LorebookState } from './RAGHandler';
import { useAppStore, GroupChat } from './store';
import {
  getSessionById,
  createSession,
  addMessage,
  deleteMessage,
  updateMessage,
  updateMessageWithVariants,
  updateSessionTimestamp,
  generateId,
  getLorebookEntriesFromDB,
} from './Database';
import {
  startGeneration,
  stopGeneration,
  useGenerationStore,
} from './GenerationEngine';
import { logEvent } from './EventLogger';
import type { RetrievalInfo } from './PromptHandler';

export interface ReplyVariant {
  id: string;
  content: string;
  timestamp: number;
  characterId?: string;
  thinkingMs?: number;
  speakerName?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  characterId?: string;
  speakerName?: string;
  variants?: ReplyVariant[];
  requestInfo?: string;
  thinkingMs?: number;
}

export interface ChatSession {
  id: string;
  characterId: string;
  groupChatId?: string;
  lastReplyCharacterId?: string;
  name?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface QuickCharacter {
  id: string;
  name: string;
  description: string;
  personality: string;
  starred: boolean;
  session_id?: string;
  icon?: string;
}

function liveDeckIndex(msg: ChatMessage): number {
  const liveEntry: ReplyVariant = {
    id: 'live',
    content: msg.content,
    timestamp: msg.timestamp,
  };
  const deck = [...(msg.variants ?? []), liveEntry].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  return deck.findIndex(d => d.id === 'live');
}

function makeVariantEntry(id: string, msg: ChatMessage): ReplyVariant {
  return {
    id,
    content: msg.content,
    timestamp: msg.timestamp,
    ...(msg.characterId ? { characterId: msg.characterId } : {}),
    ...(msg.speakerName ? { speakerName: msg.speakerName } : {}),
    ...(msg.thinkingMs !== undefined ? { thinkingMs: msg.thinkingMs } : {}),
  };
}

export function reconcileSelectedQC(
  selected: QuickCharacter | null,
  list: QuickCharacter[],
): QuickCharacter | null {
  if (!selected) return null;
  const fresh = list.find(q => q.id === selected.id);
  if (!fresh) return null;
  if (
    fresh.name === selected.name &&
    fresh.description === selected.description &&
    fresh.personality === selected.personality &&
    fresh.icon === selected.icon
  ) {
    return selected;
  }
  return fresh;
}

export function useChat({
  character,
  groupChat,
  activeSessionId,
  onSessionCreated,
  quickCharacters,
}: {
  character?: Character | null;
  groupChat?: GroupChat | null;
  activeSessionId: string | null;
  onSessionCreated: (sessionId: string) => void;
  quickCharacters: QuickCharacter[];
}): {
  session: ChatSession | null;
  inputText: string;
  setInputText: (text: string) => void;
  sending: boolean;
  isStreaming: boolean;
  streamingContent: string;
  streamingPhase: 'rag' | 'generating';
  streamingRag: RetrievalInfo | null;
  selectedMessageId: string | null;
  setSelectedMessageId: (id: string | null) => void;
  editingMessageId: string | null;
  editingText: string;
  setEditingText: (text: string) => void;
  error: string | null;
  selectedReplyCharacter: Character | null;
  setSelectedReplyCharacter: (char: Character | null) => void;
  selectedQC: QuickCharacter | null;
  setSelectedQC: (qc: QuickCharacter | null) => void;
  groupMembers: Character[];
  flatListRef: React.RefObject<FlatList<ChatMessage> | null>;
  messagesData: (ChatMessage & { id: string })[];
  replacingMessageId: string | null;
  variantIndexMap: Record<string, number>;
  handleSend: (text: string) => Promise<void>;
  handleContinue: (target?: {
    character?: Character | null;
    qc?: QuickCharacter | null;
  }) => Promise<void>;
  handleEditMessage: (msg: ChatMessage) => void;
  handleEditSave: (msg: ChatMessage, newText: string) => void;
  handleEditCancel: () => void;
  handleCopyMessage: (msg: ChatMessage) => void;
  handleDeleteMessage: (msg: ChatMessage) => void;
  handleRegenerate: () => Promise<void>;
  handleSwitchVariant: (msgId: string, direction: 1 | -1) => Promise<void>;
  handleSelectVariant: (
    msgId: string,
    targetSlotIndex: number,
  ) => Promise<void>;
  handleStudioEditEntry: (
    msgId: string,
    entryKey: string,
    newText: string,
  ) => Promise<void>;
  handleStudioFork: (
    msgId: string,
    sourceKey: string,
  ) => Promise<string | null>;
  handleStudioFresh: (msgId: string) => Promise<string | null>;
  handleStudioDeleteEntry: (msgId: string, entryKey: string) => Promise<void>;
  handleRetryError: () => Promise<void>;
  handleStop: () => void;
} {
  const lorebooks = useAppStore(s => s.lorebooks);
  const allCharacters = useAppStore(s => s.characters);

  const [session, setSession] = useState<ChatSession | null>(null);
  const [inputText, setInputText] = useState('');
  const [sendingLocal, setSendingLocal] = useState(false);
  const [syncingSessionId, setSyncingSessionId] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null,
  );
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [selectedReplyCharacter, setSelectedReplyCharacter] =
    useState<Character | null>(null);
  const [selectedQC, setSelectedQC] = useState<QuickCharacter | null>(null);
  const [variantIndexMap, setVariantIndexMap] = useState<
    Record<string, number>
  >({});
  const variantIndexMapRef = useRef(variantIndexMap);
  useEffect(() => {
    variantIndexMapRef.current = variantIndexMap;
  }, [variantIndexMap]);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  // Always tracks the id of the session currently shown in the UI. Used to
  // detect when the active session changes mid-stream so that streamed results
  // are not applied to (or persisted into) the wrong session.
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = session?.id ?? null;
  }, [session?.id]);

  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, []);

  const pendingCreationKeyRef = useRef<string | null>(null);
  // Sessions created in memory but not yet written to the DB. A session row is
  // only inserted once it actually has content, so empty threads never appear.
  const unpersistedRef = useRef<Set<string>>(new Set());
  const seenRevisionRef = useRef<Record<string, number>>({});
  const failedRevisionRef = useRef<Record<string, number>>({});

  const runSessionId = session?.id ?? null;
  const run = useGenerationStore(s =>
    runSessionId ? s.runs[runSessionId] : undefined,
  );
  const runRevision = useGenerationStore(s =>
    runSessionId ? (s.revisions[runSessionId] ?? 0) : 0,
  );
  const storedError = useGenerationStore(s =>
    runSessionId ? (s.errors[runSessionId] ?? '') : '',
  );
  const needsSync =
    !!runSessionId &&
    runRevision > 0 &&
    seenRevisionRef.current[runSessionId] !== runRevision &&
    failedRevisionRef.current[runSessionId] !== runRevision;
  const sending =
    sendingLocal ||
    !!run ||
    (!!runSessionId && syncingSessionId === runSessionId) ||
    needsSync;
  const isStreaming = !!run;
  const streamingContent = run?.content ?? '';
  const streamingPhase = run?.phase ?? 'generating';
  const streamingRag = run?.rag ?? null;
  const replacingMessageId = run?.replaceMessageId ?? null;
  const error = storedError || null;

  const ensureSessionPersisted = useCallback(
    async (s: ChatSession) => {
      if (!unpersistedRef.current.has(s.id)) {
        return;
      }
      try {
        await createSession(s);
        unpersistedRef.current.delete(s.id);
        onSessionCreated(s.id);
      } catch (e) {
        console.warn('Failed to persist session:', e);
      }
    },
    [onSessionCreated],
  );

  useEffect(() => {
    if (activeSessionId) {
      pendingCreationKeyRef.current = null;
    }
  }, [activeSessionId]);

  // Applies a functional session update only if the active session is still the
  // one the in-flight request started on. Prevents stale-session writes when the
  // user switches chats while a response is streaming.
  const updateSessionIfCurrent = useCallback(
    (startSessionId: string, updater: (prev: ChatSession) => ChatSession) => {
      if (sessionIdRef.current !== startSessionId) {
        return;
      }
      setSession(prev =>
        prev && prev.id === startSessionId ? updater(prev) : prev,
      );
    },
    [],
  );

  const isGroupChat = !!groupChat;
  const groupMembers = useMemo(() => {
    if (!isGroupChat || !groupChat) return [];
    return groupChat.characterIds
      .map(id => allCharacters.find(c => c.id === id))
      .filter(Boolean) as Character[];
  }, [isGroupChat, groupChat, allCharacters]);
  const activeCharacter =
    character || (groupMembers.length > 0 ? groupMembers[0] : null);

  const persistMessage = useCallback(
    async (sessionId: string, message: ChatMessage, updatedAt: number) => {
      try {
        await addMessage(sessionId, message);
        updateSessionTimestamp(sessionId, updatedAt);
      } catch (e) {
        console.warn('Failed to persist message:', e);
      }
    },
    [],
  );

  // Lorebook entries are loaded lazily at send time instead of eagerly on
  // every character change — large lorebooks made chat entry sluggish.
  const loadChatLorebooks = useCallback(async (): Promise<LorebookState[]> => {
    if (isGroupChat || !activeCharacter?.lorebookIds?.length) {
      return [];
    }
    const found = activeCharacter.lorebookIds
      .map(id => lorebooks.find(l => l.id === id))
      .filter(Boolean) as LorebookState[];
    return Promise.all(
      found.map(async lb => ({
        ...lb,
        entries: await getLorebookEntriesFromDB(lb.id),
      })),
    );
  }, [isGroupChat, activeCharacter, lorebooks]);

  const loadOrCreateSession = useCallback(async () => {
    try {
      if (activeSessionId) {
        const existing = await getSessionById(activeSessionId);
        if (existing) {
          unpersistedRef.current.delete(existing.id);
          setSession(existing);
          if (isGroupChat && existing.lastReplyCharacterId) {
            const lastChar = groupMembers.find(
              c => c.id === existing.lastReplyCharacterId,
            );
            if (lastChar) setSelectedReplyCharacter(lastChar);
          }
          return;
        }
      }

      const creationKey = isGroupChat
        ? `group:${groupChat?.id ?? ''}`
        : `char:${activeCharacter?.id ?? ''}`;

      if (pendingCreationKeyRef.current === creationKey) {
        return;
      }

      if (isGroupChat) {
        if (!groupChat) {
          return;
        }
        pendingCreationKeyRef.current = creationKey;
        const newSession: ChatSession = {
          id: generateId(),
          characterId: '',
          groupChatId: groupChat.id,
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        unpersistedRef.current.add(newSession.id);
        setSession(newSession);
        return;
      }

      if (!activeCharacter) {
        return;
      }

      pendingCreationKeyRef.current = creationKey;
      const initialMessages: ChatMessage[] = activeCharacter.initialMessage
        ? [
            {
              id: generateId(),
              role: 'assistant' as const,
              content: activeCharacter.initialMessage,
              timestamp: Date.now(),
            },
          ]
        : [];
      const newSession: ChatSession = {
        id: generateId(),
        characterId: activeCharacter.id,
        messages: initialMessages,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      unpersistedRef.current.add(newSession.id);
      setSession(newSession);
    } catch (e) {
      pendingCreationKeyRef.current = null;
      console.warn('Failed to load or create session:', e);
    }
  }, [activeSessionId, isGroupChat, groupChat, groupMembers, activeCharacter]);

  useEffect(() => {
    loadOrCreateSession();
  }, [activeSessionId, loadOrCreateSession]);

  useEffect(() => {
    setSelectedQC(null);
  }, [activeSessionId]);

  useEffect(() => {
    const reconciled = reconcileSelectedQC(selectedQC, quickCharacters);
    if (reconciled !== selectedQC) {
      setSelectedQC(reconciled);
    }
  }, [quickCharacters, selectedQC]);

  // Reloads the session from the DB whenever the engine mutates it (new
  // reply, cancelled partial, summarization) so this screen reflects changes
  // that happened while it was unmounted or in the background.
  useEffect(() => {
    const sessionId = session?.id;
    if (!sessionId || runRevision <= 0) {
      return;
    }
    if (seenRevisionRef.current[sessionId] === runRevision) {
      return;
    }
    let cancelled = false;
    setSyncingSessionId(sessionId);
    (async () => {
      try {
        const fresh = await getSessionById(sessionId);
        if (cancelled) {
          return;
        }
        seenRevisionRef.current[sessionId] = runRevision;
        delete failedRevisionRef.current[sessionId];
        if (fresh) {
          setSession(prev => (prev && prev.id === sessionId ? fresh : prev));
        }
      } catch (e) {
        if (!cancelled) {
          failedRevisionRef.current[sessionId] = runRevision;
        }
        console.warn('Failed to reload session:', e);
      } finally {
        if (!cancelled) {
          setSyncingSessionId(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runRevision, session?.id]);

  // Shared send/retry/regenerate entry point. The request itself runs in the
  // generation engine so it keeps streaming while this screen is unmounted;
  // `messages` is the conversation history handed to the model and `userText`
  // is the latest user turn.
  const runLLMRequest = useCallback(
    async (
      startSessionId: string,
      messages: ChatMessage[],
      userText: string,
      opts: {
        setLastReplyCharacter?: boolean;
        summarize?: boolean;
        replaceMessageId?: string;
        existingVariants?: ReplyVariant[];
        continueMode?: boolean;
        continueTarget?: {
          character?: Character | null;
          qc?: QuickCharacter | null;
        };
      } = {},
    ) => {
      const targetReplyCharacter = opts.continueTarget
        ? (opts.continueTarget.character ?? null)
        : isGroupChat
          ? selectedReplyCharacter
          : null;
      const targetQC = opts.continueTarget
        ? (opts.continueTarget.qc ?? null)
        : selectedQC;
      if (isGroupChat && !targetReplyCharacter) {
        return;
      }
      if (!isGroupChat && !targetQC && !activeCharacter) {
        return;
      }
      setSendingLocal(true);
      try {
        startGeneration({
          sessionId: startSessionId,
          character: activeCharacter,
          groupChat: groupChat ?? null,
          groupMembers,
          replyCharacter: isGroupChat ? targetReplyCharacter : null,
          qc: isGroupChat ? null : targetQC,
          quickCharacters,
          messages,
          userText,
          lorebooks: targetQC ? undefined : await loadChatLorebooks(),
          summarize: opts.summarize,
          continueMode: opts.continueMode,
          replaceMessageId: opts.replaceMessageId,
          existingVariants: opts.existingVariants,
          setLastReplyCharacter: opts.setLastReplyCharacter,
        });
      } finally {
        setSendingLocal(false);
      }
    },
    [
      isGroupChat,
      selectedReplyCharacter,
      selectedQC,
      quickCharacters,
      groupMembers,
      activeCharacter,
      groupChat,
      loadChatLorebooks,
    ],
  );

  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !session || sending) {
        return;
      }
      if (isGroupChat && !selectedReplyCharacter) {
        return;
      }

      const startSessionId = session.id;

      const userMessage: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      };

      const withUser: ChatSession = {
        ...session,
        messages: [...session.messages, userMessage],
        updatedAt: Date.now(),
      };
      if (unpersistedRef.current.has(startSessionId)) {
        await ensureSessionPersisted(withUser);
      } else {
        await persistMessage(startSessionId, userMessage, withUser.updatedAt);
      }
      setSession(withUser);
      setInputText('');
      logEvent('message_sent', {
        charCount: userMessage.content.length,
        sessionMsgCount: withUser.messages.length,
        isGroupChat,
        isQC: !!selectedQC,
      });
      scrollTimeoutRef.current = setTimeout(
        () =>
          flatListRef.current?.scrollToOffset({ offset: 0, animated: true }),
        50,
      );

      await runLLMRequest(startSessionId, withUser.messages, trimmed, {
        setLastReplyCharacter: true,
        summarize: true,
      });
    },
    [
      session,
      sending,
      isGroupChat,
      selectedReplyCharacter,
      selectedQC,
      ensureSessionPersisted,
      persistMessage,
      runLLMRequest,
    ],
  );

  const handleContinue = useCallback(
    async (target?: {
      character?: Character | null;
      qc?: QuickCharacter | null;
    }) => {
      if (!session || sending) {
        return;
      }
      if (session.messages.length === 0) {
        return;
      }

      const continueTarget = target ?? {
        character: isGroupChat ? selectedReplyCharacter : undefined,
        qc: isGroupChat ? undefined : selectedQC,
      };

      if (isGroupChat && !continueTarget.character) {
        return;
      }

      await ensureSessionPersisted(session);
      const startSessionId = session.id;
      logEvent('message_continue', {
        sessionMsgCount: session.messages.length,
        isGroupChat,
        isQC: !!continueTarget.qc,
      });

      await runLLMRequest(startSessionId, session.messages, '', {
        setLastReplyCharacter: true,
        continueMode: true,
        continueTarget,
      });
    },
    [
      session,
      sending,
      isGroupChat,
      selectedReplyCharacter,
      selectedQC,
      ensureSessionPersisted,
      runLLMRequest,
    ],
  );

  const handleEditMessage = useCallback((msg: ChatMessage) => {
    setSelectedMessageId(null);
    setEditingMessageId(msg.id);
    setEditingText(msg.content);
  }, []);

  const handleEditSave = useCallback(
    async (msg: ChatMessage, newText: string) => {
      if (!session) {
        return;
      }
      const trimmed = newText.trim();
      if (!trimmed) {
        return;
      }
      const updated = session.messages.map(m =>
        m.id === msg.id ? { ...m, content: trimmed } : m,
      );
      setSession({ ...session, messages: updated, updatedAt: Date.now() });
      try {
        await updateMessage(msg.id, trimmed);
        updateSessionTimestamp(session.id, Date.now());
        logEvent('message_edited', {
          oldCharCount: msg.content.length,
          newCharCount: trimmed.length,
        });
      } catch (e) {
        console.warn('Failed to save message edit:', e);
      }
      setEditingMessageId(null);
      setEditingText('');
    },
    [session],
  );

  const handleEditCancel = useCallback(() => {
    setEditingMessageId(null);
    setEditingText('');
  }, []);

  const handleCopyMessage = useCallback((msg: ChatMessage) => {
    Clipboard.setString(msg.content);
    setSelectedMessageId(null);
  }, []);

  const handleDeleteMessage = useCallback(
    (msg: ChatMessage) => {
      if (!session) {
        return;
      }
      const updated = session.messages.filter(m => m.id !== msg.id);
      setSession({ ...session, messages: updated, updatedAt: Date.now() });
      deleteMessage(msg.id);
      updateSessionTimestamp(session.id, Date.now());
      logEvent('message_deleted', { charCount: msg.content.length });
      setSelectedMessageId(null);
    },
    [session],
  );

  const handleRegenerate = useCallback(async () => {
    if (!session || sending) {
      return;
    }
    const lastMsg = session.messages[session.messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') {
      return;
    }

    const startSessionId = session.id;
    const baseMessages = session.messages.slice(0, -1);
    const lastUserMsg = [...baseMessages]
      .reverse()
      .find(m => m.role === 'user');
    if (!lastUserMsg) {
      return;
    }

    await ensureSessionPersisted(session);

    const archivedVariant: ReplyVariant = {
      id: generateId(),
      content: lastMsg.content,
      timestamp: lastMsg.timestamp,
      ...(lastMsg.characterId ? { characterId: lastMsg.characterId } : {}),
      ...(lastMsg.speakerName ? { speakerName: lastMsg.speakerName } : {}),
      ...(lastMsg.thinkingMs !== undefined
        ? { thinkingMs: lastMsg.thinkingMs }
        : {}),
    };
    const existingVariants = [...(lastMsg.variants ?? []), archivedVariant];

    updateSessionIfCurrent(startSessionId, prev => ({
      ...prev,
      messages: prev.messages.map(m =>
        m.id === lastMsg.id ? { ...m, variants: existingVariants } : m,
      ),
      updatedAt: Date.now(),
    }));
    updateSessionTimestamp(startSessionId, Date.now());
    setSelectedMessageId(null);
    setVariantIndexMap(prev => ({
      ...prev,
      [lastMsg.id]: existingVariants.length,
    }));

    await runLLMRequest(startSessionId, baseMessages, lastUserMsg.content, {
      replaceMessageId: lastMsg.id,
      existingVariants,
    });
    logEvent('message_regenerated', { sessionMsgCount: baseMessages.length });
  }, [
    session,
    sending,
    ensureSessionPersisted,
    updateSessionIfCurrent,
    runLLMRequest,
  ]);

  const commitVariantUpdate = useCallback(
    async (
      baseSession: ChatSession,
      msgId: string,
      updatedMsg: ChatMessage,
      deckIndex?: number,
      logName?: string,
    ) => {
      const updatedMessages = baseSession.messages.map(m =>
        m.id === msgId ? updatedMsg : m,
      );
      setSession({
        ...baseSession,
        messages: updatedMessages,
        updatedAt: Date.now(),
      });
      const idx = deckIndex ?? liveDeckIndex(updatedMsg);
      setVariantIndexMap(prev => ({ ...prev, [msgId]: idx }));
      try {
        await updateMessageWithVariants(
          msgId,
          updatedMsg.content,
          updatedMsg.timestamp,
          updatedMsg.variants ?? [],
          undefined,
          updatedMsg.thinkingMs,
          updatedMsg.characterId,
          updatedMsg.speakerName,
        );
      } catch (e) {
        console.warn('Failed to update message variants:', e);
      }
      updateSessionTimestamp(baseSession.id, Date.now());
      if (logName) {
        logEvent(logName, { role: updatedMsg.role });
      }
    },
    [],
  );

  const handleSwitchVariant = useCallback(
    async (msgId: string, direction: 1 | -1) => {
      if (!session) {
        return;
      }
      const msg = session.messages.find(m => m.id === msgId);
      if (!msg || !msg.variants || msg.variants.length === 0) {
        return;
      }
      const n = msg.variants.length;
      const currentIdx = variantIndexMapRef.current[msgId] ?? n;
      const newIdx = currentIdx + direction;
      if (newIdx < 0 || newIdx > n) {
        return;
      }

      const oldEntry = makeVariantEntry(generateId(), msg);

      let newContent: ReplyVariant;
      let newVariants: ReplyVariant[];
      if (newIdx < currentIdx) {
        newContent = msg.variants[newIdx];
        newVariants = [...msg.variants];
        newVariants.splice(newIdx, 1, oldEntry);
      } else {
        newContent = msg.variants[newIdx - 1];
        newVariants = [...msg.variants];
        newVariants.splice(newIdx - 1, 1, oldEntry);
      }

      const updatedMsg: ChatMessage = {
        ...msg,
        content: newContent.content,
        timestamp: newContent.timestamp,
        characterId: newContent.characterId ?? msg.characterId,
        variants: newVariants,
        thinkingMs: newContent.thinkingMs,
      };
      await commitVariantUpdate(session, msgId, updatedMsg, newIdx);
    },
    [session, commitVariantUpdate],
  );

  const handleSelectVariant = useCallback(
    async (msgId: string, targetDeckIndex: number) => {
      if (!session) {
        return;
      }
      const msg = session.messages.find(m => m.id === msgId);
      if (!msg || !msg.variants || msg.variants.length === 0) {
        return;
      }

      const deck = [...msg.variants, makeVariantEntry('live', msg)].sort(
        (a, b) => a.timestamp - b.timestamp,
      );
      const livePos = deck.findIndex(d => d.id === 'live');
      const clamped = Math.min(Math.max(targetDeckIndex, 0), deck.length - 1);
      if (clamped === livePos || clamped < 0 || deck[clamped].id === 'live') {
        return;
      }

      const chosen = deck[clamped];
      const variantIdx = msg.variants.findIndex(v => v.id === chosen.id);
      if (variantIdx < 0) {
        return;
      }

      const oldEntry = makeVariantEntry(generateId(), msg);

      const newContent = msg.variants[variantIdx];
      const newVariants = [...msg.variants];
      newVariants.splice(variantIdx, 1, oldEntry);

      const updatedMsg: ChatMessage = {
        ...msg,
        content: newContent.content,
        timestamp: newContent.timestamp,
        characterId: newContent.characterId ?? msg.characterId,
        variants: newVariants,
        thinkingMs: newContent.thinkingMs,
      };
      await commitVariantUpdate(session, msgId, updatedMsg, clamped);
    },
    [session, commitVariantUpdate],
  );

  const handleStudioEditEntry = useCallback(
    async (msgId: string, entryKey: string, newText: string) => {
      if (!session) {
        return;
      }
      const msg = session.messages.find(m => m.id === msgId);
      if (!msg) {
        return;
      }
      const trimmed = newText.trim();
      if (!trimmed) {
        return;
      }
      let updatedMsg: ChatMessage;
      if (entryKey === 'live') {
        updatedMsg = {
          ...msg,
          content: trimmed,
          timestamp: Date.now(),
          thinkingMs: undefined,
        };
      } else {
        updatedMsg = {
          ...msg,
          variants: (msg.variants ?? []).map(v =>
            v.id === entryKey
              ? {
                  ...v,
                  content: trimmed,
                  timestamp: Date.now(),
                  thinkingMs: undefined,
                }
              : v,
          ),
        };
      }
      await commitVariantUpdate(
        session,
        msgId,
        updatedMsg,
        undefined,
        'variant_edited',
      );
    },
    [session, commitVariantUpdate],
  );

  const handleStudioFork = useCallback(
    async (msgId: string, sourceKey: string): Promise<string | null> => {
      if (!session) {
        return null;
      }
      const msg = session.messages.find(m => m.id === msgId);
      if (!msg) {
        return null;
      }
      const sourceVariant =
        sourceKey === 'live'
          ? null
          : (msg.variants ?? []).find(v => v.id === sourceKey);
      const sourceContent =
        sourceKey === 'live'
          ? msg.content
          : (sourceVariant?.content ?? msg.content);
      const sourceCharId =
        sourceKey === 'live'
          ? msg.characterId
          : (sourceVariant?.characterId ?? msg.characterId);
      const sourceThinkingMs =
        sourceKey === 'live'
          ? msg.thinkingMs
          : (sourceVariant?.thinkingMs ?? msg.thinkingMs);
      const newVariant: ReplyVariant = {
        id: generateId(),
        content: sourceContent,
        timestamp: Date.now(),
        ...(sourceCharId ? { characterId: sourceCharId } : {}),
        ...(sourceThinkingMs !== undefined
          ? { thinkingMs: sourceThinkingMs }
          : {}),
      };
      const oldEntry = makeVariantEntry(generateId(), msg);
      const newVariants = [...(msg.variants ?? []), oldEntry];
      const updatedMsg: ChatMessage = {
        ...msg,
        content: newVariant.content,
        timestamp: newVariant.timestamp,
        characterId: newVariant.characterId ?? msg.characterId,
        variants: newVariants,
        thinkingMs: newVariant.thinkingMs,
      };
      await commitVariantUpdate(
        session,
        msgId,
        updatedMsg,
        undefined,
        'variant_forked',
      );
      return 'live';
    },
    [session, commitVariantUpdate],
  );

  const handleStudioFresh = useCallback(
    async (msgId: string): Promise<string | null> => {
      if (!session) {
        return null;
      }
      const msg = session.messages.find(m => m.id === msgId);
      if (!msg) {
        return null;
      }
      const oldEntry = makeVariantEntry(generateId(), msg);
      const newVariants = [...(msg.variants ?? []), oldEntry];
      const updatedMsg: ChatMessage = {
        ...msg,
        content: '',
        timestamp: Date.now(),
        characterId: msg.characterId,
        variants: newVariants,
        thinkingMs: undefined,
      };
      await commitVariantUpdate(
        session,
        msgId,
        updatedMsg,
        undefined,
        'variant_fresh',
      );
      return 'live';
    },
    [session, commitVariantUpdate],
  );

  const handleStudioDeleteEntry = useCallback(
    async (msgId: string, entryKey: string) => {
      if (!session) {
        return;
      }
      const msg = session.messages.find(m => m.id === msgId);
      if (!msg) {
        return;
      }
      const deckCount = (msg.variants?.length ?? 0) + 1;
      if (deckCount <= 1) {
        handleDeleteMessage(msg);
        return;
      }
      let updatedMsg: ChatMessage;
      if (entryKey === 'live') {
        const liveEntry: ReplyVariant = {
          id: 'live',
          content: msg.content,
          timestamp: msg.timestamp,
        };
        const deck = [...(msg.variants ?? []), liveEntry].sort(
          (a, b) => a.timestamp - b.timestamp,
        );
        const livePos = deck.findIndex(d => d.id === 'live');
        const remaining = deck.filter(d => d.id !== 'live');
        const promoteIdx = Math.min(livePos, remaining.length - 1);
        const promoted = remaining[promoteIdx];
        updatedMsg = {
          ...msg,
          content: promoted.content,
          timestamp: promoted.timestamp,
          characterId: promoted.characterId ?? msg.characterId,
          variants: remaining.filter(v => v.id !== promoted.id),
          thinkingMs: promoted.thinkingMs,
        };
      } else {
        updatedMsg = {
          ...msg,
          variants: (msg.variants ?? []).filter(v => v.id !== entryKey),
        };
      }
      await commitVariantUpdate(
        session,
        msgId,
        updatedMsg,
        undefined,
        'variant_deleted',
      );
    },
    [session, handleDeleteMessage, commitVariantUpdate],
  );

  const handleStop = useCallback(() => {
    const sessionId = sessionIdRef.current;
    if (sessionId) {
      stopGeneration(sessionId);
    }
  }, []);

  const handleRetryError = useCallback(async () => {
    if (!session || sending) {
      return;
    }
    const lastUserMsg = [...session.messages]
      .reverse()
      .find(m => m.role === 'user');
    if (!lastUserMsg) {
      return;
    }

    await ensureSessionPersisted(session);
    await runLLMRequest(session.id, session.messages, lastUserMsg.content);
  }, [session, sending, ensureSessionPersisted, runLLMRequest]);

  const messagesData = useMemo(() => {
    const base = [...(session?.messages ?? [])].reverse();
    const replaceId = replacingMessageId;
    const showInlineStream =
      isStreaming && replaceId && streamingContent.length > 0;
    const showInlineTyping =
      sending && streamingContent.length === 0 && !error && replaceId;
    if (showInlineStream || showInlineTyping) {
      const streamContent = showInlineStream ? streamingContent : '';
      return base.map(m =>
        m.id === replaceId
          ? { ...m, content: streamContent, timestamp: Date.now() }
          : m,
      );
    }
    if (isStreaming && streamingContent.length > 0) {
      base.unshift({
        id: '__streaming__',
        role: 'assistant',
        content: streamingContent,
        timestamp: Date.now(),
      });
    } else if (sending && streamingContent.length === 0 && !error) {
      base.unshift({
        id: '__typing__',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      });
    } else if (error) {
      base.unshift({
        id: '__error__',
        role: 'assistant',
        content: error,
        timestamp: Date.now(),
      });
    }
    return base;
  }, [
    session?.messages,
    isStreaming,
    streamingContent,
    sending,
    error,
    replacingMessageId,
  ]);

  return {
    session,
    inputText,
    setInputText,
    sending,
    isStreaming,
    streamingContent,
    streamingPhase,
    streamingRag,
    selectedMessageId,
    setSelectedMessageId,
    editingMessageId,
    editingText,
    setEditingText,
    error,
    selectedReplyCharacter,
    setSelectedReplyCharacter,
    selectedQC,
    setSelectedQC,
    groupMembers,
    flatListRef,
    messagesData,
    replacingMessageId,
    variantIndexMap,
    handleSend,
    handleContinue,
    handleEditMessage,
    handleEditSave,
    handleEditCancel,
    handleCopyMessage,
    handleDeleteMessage,
    handleRegenerate,
    handleSwitchVariant,
    handleSelectVariant,
    handleStudioEditEntry,
    handleStudioFork,
    handleStudioFresh,
    handleStudioDeleteEntry,
    handleRetryError,
    handleStop,
  };
}

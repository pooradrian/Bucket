import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {Character} from './CharacterEditor';
import {loadPromptConfig, sendToLLM, sendToGroupLLM, sendToQCLLM, PromptConfig, DEFAULT_PROMPT_CONFIG} from './PromptHandler';
import {RawRequest} from './Endpoint';
import {LorebookState} from './RAGHandler';
import {useAppStore, GroupChat} from './store';
import {
  getSessionById,
  createSession,
  addMessage,
  deleteMessage,
  updateMessage,
  updateMessageWithVariants,
  updateSessionTimestamp,
  setLastReplyCharacterId,
  generateId,
  getLorebookEntriesFromDB,
} from './Database';
import {checkAndSummarize, getSummarizationConfig} from './Summarizer';
import {logEvent} from './EventLogger';
import {playNotificationSound, vibrateDevice} from './NotificationModule';

export interface ReplyVariant {
  id: string;
  content: string;
  timestamp: number;
  characterId?: string;
}

function serializeRequest(request: RawRequest): string {
  const strippedBody = {...request.body};
  delete (strippedBody as Record<string, unknown>).stream;
  return JSON.stringify({url: request.url, body: strippedBody});
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  characterId?: string;
  variants?: ReplyVariant[];
  requestInfo?: string;
}

export interface ChatSession {
  id: string;
  characterId: string;
  groupChatId?: string;
  lastReplyCharacterId?: string;
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
}

function liveDeckIndex(msg: ChatMessage): number {
  const liveEntry: ReplyVariant = {
    id: 'live',
    content: msg.content,
    timestamp: msg.timestamp,
  };
  const deck = [...(msg.variants ?? []), liveEntry].sort((a, b) => a.timestamp - b.timestamp);
  return deck.findIndex(d => d.id === 'live');
}

function makeVariantEntry(id: string, msg: ChatMessage): ReplyVariant {
  return {
    id,
    content: msg.content,
    timestamp: msg.timestamp,
    ...(msg.characterId ? {characterId: msg.characterId} : {}),
  };
}

function notifyCompletion(): void {
  const {appSettings} = useAppStore.getState();
  if (appSettings.notificationMode === 'vibrate' || appSettings.notificationMode === 'both') {
    vibrateDevice();
  }
  if (appSettings.notificationMode === 'sound' || appSettings.notificationMode === 'both') {
    playNotificationSound(appSettings.notificationSound);
  }
}

async function maybeSummarize(
  opts: {summarize?: boolean; summaryBase?: ChatSession; replaceMessageId?: string},
  resultContent: string,
  assistantUpdatedAt: number,
  replyCharId: string | undefined,
  messages: ChatMessage[],
  promptConfig: PromptConfig,
  requestInfo: ChatMessage['requestInfo'],
  applyResult: (summarized: ChatSession) => void,
): Promise<void> {
  if (!opts.summarize || !opts.summaryBase) {
    return;
  }
  const sumConfig = getSummarizationConfig(promptConfig);
  if (!sumConfig.enabled) {
    return;
  }
  const finalAssistantMessage: ChatMessage = {
    id: opts.replaceMessageId ?? '',
    role: 'assistant',
    content: resultContent,
    timestamp: assistantUpdatedAt,
    requestInfo,
    ...(replyCharId ? {characterId: replyCharId} : {}),
  };
  const withAssistant: ChatSession = {
    ...opts.summaryBase,
    messages: opts.replaceMessageId
      ? opts.summaryBase.messages.map(m =>
          m.id === opts.replaceMessageId ? finalAssistantMessage : m,
        )
      : [...messages, finalAssistantMessage],
    updatedAt: assistantUpdatedAt,
  };
  const summarized = await checkAndSummarize(withAssistant, sumConfig, promptConfig);
  if (summarized.messages.length !== withAssistant.messages.length) {
    applyResult(summarized);
  }
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
  messagesData: (ChatMessage & {id: string})[];
  replacingMessageId: string | null;
  variantIndexMap: Record<string, number>;
  handleSend: (text: string) => Promise<void>;
  handleContinue: (target?: {character?: Character | null; qc?: QuickCharacter | null}) => Promise<void>;
  handleEditMessage: (msg: ChatMessage) => void;
  handleEditSave: (msg: ChatMessage, newText: string) => void;
  handleEditCancel: () => void;
  handleCopyMessage: (msg: ChatMessage) => void;
  handleDeleteMessage: (msg: ChatMessage) => void;
  handleRegenerate: () => Promise<void>;
  handleSwitchVariant: (msgId: string, direction: 1 | -1) => Promise<void>;
  handleSelectVariant: (msgId: string, targetSlotIndex: number) => Promise<void>;
  handleStudioEditEntry: (msgId: string, entryKey: string, newText: string) => Promise<void>;
  handleStudioFork: (msgId: string, sourceKey: string) => Promise<string | null>;
  handleStudioFresh: (msgId: string) => Promise<string | null>;
  handleStudioDeleteEntry: (msgId: string, entryKey: string) => Promise<void>;
  handleRetryError: () => Promise<void>;
  handleStop: () => void;
} {
  const lorebooks = useAppStore(s => s.lorebooks);
  const allCharacters = useAppStore(s => s.characters);
  const promptConfigVersion = useAppStore(s => s.promptConfigVersion);

  const [session, setSession] = useState<ChatSession | null>(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [promptConfig, setPromptConfig] = useState<PromptConfig>(DEFAULT_PROMPT_CONFIG);
  const [lorebook, setLorebook] = useState<LorebookState[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedReplyCharacter, setSelectedReplyCharacter] = useState<Character | null>(null);
  const [selectedQC, setSelectedQC] = useState<QuickCharacter | null>(null);
  const [variantIndexMap, setVariantIndexMap] = useState<Record<string, number>>({});
  const variantIndexMapRef = useRef(variantIndexMap);
  useEffect(() => {
    variantIndexMapRef.current = variantIndexMap;
  }, [variantIndexMap]);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingContentRef = useRef('');
  const streamingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replacingMessageIdRef = useRef<string | null>(null);
  const [replacingMessageId, setReplacingMessageId] = useState<string | null>(null);
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
      if (streamingTimerRef.current) {
        clearTimeout(streamingTimerRef.current);
        streamingTimerRef.current = null;
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, []);

  const pendingCreationKeyRef = useRef<string | null>(null);

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
      setSession(prev => (prev && prev.id === startSessionId ? updater(prev) : prev));
    },
    [],
  );

  const flushStreamingContent = useCallback((token: string) => {
    streamingContentRef.current += token;
    if (!streamingTimerRef.current) {
      streamingTimerRef.current = setTimeout(() => {
        streamingTimerRef.current = null;
        setStreamingContent(streamingContentRef.current);
      }, 50);
    }
  }, []);

  const resetStreamingContent = useCallback(() => {
    if (streamingTimerRef.current) {
      clearTimeout(streamingTimerRef.current);
      streamingTimerRef.current = null;
    }
    streamingContentRef.current = '';
    setStreamingContent('');
  }, []);

  const isGroupChat = !!groupChat;
  const groupMembers = useMemo(() => {
    if (!isGroupChat || !groupChat) return [];
    return groupChat.characterIds.map(id => allCharacters.find(c => c.id === id)).filter(Boolean) as Character[];
  }, [isGroupChat, groupChat, allCharacters]);
  const activeCharacter = character || (groupMembers.length > 0 ? groupMembers[0] : null);

  const persistMessage = useCallback(async (sessionId: string, message: ChatMessage, updatedAt: number) => {
    try {
      await addMessage(sessionId, message);
      updateSessionTimestamp(sessionId, updatedAt);
    } catch (e) {
      console.warn('Failed to persist message:', e);
    }
  }, []);

  useEffect(() => {
    loadPromptConfig()
      .then(setPromptConfig)
      .catch(e => console.warn('Failed to load prompt config:', e));
  }, [promptConfigVersion]);

  useEffect(() => {
    let cancelled = false;
    if (!isGroupChat && activeCharacter?.lorebookIds?.length) {
      const found = activeCharacter.lorebookIds
        .map(id => lorebooks.find(l => l.id === id))
        .filter(Boolean) as LorebookState[];
      (async () => {
        const withEntries = await Promise.all(
          found.map(async lb => ({
            ...lb,
            entries: await getLorebookEntriesFromDB(lb.id),
          })),
        );
        if (!cancelled) setLorebook(withEntries);
      })();
    } else {
      setLorebook([]);
    }
    return () => {
      cancelled = true;
    };
  }, [isGroupChat, activeCharacter, lorebooks]);

  const loadOrCreateSession = useCallback(async () => {
    try {
      if (activeSessionId) {
        const existing = await getSessionById(activeSessionId);
        if (existing) {
          setSession(existing);
          if (isGroupChat && existing.lastReplyCharacterId) {
            const lastChar = groupMembers.find(c => c.id === existing.lastReplyCharacterId);
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
        await createSession(newSession);
        setSession(newSession);
        onSessionCreated(newSession.id);
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
      await createSession(newSession);
      setSession(newSession);
      onSessionCreated(newSession.id);
    } catch (e) {
      pendingCreationKeyRef.current = null;
      console.warn('Failed to load or create session:', e);
    }
  }, [activeSessionId, isGroupChat, groupChat, groupMembers, activeCharacter, onSessionCreated]);

  useEffect(() => {
    loadOrCreateSession();
  }, [activeSessionId, loadOrCreateSession]);

  useEffect(() => {
    setSelectedQC(null);
  }, [activeSessionId]);

  useEffect(() => {
    if (selectedQC && !quickCharacters.find(q => q.id === selectedQC.id)) {
      setSelectedQC(null);
    }
  }, [quickCharacters, selectedQC]);

  // Shared send/retry/regenerate engine. `messages` is the conversation
  // history handed to the model; `userText` is the latest user turn. Cancel
  // saves append the partial stream to the *current* session's messages (which,
  // for all three callers, equals the base messages they passed in).
  const runLLMRequest = useCallback(
    async (
      startSessionId: string,
      messages: ChatMessage[],
      userText: string,
      opts: {
        setLastReplyCharacter?: boolean;
        summarize?: boolean;
        summaryBase?: ChatSession;
        replaceMessageId?: string;
        existingVariants?: ReplyVariant[];
        continueMode?: boolean;
        continueTarget?: {character?: Character | null; qc?: QuickCharacter | null};
      } = {},
    ) => {
      setSending(true);
      setError(null);
      replacingMessageIdRef.current = opts.replaceMessageId ?? null;
      setReplacingMessageId(opts.replaceMessageId ?? null);
      const targetReplyCharacter = opts.continueTarget
        ? (opts.continueTarget.character ?? null)
        : (isGroupChat ? selectedReplyCharacter : null);
      const targetQC = opts.continueTarget
        ? (opts.continueTarget.qc ?? null)
        : selectedQC;
      try {
        streamingContentRef.current = '';
        setIsStreaming(true);
        const ctrl = new AbortController();
        abortControllerRef.current = ctrl;

        let result;
        if (isGroupChat && targetReplyCharacter) {
          result = await sendToGroupLLM(
            groupMembers,
            targetReplyCharacter,
            userText,
            messages,
            promptConfig,
            flushStreamingContent,
            ctrl,
            opts.continueMode,
          );
        } else if (targetQC && activeCharacter) {
          result = await sendToQCLLM(
            targetQC,
            activeCharacter,
            quickCharacters,
            userText,
            messages,
            promptConfig,
            flushStreamingContent,
            ctrl,
            opts.continueMode,
          );
        } else if (activeCharacter) {
          result = await sendToLLM(
            activeCharacter,
            userText,
            messages,
            promptConfig,
            flushStreamingContent,
            lorebook,
            ctrl,
            opts.continueMode,
          );
        } else {
          return;
        }

        const replyCharId = (isGroupChat && targetReplyCharacter)
          ? targetReplyCharacter.id
          : targetQC
            ? targetQC.id
            : (quickCharacters.length > 0 && activeCharacter ? activeCharacter.id : undefined);
        const assistantUpdatedAt = Date.now();
        const requestInfo = serializeRequest(result.request);
        if (opts.replaceMessageId) {
          const replaceId = opts.replaceMessageId;
          updateSessionIfCurrent(startSessionId, prev => ({
            ...prev,
            messages: prev.messages.map(m =>
              m.id === replaceId
                ? {
                    ...m,
                    content: result.content,
                    timestamp: assistantUpdatedAt,
                    characterId: replyCharId ?? m.characterId,
                    variants: opts.existingVariants ?? m.variants,
                    requestInfo,
                  }
                : m,
            ),
            updatedAt: assistantUpdatedAt,
          }));
          updateMessageWithVariants(
            replaceId,
            result.content,
            assistantUpdatedAt,
            opts.existingVariants ?? [],
            requestInfo,
          );
          updateSessionTimestamp(startSessionId, assistantUpdatedAt);
        } else {
          const assistantMessage: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: result.content,
            timestamp: assistantUpdatedAt,
            requestInfo,
            ...(replyCharId ? {characterId: replyCharId} : {}),
          };
          updateSessionIfCurrent(startSessionId, prev => ({
            ...prev,
            messages: [...prev.messages, assistantMessage],
            updatedAt: assistantUpdatedAt,
          }));
          persistMessage(startSessionId, assistantMessage, assistantUpdatedAt);
        }
        if (opts.setLastReplyCharacter && isGroupChat && targetReplyCharacter) {
          setLastReplyCharacterId(startSessionId, targetReplyCharacter.id);
        }
        notifyCompletion();
        setIsStreaming(false);
        resetStreamingContent();
        logEvent('message_streamed', {
          charCount: result.content.length,
          durationMs: result.metrics.totalMs,
          sessionMsgCount: messages.length + 1,
        });

        await maybeSummarize(
          opts,
          result.content,
          assistantUpdatedAt,
          replyCharId,
          messages,
          promptConfig,
          requestInfo,
          summarized => updateSessionIfCurrent(startSessionId, () => summarized),
        );
      } catch (e: unknown) {
        setIsStreaming(false);
        const isCancelled = e instanceof Error && e.message === 'Request was cancelled';
        if (isCancelled) {
          const partial = streamingContentRef.current;
          const cancelledRequest = (e as Error & {request?: RawRequest}).request;
          const cancelRequestInfo = cancelledRequest ? serializeRequest(cancelledRequest) : undefined;
          if (opts.replaceMessageId) {
            const replaceId = opts.replaceMessageId;
            const existingVariants = opts.existingVariants ?? [];
            if (partial.length > 0) {
              const cancelUpdatedAt = Date.now();
              updateSessionIfCurrent(startSessionId, prev => ({
                ...prev,
                messages: prev.messages.map(m =>
                  m.id === replaceId
                    ? {...m, content: partial, timestamp: cancelUpdatedAt, variants: existingVariants, requestInfo: cancelRequestInfo}
                    : m,
                ),
                updatedAt: cancelUpdatedAt,
              }));
              updateMessageWithVariants(replaceId, partial, cancelUpdatedAt, existingVariants, cancelRequestInfo);
              updateSessionTimestamp(startSessionId, cancelUpdatedAt);
            }
          } else if (partial.length > 0) {
            const cancelReplyCharId = (isGroupChat && targetReplyCharacter)
              ? targetReplyCharacter.id
              : targetQC
                ? targetQC.id
                : (quickCharacters.length > 0 && activeCharacter ? activeCharacter.id : undefined);
            const assistantMessage: ChatMessage = {
              id: generateId(),
              role: 'assistant',
              content: partial,
              timestamp: Date.now(),
              requestInfo: cancelRequestInfo,
              ...(cancelReplyCharId ? {characterId: cancelReplyCharId} : {}),
            };
            const cancelUpdatedAt = Date.now();
            updateSessionIfCurrent(startSessionId, prev => ({
              ...prev,
              messages: [...prev.messages, assistantMessage],
              updatedAt: cancelUpdatedAt,
            }));
            persistMessage(startSessionId, assistantMessage, cancelUpdatedAt);
          }
          resetStreamingContent();
        } else {
          setError(e instanceof Error ? e.message : 'Something went wrong. Tap to retry.');
          resetStreamingContent();
        }
      } finally {
        abortControllerRef.current = null;
        replacingMessageIdRef.current = null;
        setReplacingMessageId(null);
        setSending(false);
      }
    },
    [isGroupChat, selectedReplyCharacter, selectedQC, quickCharacters, groupMembers, activeCharacter, promptConfig, lorebook, persistMessage, flushStreamingContent, resetStreamingContent, updateSessionIfCurrent],
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
      setSession(withUser);
      persistMessage(startSessionId, userMessage, withUser.updatedAt);
      setInputText('');
      logEvent('message_sent', {
        charCount: userMessage.content.length,
        sessionMsgCount: withUser.messages.length,
        isGroupChat,
        isQC: !!selectedQC,
      });
      scrollTimeoutRef.current = setTimeout(() => flatListRef.current?.scrollToOffset({offset: 0, animated: true}), 50);

      await runLLMRequest(startSessionId, withUser.messages, trimmed, {
        setLastReplyCharacter: true,
        summarize: true,
        summaryBase: withUser,
      });
    },
    [session, sending, isGroupChat, selectedReplyCharacter, selectedQC, persistMessage, runLLMRequest],
  );

  const handleContinue = useCallback(
    async (target?: {character?: Character | null; qc?: QuickCharacter | null}) => {
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
    [session, sending, isGroupChat, selectedReplyCharacter, selectedQC, runLLMRequest],
  );

  const handleEditMessage = useCallback((msg: ChatMessage) => {
    setSelectedMessageId(null);
    setEditingMessageId(msg.id);
    setEditingText(msg.content);
  }, []);

  const handleEditSave = useCallback(async (msg: ChatMessage, newText: string) => {
    if (!session) {return;}
    const trimmed = newText.trim();
    if (!trimmed) {return;}
    const updated = session.messages.map(m =>
      m.id === msg.id ? {...m, content: trimmed} : m,
    );
    setSession({...session, messages: updated, updatedAt: Date.now()});
    try {
      await updateMessage(msg.id, trimmed);
      updateSessionTimestamp(session.id, Date.now());
      logEvent('message_edited', {oldCharCount: msg.content.length, newCharCount: trimmed.length});
    } catch (e) {
      console.warn('Failed to save message edit:', e);
    }
    setEditingMessageId(null);
    setEditingText('');
  }, [session]);

  const handleEditCancel = useCallback(() => {
    setEditingMessageId(null);
    setEditingText('');
  }, []);

  const handleCopyMessage = useCallback((msg: ChatMessage) => {
    Clipboard.setString(msg.content);
    setSelectedMessageId(null);
  }, []);

  const handleDeleteMessage = useCallback((msg: ChatMessage) => {
    if (!session) {return;}
    const updated = session.messages.filter(m => m.id !== msg.id);
    setSession({...session, messages: updated, updatedAt: Date.now()});
    deleteMessage(msg.id);
    updateSessionTimestamp(session.id, Date.now());
    logEvent('message_deleted', {charCount: msg.content.length});
    setSelectedMessageId(null);
  }, [session]);

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
    const lastUserMsg = [...baseMessages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) {
      return;
    }

    const archivedVariant: ReplyVariant = {
      id: generateId(),
      content: lastMsg.content,
      timestamp: lastMsg.timestamp,
      ...(lastMsg.characterId ? {characterId: lastMsg.characterId} : {}),
    };
    const existingVariants = [...(lastMsg.variants ?? []), archivedVariant];

    updateSessionIfCurrent(startSessionId, prev => ({
      ...prev,
      messages: prev.messages.map(m =>
        m.id === lastMsg.id ? {...m, variants: existingVariants} : m,
      ),
      updatedAt: Date.now(),
    }));
    updateSessionTimestamp(startSessionId, Date.now());
    setSelectedMessageId(null);
    setVariantIndexMap(prev => ({...prev, [lastMsg.id]: existingVariants.length}));

    await runLLMRequest(startSessionId, baseMessages, lastUserMsg.content, {
      replaceMessageId: lastMsg.id,
      existingVariants,
    });
    logEvent('message_regenerated', {sessionMsgCount: baseMessages.length});
  }, [session, sending, updateSessionIfCurrent, runLLMRequest]);

  const commitVariantUpdate = useCallback(
    async (
      baseSession: ChatSession,
      msgId: string,
      updatedMsg: ChatMessage,
      deckIndex?: number,
      logName?: string,
    ) => {
      const updatedMessages = baseSession.messages.map(m => (m.id === msgId ? updatedMsg : m));
      setSession({...baseSession, messages: updatedMessages, updatedAt: Date.now()});
      const idx = deckIndex ?? liveDeckIndex(updatedMsg);
      setVariantIndexMap(prev => ({...prev, [msgId]: idx}));
      try {
        await updateMessageWithVariants(
          msgId,
          updatedMsg.content,
          updatedMsg.timestamp,
          updatedMsg.variants ?? [],
        );
      } catch (e) {
        console.warn('Failed to update message variants:', e);
      }
      updateSessionTimestamp(baseSession.id, Date.now());
      if (logName) {
        logEvent(logName, {role: updatedMsg.role});
      }
    },
    [],
  );

  const handleSwitchVariant = useCallback(async (msgId: string, direction: 1 | -1) => {
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
    };
    await commitVariantUpdate(session, msgId, updatedMsg, newIdx);
  }, [session, commitVariantUpdate]);

  const handleSelectVariant = useCallback(async (msgId: string, targetDeckIndex: number) => {
    if (!session) {
      return;
    }
    const msg = session.messages.find(m => m.id === msgId);
    if (!msg || !msg.variants || msg.variants.length === 0) {
      return;
    }

    const deck = [...msg.variants, makeVariantEntry('live', msg)].sort((a, b) => a.timestamp - b.timestamp);
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
    };
    await commitVariantUpdate(session, msgId, updatedMsg, clamped);
  }, [session, commitVariantUpdate]);

  const handleStudioEditEntry = useCallback(async (msgId: string, entryKey: string, newText: string) => {
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
      updatedMsg = {...msg, content: trimmed, timestamp: Date.now()};
    } else {
      updatedMsg = {
        ...msg,
        variants: (msg.variants ?? []).map(v =>
          v.id === entryKey ? {...v, content: trimmed, timestamp: Date.now()} : v,
        ),
      };
    }
    await commitVariantUpdate(session, msgId, updatedMsg, undefined, 'variant_edited');
  }, [session, commitVariantUpdate]);

  const handleStudioFork = useCallback(async (msgId: string, sourceKey: string): Promise<string | null> => {
    if (!session) {
      return null;
    }
    const msg = session.messages.find(m => m.id === msgId);
    if (!msg) {
      return null;
    }
    const sourceVariant = sourceKey === 'live' ? null : (msg.variants ?? []).find(v => v.id === sourceKey);
    const sourceContent = sourceKey === 'live' ? msg.content : (sourceVariant?.content ?? msg.content);
    const sourceCharId = sourceKey === 'live' ? msg.characterId : (sourceVariant?.characterId ?? msg.characterId);
    const newVariant: ReplyVariant = {
      id: generateId(),
      content: sourceContent,
      timestamp: Date.now(),
      ...(sourceCharId ? {characterId: sourceCharId} : {}),
    };
    const oldEntry = makeVariantEntry(generateId(), msg);
    const newVariants = [...(msg.variants ?? []), oldEntry];
    const updatedMsg: ChatMessage = {
      ...msg,
      content: newVariant.content,
      timestamp: newVariant.timestamp,
      characterId: newVariant.characterId ?? msg.characterId,
      variants: newVariants,
    };
    await commitVariantUpdate(session, msgId, updatedMsg, undefined, 'variant_forked');
    return 'live';
  }, [session, commitVariantUpdate]);

  const handleStudioFresh = useCallback(async (msgId: string): Promise<string | null> => {
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
    };
    await commitVariantUpdate(session, msgId, updatedMsg, undefined, 'variant_fresh');
    return 'live';
  }, [session, commitVariantUpdate]);

  const handleStudioDeleteEntry = useCallback(async (msgId: string, entryKey: string) => {
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
      const deck = [...(msg.variants ?? []), liveEntry].sort((a, b) => a.timestamp - b.timestamp);
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
      };
    } else {
      updatedMsg = {
        ...msg,
        variants: (msg.variants ?? []).filter(v => v.id !== entryKey),
      };
    }
    await commitVariantUpdate(session, msgId, updatedMsg, undefined, 'variant_deleted');
  }, [session, handleDeleteMessage, commitVariantUpdate]);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleRetryError = useCallback(async () => {
    if (!session || sending) {
      return;
    }
    const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) {
      return;
    }

    await runLLMRequest(session.id, session.messages, lastUserMsg.content);
  }, [session, sending, runLLMRequest]);

  const messagesData = useMemo(() => {
    const base = [...(session?.messages ?? [])].reverse();
    const replaceId = replacingMessageId;
    const showInlineStream = isStreaming && replaceId && streamingContent.length > 0;
    const showInlineTyping = sending && streamingContent.length === 0 && !error && replaceId;
    if (showInlineStream || showInlineTyping) {
      const streamContent = showInlineStream ? streamingContent : '';
      return base.map(m =>
        m.id === replaceId
          ? {...m, content: streamContent, timestamp: Date.now()}
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
  }, [session?.messages, isStreaming, streamingContent, sending, error, replacingMessageId]);

  return {
    session,
    inputText,
    setInputText,
    sending,
    isStreaming,
    streamingContent,
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
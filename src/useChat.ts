import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {Character} from './CharacterEditor';
import {loadPromptConfig, sendToLLM, sendToGroupLLM, PromptConfig, DEFAULT_PROMPT_CONFIG} from './PromptHandler';
import {LorebookState} from './RAGHandler';
import {useAppStore, GroupChat} from './store';
import {
  getSessionById,
  createSession,
  addMessage,
  deleteMessage,
  updateMessage,
  updateSessionTimestamp,
  setLastReplyCharacterId,
  generateId,
} from './Database';
import {checkAndSummarize, getSummarizationConfig} from './Summarizer';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  characterId?: string;
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

export function useChat({
  character,
  groupChat,
  activeSessionId,
  onSessionCreated,
}: {
  character?: Character | null;
  groupChat?: GroupChat | null;
  activeSessionId: string | null;
  onSessionCreated: (sessionId: string) => void;
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
  groupMembers: Character[];
  flatListRef: React.RefObject<FlatList<ChatMessage> | null>;
  messagesData: (ChatMessage & {id: string})[];
  handleSend: (text: string) => Promise<void>;
  handleEditMessage: (msg: ChatMessage) => void;
  handleEditSave: (msg: ChatMessage, newText: string) => void;
  handleEditCancel: () => void;
  handleCopyMessage: (msg: ChatMessage) => void;
  handleDeleteMessage: (msg: ChatMessage) => void;
  handleRegenerate: () => Promise<void>;
  handleRetryError: () => Promise<void>;
  handleStop: () => void;
} {
  const lorebooks = useAppStore(s => s.lorebooks);
  const allCharacters = useAppStore(s => s.characters);

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
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingContentRef = useRef('');
  const streamingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always tracks the id of the session currently shown in the UI. Used to
  // detect when the active session changes mid-stream so that streamed results
  // are not applied to (or persisted into) the wrong session.
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = session?.id ?? null;
  }, [session?.id]);

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
    loadPromptConfig().then(setPromptConfig);
  }, []);

  useEffect(() => {
    if (!isGroupChat && activeCharacter?.lorebookIds?.length) {
      const found = activeCharacter.lorebookIds
        .map(id => lorebooks.find(l => l.id === id))
        .filter(Boolean) as LorebookState[];
      setLorebook(found);
    } else {
      setLorebook([]);
    }
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

      if (isGroupChat) {
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

      if (!activeCharacter) return;

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
      console.warn('Failed to load or create session:', e);
    }
  }, [activeSessionId, isGroupChat, groupChat, groupMembers, activeCharacter, onSessionCreated]);

  useEffect(() => {
    loadOrCreateSession();
  }, [activeSessionId, loadOrCreateSession]);

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
      } = {},
    ) => {
      setSending(true);
      setError(null);
      try {
        streamingContentRef.current = '';
        setIsStreaming(true);
        const ctrl = new AbortController();
        abortControllerRef.current = ctrl;

        let result;
        if (isGroupChat && selectedReplyCharacter) {
          result = await sendToGroupLLM(
            groupMembers,
            selectedReplyCharacter,
            userText,
            messages,
            promptConfig,
            flushStreamingContent,
            ctrl,
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
          );
        } else {
          return;
        }

        const assistantMessage: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: result.content,
          timestamp: Date.now(),
          ...(isGroupChat && selectedReplyCharacter ? {characterId: selectedReplyCharacter.id} : {}),
        };
        const assistantUpdatedAt = Date.now();
        updateSessionIfCurrent(startSessionId, prev => ({
          ...prev,
          messages: [...prev.messages, assistantMessage],
          updatedAt: assistantUpdatedAt,
        }));
        persistMessage(startSessionId, assistantMessage, assistantUpdatedAt);
        if (opts.setLastReplyCharacter && isGroupChat && selectedReplyCharacter) {
          setLastReplyCharacterId(startSessionId, selectedReplyCharacter.id);
        }
        setIsStreaming(false);
        resetStreamingContent();

        if (opts.summarize && opts.summaryBase) {
          const sumConfig = getSummarizationConfig(promptConfig);
          if (sumConfig.enabled) {
            const withAssistant: ChatSession = {
              ...opts.summaryBase,
              messages: [...messages, assistantMessage],
              updatedAt: assistantUpdatedAt,
            };
            const summarized = await checkAndSummarize(withAssistant, sumConfig, promptConfig);
            if (summarized.messages.length !== withAssistant.messages.length) {
              updateSessionIfCurrent(startSessionId, () => summarized);
            }
          }
        }
      } catch (e: unknown) {
        setIsStreaming(false);
        const isCancelled = e instanceof Error && e.message === 'Request was cancelled';
        if (isCancelled) {
          const partial = streamingContentRef.current;
          if (partial.length > 0) {
            const assistantMessage: ChatMessage = {
              id: generateId(),
              role: 'assistant',
              content: partial,
              timestamp: Date.now(),
              ...(isGroupChat && selectedReplyCharacter ? {characterId: selectedReplyCharacter.id} : {}),
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
        setSending(false);
      }
    },
    [isGroupChat, selectedReplyCharacter, groupMembers, activeCharacter, promptConfig, lorebook, persistMessage, flushStreamingContent, resetStreamingContent, updateSessionIfCurrent],
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
      setTimeout(() => flatListRef.current?.scrollToOffset({offset: 0, animated: true}), 50);

      await runLLMRequest(startSessionId, withUser.messages, trimmed, {
        setLastReplyCharacter: true,
        summarize: true,
        summaryBase: withUser,
      });
    },
    [session, sending, isGroupChat, selectedReplyCharacter, persistMessage, runLLMRequest],
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
    await updateMessage(msg.id, trimmed);
    updateSessionTimestamp(session.id, Date.now());
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
    const updated = session.messages.slice(0, -1);
    updateSessionIfCurrent(startSessionId, prev => ({...prev, messages: updated, updatedAt: Date.now()}));
    deleteMessage(lastMsg.id);
    updateSessionTimestamp(startSessionId, Date.now());
    setSelectedMessageId(null);

    const lastUserMsg = [...updated].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) {
      return;
    }

    await runLLMRequest(startSessionId, updated, lastUserMsg.content);
  }, [session, sending, updateSessionIfCurrent, runLLMRequest]);

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
  }, [session?.messages, isStreaming, streamingContent, sending, error]);

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
    groupMembers,
    flatListRef,
    messagesData,
    handleSend,
    handleEditMessage,
    handleEditSave,
    handleEditCancel,
    handleCopyMessage,
    handleDeleteMessage,
    handleRegenerate,
    handleRetryError,
    handleStop,
  };
}
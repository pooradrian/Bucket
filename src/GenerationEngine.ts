import { create } from 'zustand';
import type { Character } from './CharacterEditor';
import { useAppStore } from './store';
import type { GroupChat } from './store';
import type { LorebookState } from './RAGHandler';
import type { ChatMessage, QuickCharacter, ReplyVariant } from './useChat';
import {
  loadPromptConfig,
  sendToGroupLLM,
  sendToLLM,
  sendToQCLLM,
  stripSpeakerNamePrefixes,
  historyWithoutLatestUserTurn,
} from './PromptHandler';
import type { RetrievalInfo } from './PromptHandler';
import type { RawRequest } from './Endpoint';
import {
  applyDisplacements,
  DisplacementRule,
  parseDisplacements,
} from './displacement';
import { splitThinking } from './thinking';
import {
  addMessage,
  generateId,
  getSessionById,
  setLastReplyCharacterId,
  updateMessageWithVariants,
  updateSessionTimestamp,
} from './Database';
import { checkAndSummarize, getSummarizationConfig } from './Summarizer';
import {
  buildMemoryContext,
  getMemoryConfig,
  loadMemorySettings,
  memoryScopeId,
  queueMemoryPass,
} from './Memory';
import { logEvent } from './EventLogger';
import { playNotificationSound, vibrateDevice } from './NotificationModule';

const STREAM_FLUSH_MS = 50;

export interface GenerationRequest {
  sessionId: string;
  character: Character | null;
  groupChat: GroupChat | null;
  groupMembers: Character[];
  replyCharacter?: Character | null;
  qc?: QuickCharacter | null;
  quickCharacters: QuickCharacter[];
  messages: ChatMessage[];
  userText: string;
  lorebooks?: LorebookState[];
  summarize?: boolean;
  continueMode?: boolean;
  replaceMessageId?: string;
  existingVariants?: ReplyVariant[];
  setLastReplyCharacter?: boolean;
}

export interface GenerationRun {
  sessionId: string;
  characterId?: string;
  groupChatId?: string;
  label: string;
  icon?: string;
  startedAt: number;
  content: string;
  thinkingMs?: number;
  phase: 'rag' | 'generating';
  /** Transient label for the typing bubble, e.g. attachment upload progress. */
  status?: string;
  rag?: RetrievalInfo;
  replaceMessageId?: string;
}

interface GenerationStore {
  runs: Record<string, GenerationRun>;
  errors: Record<string, string>;
  revisions: Record<string, number>;
  start: (request: GenerationRequest) => void;
  stop: (sessionId: string) => void;
  clearError: (sessionId: string) => void;
}

const controllers = new Map<string, AbortController>();

function notifyCompletion(): void {
  const { appSettings } = useAppStore.getState();
  if (
    appSettings.notificationMode === 'vibrate' ||
    appSettings.notificationMode === 'both'
  ) {
    vibrateDevice();
  }
  if (
    appSettings.notificationMode === 'sound' ||
    appSettings.notificationMode === 'both'
  ) {
    playNotificationSound(appSettings.notificationSound);
  }
}

function serializeRequest(request: RawRequest, rag?: RetrievalInfo): string {
  const strippedBody = { ...request.body };
  delete (strippedBody as Record<string, unknown>).stream;
  return JSON.stringify({
    url: request.url,
    body: strippedBody,
    ...(rag ? { rag } : {}),
  });
}

function bumpRevision(sessionId: string): void {
  useGenerationStore.setState(state => ({
    revisions: {
      ...state.revisions,
      [sessionId]: (state.revisions[sessionId] ?? 0) + 1,
    },
  }));
}

/**
 * Sessions written straight to the DB for a character (e.g. by the msg.add
 * debugger command). An open chat still showing an unsaved, in-memory session
 * for that character switches to it instead of hiding it.
 */
export const useExternalSessions = create<{
  byCharacter: Record<string, string>;
}>(() => ({ byCharacter: {} }));

export function notifySessionCreated(
  characterId: string,
  sessionId: string,
): void {
  useExternalSessions.setState(s => ({
    byCharacter: { ...s.byCharacter, [characterId]: sessionId },
  }));
}

export function clearExternalSession(characterId: string): void {
  useExternalSessions.setState(s => {
    const rest = { ...s.byCharacter };
    delete rest[characterId];
    return { byCharacter: rest };
  });
}

/**
 * Tells an open chat for this session that its messages changed in the DB
 * (outside a generation run) so it reloads them.
 */
export function notifySessionChanged(sessionId: string): void {
  bumpRevision(sessionId);
}

function setRunContent(
  sessionId: string,
  content: string,
  thinkingMs?: number,
): void {
  useGenerationStore.setState(state => {
    const run = state.runs[sessionId];
    if (!run) return state;
    return {
      runs: {
        ...state.runs,
        [sessionId]: {
          ...run,
          content,
          thinkingMs: thinkingMs ?? run.thinkingMs,
        },
      },
    };
  });
}

function setRunPhase(sessionId: string, phase: GenerationRun['phase']): void {
  useGenerationStore.setState(state => {
    const run = state.runs[sessionId];
    if (!run || run.phase === phase) return state;
    return {
      runs: { ...state.runs, [sessionId]: { ...run, phase } },
    };
  });
}

function setRunStatus(sessionId: string, status: string | null): void {
  useGenerationStore.setState(state => {
    const run = state.runs[sessionId];
    if (!run || (run.status ?? null) === status) return state;
    return {
      runs: {
        ...state.runs,
        [sessionId]: { ...run, status: status ?? undefined },
      },
    };
  });
}

function setRunRag(sessionId: string, rag: RetrievalInfo): void {
  useGenerationStore.setState(state => {
    const run = state.runs[sessionId];
    if (!run) return state;
    return {
      runs: { ...state.runs, [sessionId]: { ...run, rag } },
    };
  });
}

function removeRun(sessionId: string): void {
  useGenerationStore.setState(state => {
    if (!state.runs[sessionId]) return state;
    const runs = { ...state.runs };
    delete runs[sessionId];
    return { runs };
  });
}

function setError(sessionId: string, error: string): void {
  useGenerationStore.setState(state => ({
    errors: { ...state.errors, [sessionId]: error },
  }));
}

function isCancelled(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.name === 'AbortError' || e.message === 'Request was cancelled')
  );
}

async function runGeneration(
  request: GenerationRequest,
  controller: AbortController,
): Promise<void> {
  const {
    sessionId,
    character,
    groupChat,
    groupMembers,
    replyCharacter,
    qc,
    quickCharacters,
    messages,
    userText,
    lorebooks,
  } = request;

  const speakerNames = [
    character?.name,
    qc?.name,
    replyCharacter?.name,
    ...quickCharacters.map(q => q?.name),
    ...groupMembers.map(c => c.name),
  ];

  const replyCharId =
    groupChat && replyCharacter
      ? replyCharacter.id
      : qc
        ? qc.id
        : quickCharacters.length > 0 && character
          ? character.id
          : undefined;

  let rules: DisplacementRule[] = [];
  let seed = 0;
  let raw = '';
  let displayed = '';
  let thinkingMs: number | undefined;
  let rag: RetrievalInfo | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const thinkStart = Date.now();

  const flush = () => {
    flushTimer = null;
    displayed = stripSpeakerNamePrefixes(
      applyDisplacements(raw, rules, seed),
      speakerNames,
    );
    if (thinkingMs == null) {
      const split = splitThinking(displayed);
      if (split.hasThinking && !split.open) {
        thinkingMs = Date.now() - thinkStart;
      }
    }
    setRunContent(sessionId, displayed, thinkingMs);
  };

  const onUpload = (fraction: number) => {
    if (raw) return;
    setRunStatus(
      sessionId,
      fraction >= 1
        ? null
        : `uploading attachments… ${Math.round(fraction * 100)}%`,
    );
  };

  const onToken = (token: string) => {
    if (!raw) setRunStatus(sessionId, null);
    raw += token;
    if (!flushTimer) {
      flushTimer = setTimeout(flush, STREAM_FLUSH_MS);
    }
  };

  try {
    const config = await loadPromptConfig();
    rules = parseDisplacements(config.wordDisplacements);
    seed = Math.floor(Math.random() * 0x7fffffff);

    const memorySettings = character
      ? loadMemorySettings(character.id)
      : undefined;
    const memoryConfig = memorySettings
      ? getMemoryConfig(memorySettings, config)
      : null;
    const memoryScope =
      memoryConfig?.enabled && character && !qc && !groupChat
        ? memoryScopeId(memoryConfig.scope, character.id, sessionId)
        : null;
    const wantsRetrieval =
      !qc && !groupChat && (!!memoryScope || (lorebooks?.length ?? 0) > 0);
    setRunPhase(sessionId, wantsRetrieval ? 'rag' : 'generating');
    const ragStart = performance.now();
    const memoryResults: string[] = [];
    let memoryContext: string | undefined;
    if (memoryScope && character) {
      const priorMessages = historyWithoutLatestUserTurn(messages, userText);
      try {
        const memory = await buildMemoryContext({
          scopeId: memoryScope,
          sessionId,
          priorLastMessageId: priorMessages[priorMessages.length - 1]?.id,
          userText,
          settings: memorySettings!,
          config,
          continueMode: request.continueMode,
        });
        memoryContext = memory.block;
        memoryResults.push(...memory.results);
      } catch (e) {
        console.warn('Memory retrieval failed:', e);
      }
    }

    const onRetrieval = (info: RetrievalInfo) => {
      if (!wantsRetrieval) return;
      rag = {
        ms: Math.round(performance.now() - ragStart),
        results: [...memoryResults, ...info.results],
      };
      setRunRag(sessionId, rag);
      setRunPhase(sessionId, 'generating');
    };

    let result;
    if (groupChat && replyCharacter) {
      result = await sendToGroupLLM(
        groupMembers,
        replyCharacter,
        userText,
        messages,
        config,
        onToken,
        controller,
        request.continueMode,
        onUpload,
      );
    } else if (qc && character) {
      result = await sendToQCLLM(
        qc,
        character,
        userText,
        messages,
        config,
        onToken,
        controller,
        request.continueMode,
        quickCharacters,
        onUpload,
      );
    } else if (character) {
      result = await sendToLLM(
        character,
        userText,
        messages,
        config,
        onToken,
        lorebooks,
        controller,
        request.continueMode,
        quickCharacters,
        memoryContext,
        onRetrieval,
        onUpload,
      );
    } else {
      throw new Error('No character selected for generation.');
    }

    const content = applyDisplacements(result.content, rules, seed);
    if (!content.trim()) {
      throw new Error(
        'The model returned an empty response. Try again, or use Continue.',
      );
    }

    const replyMessageId = request.replaceMessageId ?? generateId();
    const assistantUpdatedAt = Date.now();
    const requestInfo = serializeRequest(
      result.request,
      rag ?? (result as { retrieval?: RetrievalInfo }).retrieval,
    );
    if (thinkingMs == null) {
      const split = splitThinking(content);
      if (split.hasThinking && !split.open) {
        thinkingMs = Math.round(result.metrics.totalMs);
      }
    }

    if (request.replaceMessageId) {
      await updateMessageWithVariants(
        request.replaceMessageId,
        content,
        assistantUpdatedAt,
        request.existingVariants ?? [],
        requestInfo,
        thinkingMs,
        replyCharId,
      );
      updateSessionTimestamp(sessionId, assistantUpdatedAt);
    } else {
      const assistantMessage: ChatMessage = {
        id: replyMessageId,
        role: 'assistant',
        content,
        timestamp: assistantUpdatedAt,
        requestInfo,
        ...(replyCharId ? { characterId: replyCharId } : {}),
        ...(thinkingMs !== undefined ? { thinkingMs } : {}),
      };
      await addMessage(sessionId, assistantMessage);
      updateSessionTimestamp(sessionId, assistantUpdatedAt);
    }

    if (request.setLastReplyCharacter && groupChat && replyCharacter) {
      setLastReplyCharacterId(sessionId, replyCharacter.id);
    }

    logEvent('message_streamed', {
      charCount: content.length,
      durationMs: result.metrics.totalMs,
      sessionMsgCount: messages.length + 1,
    });
    notifyCompletion();

    if (request.summarize) {
      const sumConfig = getSummarizationConfig(config);
      if (sumConfig.enabled) {
        try {
          const latest = await getSessionById(sessionId);
          if (latest) {
            await checkAndSummarize(latest, sumConfig, config);
          }
        } catch (e) {
          console.warn('Failed to summarize session:', e);
        }
      }
    }

    if (memoryScope && character && memorySettings) {
      queueMemoryPass({
        sessionId,
        characterName: character.name,
        scopeId: memoryScope,
        messages: [
          ...messages,
          {
            id: replyMessageId,
            role: 'assistant',
            content,
            timestamp: assistantUpdatedAt,
          },
        ],
        settings: memorySettings,
        config,
      }).catch(e => console.warn('Memory pass failed:', e));
    }

    bumpRevision(sessionId);
  } catch (e: unknown) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (isCancelled(e)) {
      flush();
      const partial = displayed;
      const cancelledRequest = (e as Error & { request?: RawRequest }).request;
      const cancelRequestInfo = cancelledRequest
        ? serializeRequest(cancelledRequest, rag)
        : undefined;
      const partialSplit = splitThinking(partial);
      const cancelledThinkingMs =
        partialSplit.hasThinking && !partialSplit.open ? thinkingMs : undefined;
      try {
        if (request.replaceMessageId && partial.length > 0) {
          const cancelUpdatedAt = Date.now();
          await updateMessageWithVariants(
            request.replaceMessageId,
            partial,
            cancelUpdatedAt,
            request.existingVariants ?? [],
            cancelRequestInfo,
            cancelledThinkingMs,
            replyCharId,
          );
          updateSessionTimestamp(sessionId, cancelUpdatedAt);
        } else if (partial.length > 0) {
          const assistantMessage: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: partial,
            timestamp: Date.now(),
            requestInfo: cancelRequestInfo,
            ...(replyCharId ? { characterId: replyCharId } : {}),
            ...(cancelledThinkingMs !== undefined
              ? { thinkingMs: cancelledThinkingMs }
              : {}),
          };
          const cancelUpdatedAt = Date.now();
          await addMessage(sessionId, assistantMessage);
          updateSessionTimestamp(sessionId, cancelUpdatedAt);
        }
      } catch (persistError) {
        console.warn('Failed to save cancelled reply:', persistError);
      }
      bumpRevision(sessionId);
    } else {
      setError(
        sessionId,
        e instanceof Error ? e.message : 'Something went wrong. Tap to retry.',
      );
    }
  } finally {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    removeRun(sessionId);
    if (controllers.get(sessionId) === controller) {
      controllers.delete(sessionId);
    }
  }
}

export const useGenerationStore = create<GenerationStore>((set, get) => ({
  runs: {},
  errors: {},
  revisions: {},
  start: request => {
    if (get().runs[request.sessionId]) {
      return;
    }
    const controller = new AbortController();
    controllers.set(request.sessionId, controller);
    const target = request.replyCharacter ?? request.qc ?? request.character;
    set(state => ({
      runs: {
        ...state.runs,
        [request.sessionId]: {
          sessionId: request.sessionId,
          characterId: request.character?.id,
          groupChatId: request.groupChat?.id,
          label: target?.name ?? request.groupChat?.name ?? 'Character',
          icon: target?.icon,
          startedAt: Date.now(),
          content: '',
          phase: 'generating',
          replaceMessageId: request.replaceMessageId,
        },
      },
      errors: { ...state.errors, [request.sessionId]: '' },
    }));
    runGeneration(request, controller).catch(e => {
      console.warn('Generation engine failed:', e);
    });
  },
  stop: sessionId => {
    controllers.get(sessionId)?.abort();
  },
  clearError: sessionId => setError(sessionId, ''),
}));

export function startGeneration(request: GenerationRequest): void {
  useGenerationStore.getState().start(request);
}

export function stopGeneration(sessionId: string): void {
  useGenerationStore.getState().stop(sessionId);
}

export function clearGenerationError(sessionId: string): void {
  useGenerationStore.getState().clearError(sessionId);
}

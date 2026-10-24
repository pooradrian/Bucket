import { create } from 'zustand';
import type { Character } from './CharacterEditor';
import { useAppStore } from './store';
import type { GroupChat } from './store';
import type { LorebookState } from './RAGHandler';
import type {
  ChatMessage,
  QuickCharacter,
  ReplyVariant,
} from './useChat';
import {
  loadPromptConfig,
  sendToGroupLLM,
  sendToLLM,
  sendToQCLLM,
  stripSpeakerNamePrefixes,
} from './PromptHandler';
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

function serializeRequest(request: RawRequest): string {
  const strippedBody = { ...request.body };
  delete (strippedBody as Record<string, unknown>).stream;
  return JSON.stringify({ url: request.url, body: strippedBody });
}

function bumpRevision(sessionId: string): void {
  useGenerationStore.setState(state => ({
    revisions: {
      ...state.revisions,
      [sessionId]: (state.revisions[sessionId] ?? 0) + 1,
    },
  }));
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
        [sessionId]: { ...run, content, thinkingMs: thinkingMs ?? run.thinkingMs },
      },
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

  const onToken = (token: string) => {
    raw += token;
    if (!flushTimer) {
      flushTimer = setTimeout(flush, STREAM_FLUSH_MS);
    }
  };

  try {
    const config = await loadPromptConfig();
    rules = parseDisplacements(config.wordDisplacements);
    seed = Math.floor(Math.random() * 0x7fffffff);

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

    const assistantUpdatedAt = Date.now();
    const requestInfo = serializeRequest(result.request);
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
        id: generateId(),
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
        ? serializeRequest(cancelledRequest)
        : undefined;
      const partialSplit = splitThinking(partial);
      const cancelledThinkingMs =
        partialSplit.hasThinking && !partialSplit.open
          ? thinkingMs
          : undefined;
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

jest.mock('../src/PromptHandler', () => ({
  loadPromptConfig: jest.fn().mockResolvedValue({ wordDisplacements: '' }),
  sendToLLM: jest.fn(),
  sendToGroupLLM: jest.fn(),
  sendToQCLLM: jest.fn(),
  stripSpeakerNamePrefixes: (text: string) => text,
  historyWithoutLatestUserTurn: (history: unknown) => history,
}));

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: {},
  saveDocuments: jest.fn(),
  isKnownType: jest.fn(),
}));

jest.mock('../src/Database', () => ({
  addMessage: jest.fn().mockResolvedValue(undefined),
  getKV: jest.fn(() => null),
  setKV: jest.fn(),
  generateId: jest.fn().mockReturnValue('generated-id'),
  getSessionById: jest.fn().mockResolvedValue(null),
  setLastReplyCharacterId: jest.fn(),
  updateMessageWithVariants: jest.fn().mockResolvedValue(undefined),
  updateSessionTimestamp: jest.fn(),
}));

jest.mock('../src/Summarizer', () => ({
  checkAndSummarize: jest.fn(),
  getSummarizationConfig: jest.fn().mockReturnValue({ enabled: false }),
}));

jest.mock('../src/EventLogger', () => ({
  logEvent: jest.fn(),
}));

jest.mock('../src/NotificationModule', () => ({
  playNotificationSound: jest.fn(),
  vibrateDevice: jest.fn(),
}));

jest.mock('../src/store', () => ({
  useAppStore: {
    getState: () => ({ appSettings: { notificationMode: 'off' } }),
  },
}));

import { addMessage, updateMessageWithVariants } from '../src/Database';
import { sendToGroupLLM, sendToLLM } from '../src/PromptHandler';
import {
  GenerationRequest,
  startGeneration,
  stopGeneration,
  useGenerationStore,
} from '../src/GenerationEngine';

const mockSendToGroupLLM = sendToGroupLLM as jest.Mock;
const mockSendToLLM = sendToLLM as jest.Mock;
const mockAddMessage = addMessage as jest.Mock;
const mockUpdate = updateMessageWithVariants as jest.Mock;

const settle = () => new Promise(resolve => setImmediate(resolve));

const alice = {
  id: 'char-1',
  name: 'Alice',
} as unknown as GenerationRequest['character'];

const bob = {
  id: 'char-2',
  name: 'Bob',
} as unknown as GenerationRequest['replyCharacter'];

beforeEach(() => {
  jest.clearAllMocks();
  useGenerationStore.setState({ runs: {}, errors: {}, revisions: {} });
});

it('keeps the reply speaker when a regeneration is stopped', async () => {
  let controller: AbortController | null = null;

  mockSendToGroupLLM.mockImplementation(
    (
      _members: unknown,
      _replyCharacter: unknown,
      _userText: unknown,
      _messages: unknown,
      _config: unknown,
      onToken: (token: string) => void,
      abort: AbortController,
    ) => {
      onToken('partial reply');
      controller = abort;
      return new Promise((_resolve, reject) => {
        abort.signal.addEventListener('abort', () => {
          const error = new Error('Request was cancelled');
          error.name = 'AbortError';
          reject(error);
        });
      });
    },
  );

  startGeneration({
    sessionId: 'session-1',
    character: null,
    groupChat: {
      id: 'group-1',
      name: 'Group',
      description: '',
      characterIds: ['char-1', 'char-2'],
    },
    groupMembers: [alice!, bob!],
    replyCharacter: bob,
    quickCharacters: [],
    messages: [],
    userText: 'hi',
    replaceMessageId: 'message-1',
    existingVariants: [],
  });

  await settle();
  expect(controller).not.toBeNull();

  stopGeneration('session-1');
  await settle();

  expect(mockUpdate).toHaveBeenCalledWith(
    'message-1',
    'partial reply',
    expect.any(Number),
    [],
    undefined,
    undefined,
    'char-2',
  );
});

it('stores retrieval timing and results with the reply', async () => {
  mockSendToLLM.mockImplementation(
    async (
      _character: unknown,
      _userText: unknown,
      _messages: unknown,
      _config: unknown,
      _onToken: unknown,
      _lorebooks: unknown,
      _controller: unknown,
      _continueMode: unknown,
      _quickCharacters: unknown,
      _memoryContext: unknown,
      onRetrieval: (info: {
        ms: number;
        results: string[];
      }) => void,
    ) => {
      onRetrieval({ ms: 42, results: ['Elves live in Sylvara.'] });
      return {
        content: 'The elves wave.',
        request: { url: 'http://example.test', body: { messages: [] } },
        metrics: { promptBuildMs: 1, ttfbMs: 2, bodyReadMs: 3, totalMs: 4 },
        retrieval: { ms: 42, results: ['Elves live in Sylvara.'] },
      };
    },
  );

  startGeneration({
    sessionId: 'session-1',
    character: alice,
    groupChat: null,
    groupMembers: [],
    quickCharacters: [],
    messages: [],
    userText: 'hi',
  });

  await settle();
  await settle();

  expect(mockAddMessage).toHaveBeenCalled();
  const saved = mockAddMessage.mock.calls[0][1];
  const requestInfo = JSON.parse(saved.requestInfo);
  expect(requestInfo.rag.results).toEqual(['Elves live in Sylvara.']);
  expect(typeof requestInfo.rag.ms).toBe('number');
});

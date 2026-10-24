jest.mock('../src/PromptHandler', () => ({
  loadPromptConfig: jest.fn().mockResolvedValue({ wordDisplacements: '' }),
  sendToLLM: jest.fn(),
  sendToGroupLLM: jest.fn(),
  sendToQCLLM: jest.fn(),
  stripSpeakerNamePrefixes: (text: string) => text,
}));

jest.mock('../src/Database', () => ({
  addMessage: jest.fn().mockResolvedValue(undefined),
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

import { updateMessageWithVariants } from '../src/Database';
import { sendToGroupLLM } from '../src/PromptHandler';
import {
  GenerationRequest,
  startGeneration,
  stopGeneration,
  useGenerationStore,
} from '../src/GenerationEngine';

const mockSendToGroupLLM = sendToGroupLLM as jest.Mock;
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

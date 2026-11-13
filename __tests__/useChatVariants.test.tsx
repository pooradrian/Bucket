jest.mock('../src/Database', () => {
  let counter = 0;
  return {
    getSessionById: jest.fn(),
    createSession: jest.fn(),
    addMessage: jest.fn(),
    deleteMessage: jest.fn(),
    updateMessage: jest.fn(),
    updateMessageAttachments: jest.fn(),
    updateMessageWithVariants: jest.fn().mockResolvedValue(undefined),
    updateSessionTimestamp: jest.fn(),
    generateId: jest.fn(() => `gen-${++counter}`),
    getLorebookEntriesFromDB: jest.fn().mockResolvedValue([]),
  };
});

jest.mock('../src/GenerationEngine', () => {
  const { create } = require('zustand');
  const store = create(() => ({ runs: {}, errors: {}, revisions: {} }));
  return {
    useGenerationStore: store,
    startGeneration: jest.fn(),
    stopGeneration: jest.fn(),
    useExternalSessions: create(() => ({ byCharacter: {} })),
    clearExternalSession: jest.fn(),
  };
});

jest.mock('../src/EventLogger', () => ({
  logEvent: jest.fn(),
}));

// Stable state, like the real store: fresh arrays on every render would
// re-run the session loader and mask the in-memory state under test.
jest.mock('../src/store', () => {
  const state = { lorebooks: [], characters: [] };
  return {
    useAppStore: (selector: (s: unknown) => unknown) => selector(state),
  };
});

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: { setString: jest.fn() },
}));

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  getSessionById,
  updateMessageWithVariants,
} from '../src/Database';
import {
  startGeneration,
  useGenerationStore,
} from '../src/GenerationEngine';
import { useChat } from '../src/useChat';
import type { ChatMessage, ChatSession } from '../src/useChat';

const mockGetSessionById = getSessionById as jest.Mock;
const mockUpdateVariants = updateMessageWithVariants as jest.Mock;
const mockStartGeneration = startGeneration as jest.Mock;

const settle = () => new Promise(resolve => setImmediate(resolve));

const character = {
  id: 'char-1',
  name: 'Alice',
} as unknown as Parameters<typeof useChat>[0]['character'];

let latest: ReturnType<typeof useChat>;

function Probe({ id }: { id: string }) {
  latest = useChat({
    character,
    activeSessionId: id,
    onSessionCreated: jest.fn(),
    quickCharacters: [],
  });
  return null;
}

function makeSession(id: string, reply: ChatMessage | null): ChatSession {
  const user: ChatMessage = {
    id: `${id}-user`,
    role: 'user',
    content: 'hello',
    timestamp: 1,
  };
  return {
    id,
    characterId: 'char-1',
    messages: reply ? [user, reply] : [user],
    createdAt: 0,
    updatedAt: 0,
  };
}

function replyWithOneVariant(): ChatMessage {
  return {
    id: 'reply',
    role: 'assistant',
    content: 'live text',
    timestamp: 20,
    characterId: 'qc-dead',
    speakerName: 'Ghost',
    variants: [
      {
        id: 'v1',
        content: 'older text',
        timestamp: 10,
        characterId: 'qc-alive',
      },
    ],
  };
}

async function mount(session: ChatSession) {
  mockGetSessionById.mockImplementation(async () => session);
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<Probe id={session.id} />);
    await settle();
  });
  expect(latest.session?.id).toBe(session.id);
}

function replyOf(): ChatMessage {
  const msg = latest.session!.messages.find(m => m.id === 'reply');
  expect(msg).toBeDefined();
  return msg!;
}

// startGeneration is mocked; emulate the engine registering a run.
function engineStartsRuns() {
  mockStartGeneration.mockImplementation(
    (req: { sessionId: string; replaceMessageId?: string }) => {
      useGenerationStore.setState(state => ({
        runs: {
          ...state.runs,
          [req.sessionId]: {
            sessionId: req.sessionId,
            label: 'Alice',
            startedAt: 0,
            content: '',
            phase: 'generating',
            replaceMessageId: req.replaceMessageId,
          },
        },
        errors: { ...state.errors, [req.sessionId]: '' },
      }));
    },
  );
}

async function engineFails(sessionId: string) {
  await ReactTestRenderer.act(async () => {
    useGenerationStore.setState(state => ({
      errors: { ...state.errors, [sessionId]: 'Network error' },
    }));
    useGenerationStore.setState(state => {
      const runs = { ...state.runs };
      delete runs[sessionId];
      return { runs };
    });
    await settle();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStartGeneration.mockReset();
  useGenerationStore.setState({ runs: {}, errors: {}, revisions: {} });
});

describe('variant switching carries speaker fields', () => {
  it('drops a stamped name when switching to a reply by someone else, and restores it on the way back', async () => {
    await mount(makeSession('S1', replyWithOneVariant()));

    await ReactTestRenderer.act(async () => {
      await latest.handleSwitchVariant('reply', -1);
    });
    let msg = replyOf();
    expect(msg.content).toBe('older text');
    expect(msg.characterId).toBe('qc-alive');
    expect(msg.speakerName).toBeUndefined();
    expect(msg.variants).toHaveLength(1);
    expect(msg.variants![0]).toMatchObject({
      content: 'live text',
      characterId: 'qc-dead',
      speakerName: 'Ghost',
    });
    let call = mockUpdateVariants.mock.calls.at(-1)!;
    expect(call[6]).toBe('qc-alive');
    expect(call[7]).toBeUndefined();

    await ReactTestRenderer.act(async () => {
      await latest.handleSwitchVariant('reply', 1);
    });
    msg = replyOf();
    expect(msg.content).toBe('live text');
    expect(msg.characterId).toBe('qc-dead');
    expect(msg.speakerName).toBe('Ghost');
    call = mockUpdateVariants.mock.calls.at(-1)!;
    expect(call[6]).toBe('qc-dead');
    expect(call[7]).toBe('Ghost');
  });

  it('handleSelectVariant promotes a stamped variant with its name', async () => {
    const reply: ChatMessage = {
      id: 'reply',
      role: 'assistant',
      content: 'live text',
      timestamp: 20,
      characterId: 'qc-alive',
      variants: [
        {
          id: 'v1',
          content: 'older text',
          timestamp: 10,
          characterId: 'qc-dead',
          speakerName: 'Ghost',
        },
      ],
    };
    await mount(makeSession('S2', reply));

    await ReactTestRenderer.act(async () => {
      await latest.handleSelectVariant('reply', 0);
    });
    const msg = replyOf();
    expect(msg.content).toBe('older text');
    expect(msg.speakerName).toBe('Ghost');
    expect(msg.characterId).toBe('qc-dead');
    expect(msg.variants![0].speakerName).toBeUndefined();
    expect(mockUpdateVariants.mock.calls.at(-1)![7]).toBe('Ghost');
  });

  it('deleting the live entry promotes the neighbour with its own speaker', async () => {
    await mount(makeSession('S3', replyWithOneVariant()));

    await ReactTestRenderer.act(async () => {
      await latest.handleStudioDeleteEntry('reply', 'live');
    });
    const msg = replyOf();
    expect(msg.content).toBe('older text');
    expect(msg.characterId).toBe('qc-alive');
    expect(msg.speakerName).toBeUndefined();
    expect(msg.variants).toEqual([]);
  });

  it('a fork copies the source entry speaker fields', async () => {
    const reply: ChatMessage = {
      id: 'reply',
      role: 'assistant',
      content: 'live text',
      timestamp: 20,
      characterId: 'qc-alive',
      thinkingMs: 500,
      variants: [
        {
          id: 'v1',
          content: 'older text',
          timestamp: 10,
          characterId: 'qc-dead',
          speakerName: 'Ghost',
        },
      ],
    };
    await mount(makeSession('S4', reply));

    await ReactTestRenderer.act(async () => {
      await latest.handleStudioFork('reply', 'v1');
    });
    let msg = replyOf();
    expect(msg.content).toBe('older text');
    expect(msg.characterId).toBe('qc-dead');
    expect(msg.speakerName).toBe('Ghost');
    expect(msg.thinkingMs).toBeUndefined();
    expect(msg.variants).toHaveLength(2);

    // Forking the live (stamped) entry keeps the stamp on the copy.
    await ReactTestRenderer.act(async () => {
      await latest.handleStudioFork('reply', 'live');
    });
    msg = replyOf();
    expect(msg.content).toBe('older text');
    expect(msg.speakerName).toBe('Ghost');
    expect(msg.variants).toHaveLength(3);
  });
});

describe('regenerate that produced no reply', () => {
  it('cancelled before any text: index is restored and switching works', async () => {
    const original = makeSession('R1', replyWithOneVariant());
    await mount(original);
    engineStartsRuns();

    await ReactTestRenderer.act(async () => {
      await latest.handleRegenerate();
    });
    expect(replyOf().variants).toHaveLength(2);
    expect(latest.variantIndexMap.reply).toBe(2);
    // Nothing reaches the DB before the engine has a reply.
    expect(mockUpdateVariants).not.toHaveBeenCalled();

    // Cancel with no output: the engine writes nothing, bumps the revision,
    // and the reload brings back the original message.
    await ReactTestRenderer.act(async () => {
      useGenerationStore.setState({ runs: {}, revisions: { R1: 1 } });
      await settle();
    });
    expect(replyOf()).toEqual(original.messages[1]);
    expect(latest.variantIndexMap.reply).toBeUndefined();

    await ReactTestRenderer.act(async () => {
      await latest.handleSwitchVariant('reply', -1);
    });
    const msg = replyOf();
    expect(msg.content).toBe('older text');
    expect(msg.variants).toHaveLength(1);
    expect(latest.variantIndexMap.reply).toBe(0);
  });

  it('cancelled before any text: a previously chosen deck position comes back', async () => {
    const original = makeSession('R2', replyWithOneVariant());
    await mount(original);
    engineStartsRuns();
    // Pretend the user had already moved the live reply to the front.
    await ReactTestRenderer.act(async () => {
      await latest.handleSwitchVariant('reply', -1);
    });
    const afterSwitch = {
      ...original,
      messages: latest.session!.messages,
    };
    mockGetSessionById.mockImplementation(async () => afterSwitch);
    expect(latest.variantIndexMap.reply).toBe(0);

    await ReactTestRenderer.act(async () => {
      await latest.handleRegenerate();
    });
    expect(latest.variantIndexMap.reply).toBe(2);

    await ReactTestRenderer.act(async () => {
      useGenerationStore.setState({ runs: {}, revisions: { R2: 1 } });
      await settle();
    });
    expect(latest.variantIndexMap.reply).toBe(0);
    expect(replyOf()).toEqual(afterSwitch.messages[1]);
  });

  it('a regenerate that did produce a reply keeps the new deck position', async () => {
    const original = makeSession('R3', replyWithOneVariant());
    await mount(original);
    engineStartsRuns();

    await ReactTestRenderer.act(async () => {
      await latest.handleRegenerate();
    });
    const req = mockStartGeneration.mock.calls[0][0];
    const regenerated = {
      ...original,
      messages: [
        original.messages[0],
        {
          id: 'reply',
          role: 'assistant' as const,
          content: 'new text',
          timestamp: 30,
          variants: req.existingVariants,
        },
      ],
    };
    mockGetSessionById.mockImplementation(async () => regenerated);
    await ReactTestRenderer.act(async () => {
      useGenerationStore.setState({ runs: {}, revisions: { R3: 1 } });
      await settle();
    });
    expect(replyOf().content).toBe('new text');
    expect(latest.variantIndexMap.reply).toBe(2);
  });

  it('errored: message and index are put back and nothing is duplicated on switch', async () => {
    const original = makeSession('R4', replyWithOneVariant());
    await mount(original);
    engineStartsRuns();

    await ReactTestRenderer.act(async () => {
      await latest.handleRegenerate();
    });
    expect(replyOf().variants).toHaveLength(2);

    await engineFails('R4');
    expect(latest.error).toBe('Network error');
    expect(replyOf()).toEqual(original.messages[1]);
    expect(latest.variantIndexMap.reply).toBeUndefined();

    await ReactTestRenderer.act(async () => {
      await latest.handleSwitchVariant('reply', -1);
    });
    const call = mockUpdateVariants.mock.calls.at(-1)!;
    expect(call[1]).toBe('older text');
    expect(call[3]).toHaveLength(1);
    expect(call[3][0].content).toBe('live text');
  });

  it('ignores a stale index that no longer fits the message', async () => {
    const original = makeSession('R5', replyWithOneVariant());
    await mount(original);
    engineStartsRuns();
    await ReactTestRenderer.act(async () => {
      await latest.handleRegenerate();
    });
    // Remount-like reload without the pending bookkeeping finishing first:
    // the index map must still only expose values valid for the message.
    await ReactTestRenderer.act(async () => {
      useGenerationStore.setState(state => ({
        revisions: { R5: 1 },
        runs: state.runs,
      }));
      await settle();
    });
    expect(replyOf().variants).toHaveLength(1);
    expect(latest.variantIndexMap.reply).toBeUndefined();
    await ReactTestRenderer.act(async () => {
      await expect(
        latest.handleSwitchVariant('reply', -1),
      ).resolves.toBeUndefined();
    });
  });
});

describe('retry after a failure', () => {
  it('retries a failed regenerate as a regenerate of the same reply', async () => {
    const original = makeSession('T1', replyWithOneVariant());
    await mount(original);
    engineStartsRuns();

    await ReactTestRenderer.act(async () => {
      await latest.handleRegenerate();
    });
    await engineFails('T1');

    await ReactTestRenderer.act(async () => {
      await latest.handleRetryError();
    });
    expect(mockStartGeneration).toHaveBeenCalledTimes(2);
    const req = mockStartGeneration.mock.calls[1][0];
    expect(req.replaceMessageId).toBe('reply');
    expect(req.messages.map((m: ChatMessage) => m.id)).toEqual(['T1-user']);
    expect(req.userText).toBe('hello');
    expect(req.continueMode).toBeFalsy();
    expect(req.existingVariants).toHaveLength(2);
    expect(req.existingVariants[1].content).toBe('live text');
    expect(req.existingVariants[1].speakerName).toBe('Ghost');
    expect(replyOf().variants).toHaveLength(2);
  });

  it('retries a failed continue as a continue', async () => {
    const original = makeSession('T2', replyWithOneVariant());
    await mount(original);
    engineStartsRuns();

    await ReactTestRenderer.act(async () => {
      await latest.handleContinue();
    });
    await engineFails('T2');

    await ReactTestRenderer.act(async () => {
      await latest.handleRetryError();
    });
    expect(mockStartGeneration).toHaveBeenCalledTimes(2);
    const first = mockStartGeneration.mock.calls[0][0];
    const req = mockStartGeneration.mock.calls[1][0];
    expect(req.continueMode).toBe(true);
    expect(req.userText).toBe('');
    expect(req.replaceMessageId).toBeUndefined();
    expect(req.setLastReplyCharacter).toBe(true);
    expect(req.messages).toEqual(first.messages);
  });

  it('retries a failed send with the first attempt options', async () => {
    const original = makeSession('T3', null);
    await mount(original);
    engineStartsRuns();

    await ReactTestRenderer.act(async () => {
      await latest.handleSend('again');
    });
    await engineFails('T3');

    await ReactTestRenderer.act(async () => {
      await latest.handleRetryError();
    });
    const first = mockStartGeneration.mock.calls[0][0];
    const req = mockStartGeneration.mock.calls[1][0];
    expect(req.userText).toBe('again');
    expect(req.summarize).toBe(true);
    expect(req.setLastReplyCharacter).toBe(true);
    expect(req.messages).toEqual(first.messages);
  });

  it('without a record, an assistant reply last is retried as a regenerate', async () => {
    const original = makeSession('T4', replyWithOneVariant());
    await mount(original);
    engineStartsRuns();
    useGenerationStore.setState({ errors: { T4: 'Old failure' } });

    await ReactTestRenderer.act(async () => {
      await latest.handleRetryError();
    });
    const req = mockStartGeneration.mock.calls[0][0];
    expect(req.replaceMessageId).toBe('reply');
    expect(req.messages.map((m: ChatMessage) => m.id)).toEqual(['T4-user']);
  });

  it('without a record, a user turn last is resent with send options', async () => {
    const original = makeSession('T5', null);
    await mount(original);
    engineStartsRuns();

    await ReactTestRenderer.act(async () => {
      await latest.handleRetryError();
    });
    const req = mockStartGeneration.mock.calls[0][0];
    expect(req.userText).toBe('hello');
    expect(req.replaceMessageId).toBeUndefined();
    expect(req.summarize).toBe(true);
    expect(req.setLastReplyCharacter).toBe(true);
    expect(req.messages.map((m: ChatMessage) => m.id)).toEqual(['T5-user']);
  });
});

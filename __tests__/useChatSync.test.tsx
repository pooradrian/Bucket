jest.mock('../src/Database', () => ({
  getSessionById: jest.fn(),
  createSession: jest.fn(),
  addMessage: jest.fn(),
  deleteMessage: jest.fn(),
  updateMessage: jest.fn(),
  updateMessageWithVariants: jest.fn(),
  updateSessionTimestamp: jest.fn(),
  generateId: jest.fn().mockReturnValue('generated-id'),
  getLorebookEntriesFromDB: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/GenerationEngine', () => {
  const { create } = require('zustand');
  const store = create(() => ({ runs: {}, errors: {}, revisions: {} }));
  return {
    useGenerationStore: store,
    startGeneration: jest.fn(),
    stopGeneration: jest.fn(),
  };
});

jest.mock('../src/EventLogger', () => ({
  logEvent: jest.fn(),
}));

jest.mock('../src/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ lorebooks: [], characters: [] }),
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: { setString: jest.fn() },
}));

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { getSessionById } from '../src/Database';
import { useGenerationStore } from '../src/GenerationEngine';
import { useChat } from '../src/useChat';

const mockGetSessionById = getSessionById as jest.Mock;

const settle = () => new Promise(resolve => setImmediate(resolve));

const sessionA = {
  id: 'A',
  characterId: 'char-1',
  messages: [],
  createdAt: 0,
  updatedAt: 0,
};

const sessionB = {
  id: 'B',
  characterId: 'char-1',
  messages: [],
  createdAt: 0,
  updatedAt: 0,
};

const character = {
  id: 'char-1',
  name: 'Alice',
} as unknown as Parameters<typeof useChat>[0]['character'];

const onSessionCreated = jest.fn();

let latest: ReturnType<typeof useChat>;

function Probe({ id }: { id: string }) {
  latest = useChat({
    character,
    activeSessionId: id,
    onSessionCreated,
    quickCharacters: [],
  });
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  useGenerationStore.setState({ runs: {}, errors: {}, revisions: {} });
});

it('does not keep sending blocked when a revision reload is cancelled by a session switch', async () => {
  mockGetSessionById.mockImplementation(async (id: string) =>
    id === 'B' ? sessionB : sessionA,
  );

  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<Probe id="A" />);
    await settle();
  });

  expect(latest.session?.id).toBe('A');
  expect(latest.sending).toBe(false);

  let resolveA!: (value: typeof sessionA | null) => void;
  const pendingA = new Promise<typeof sessionA | null>(resolve => {
    resolveA = resolve;
  });
  mockGetSessionById.mockImplementation((id: string) =>
    id === 'A' ? pendingA : Promise.resolve(sessionB),
  );

  await ReactTestRenderer.act(async () => {
    useGenerationStore.setState({ revisions: { A: 1 } });
  });
  expect(latest.sending).toBe(true);

  await ReactTestRenderer.act(async () => {
    tree.update(<Probe id="B" />);
    await settle();
  });
  expect(latest.session?.id).toBe('B');
  expect(latest.sending).toBe(false);

  await ReactTestRenderer.act(async () => {
    resolveA(sessionA);
    await settle();
  });

  expect(latest.session?.id).toBe('B');
  expect(latest.sending).toBe(false);
});

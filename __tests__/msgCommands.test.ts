jest.mock('react-native-nitro-sqlite', () => ({ open: jest.fn() }));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: {},
  saveDocuments: jest.fn(),
  isKnownType: jest.fn(),
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
  ACCESSIBLE: {},
}));
jest.mock('../src/Database', () => ({
  ...jest.requireActual('../src/Database'),
  getSessionForCharacter: jest.fn(),
  addMessage: jest.fn(async () => {}),
  createSession: jest.fn(async () => {}),
  updateSessionTimestamp: jest.fn(),
}));

import { runHeadless } from '../src/UsbDebugBridge';
import { useAppStore } from '../src/store';
import {
  useExternalSessions,
  useGenerationStore,
} from '../src/GenerationEngine';
import {
  addMessage,
  createSession,
  getSessionForCharacter,
} from '../src/Database';
import type { Character } from '../src/CharacterEditor';

const lyra: Character = {
  id: 'c1',
  name: 'Lyra',
  description: '',
  initialMessage: 'Evening.',
  personality: '',
  scenario: '',
  lorebookIds: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  useAppStore.setState({ characters: [lyra] });
  useExternalSessions.setState({ byCharacter: {} });
  useGenerationStore.setState({ revisions: {} });
});

describe('msg.add', () => {
  it('starts a chat with the first message when none is saved', async () => {
    (getSessionForCharacter as jest.Mock).mockResolvedValue(null);
    const r = await runHeadless('msg.add Lyra user "Long day."');
    expect(r.ok).toBe(true);
    const session = (createSession as jest.Mock).mock.calls[0][0];
    expect(session.characterId).toBe('c1');
    expect(
      session.messages.map((m: { role: string; content: string }) => [
        m.role,
        m.content,
      ]),
    ).toEqual([
      ['assistant', 'Evening.'],
      ['user', 'Long day.'],
    ]);
    expect(useExternalSessions.getState().byCharacter).toEqual({
      c1: session.id,
    });
  });

  it('appends to the latest chat and tells an open chat to reload', async () => {
    (getSessionForCharacter as jest.Mock).mockResolvedValue({
      id: 's1',
      messages: [{}],
    });
    const r = await runHeadless('msg.add lyra a Tea is hot.');
    expect(r.text).toMatch(/Added assistant message to Lyra \(session s1, 2/);
    expect(addMessage).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        role: 'assistant',
        content: 'Tea is hot.',
        characterId: 'c1',
      }),
    );
    expect(useGenerationStore.getState().revisions.s1).toBe(1);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('rejects bad roles and unknown characters', async () => {
    expect((await runHeadless('msg.add Lyra narrator hi')).ok).toBe(false);
    expect((await runHeadless('msg.add Nobody user hi')).ok).toBe(false);
    expect(addMessage).not.toHaveBeenCalled();
  });
});

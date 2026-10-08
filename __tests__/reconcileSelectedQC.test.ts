jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: {},
  saveDocuments: jest.fn(),
  isKnownType: jest.fn(),
}));
jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {setString: jest.fn(), getString: jest.fn().mockResolvedValue('')},
}));
jest.mock('react-native-nitro-sqlite', () => ({open: jest.fn()}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: {},
}));
jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {createHybridObject: () => ({encrypt: jest.fn(), decrypt: jest.fn()})},
}));
jest.mock('react-native-get-random-values', () => ({}));

import {reconcileSelectedQC} from '../src/useChat';
import type {QuickCharacter} from '../src/useChat';

const qc = (over: Partial<QuickCharacter> = {}): QuickCharacter => ({
  id: 'qc-1',
  name: 'Viktor',
  description: 'a rival smuggler',
  personality: 'cold',
  starred: false,
  ...over,
});

test('keeps the selection untouched when nothing changed', () => {
  const selected = qc();
  expect(reconcileSelectedQC(selected, [selected, qc({id: 'qc-2'})])).toBe(selected);
});

test('returns null when the selected quick character was deleted', () => {
  expect(reconcileSelectedQC(qc(), [qc({id: 'qc-2'})])).toBeNull();
  expect(reconcileSelectedQC(qc(), [])).toBeNull();
});

test('swaps in the fresh details after an edit', () => {
  const selected = qc();
  const edited = qc({description: 'an old friend gone cold', personality: 'warm'});
  const reconciled = reconcileSelectedQC(selected, [edited]);
  expect(reconciled).toBe(edited);
});

test('handles each edited field', () => {
  const selected = qc();
  for (const over of [
    {name: 'Vik'},
    {description: 'rewritten'},
    {personality: 'sunny'},
    {icon: 'file:///icons/qc.png'},
  ]) {
    expect(reconcileSelectedQC(selected, [qc(over)])).not.toBe(selected);
  }
});

test('returns null for no selection regardless of the list', () => {
  expect(reconcileSelectedQC(null, [qc()])).toBeNull();
});

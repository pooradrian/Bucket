/**
 * @format
 */

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn().mockResolvedValue([]),
  saveDocuments: jest.fn().mockResolvedValue([]),
  isKnownType: jest.fn().mockReturnValue(true),
  types: {allFiles: 'public.all-files'},
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  ACCESSIBLE: {WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly'},
}));
jest.mock('react-native-nitro-sqlite', () => ({
  open: jest.fn().mockReturnValue({
    execute: jest.fn().mockReturnValue({results: []}),
  }),
}));
jest.mock('react-native-fs', () => {
  const fs = {
    DocumentDirectoryPath: '/tmp/docs',
    CachesDirectoryPath: '/tmp/cache',
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(''),
    exists: jest.fn().mockResolvedValue(false),
    unlink: jest.fn().mockResolvedValue(undefined),
  };
  return {__esModule: true, default: fs, ...fs};
});
jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {setString: jest.fn(), getString: jest.fn().mockResolvedValue('')},
}));
jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
}));
jest.mock('../src/CrashExport', () => ({
  installCrashExport: jest.fn(),
  checkPendingCrashExport: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/Database', () => ({
  initDB: jest.fn(),
  generateId: jest.fn().mockReturnValue('test-id'),
  getKV: jest.fn().mockReturnValue(null),
  setKV: jest.fn(),
  getAllCharactersFromDB: jest.fn().mockResolvedValue([]),
  getAllLorebooksFromDB: jest.fn().mockResolvedValue([]),
  getAllSessionsForCharacter: jest.fn().mockReturnValue([]),
  getSessionsForGroupChat: jest.fn().mockReturnValue([]),
  getSessionById: jest.fn().mockResolvedValue(null),
  createSession: jest.fn(),
  saveCharacterToDB: jest.fn(),
  saveLorebookToDB: jest.fn(),
  saveGroupChatToDB: jest.fn(),
  getAllGroupChatsFromDB: jest.fn().mockResolvedValue([]),
  deleteCharacterFromDB: jest.fn(),
  deleteGroupChatFromDB: jest.fn(),
  deleteLorebookFromDB: jest.fn(),
  deleteSession: jest.fn(),
  deleteMessage: jest.fn(),
  updateMessage: jest.fn(),
  updateSessionTimestamp: jest.fn(),
  setLastReplyCharacterId: jest.fn(),
  addMessage: jest.fn(),
}));
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const {View, Text, ScrollView, FlatList, Image} = require('react-native');
  const wrap = (Comp: any) =>
    React.forwardRef((props: any, ref: any) => React.createElement(Comp, {...props, ref}));
  const Animated = {
    View: wrap(View),
    Text: wrap(Text),
    ScrollView: wrap(ScrollView),
    FlatList: wrap(FlatList),
    Image: wrap(Image),
  };
  return {
    __esModule: true,
    default: Animated,
    Animated,
    View: Animated.View,
    Text: Animated.Text,
    useSharedValue: (init: unknown) => ({value: init}),
    useAnimatedStyle: () => ({}),
    useAnimatedProps: () => ({}),
    withTiming: (v: unknown) => v,
    withSpring: (v: unknown) => v,
    withDelay: (_: unknown, v: unknown) => v,
    withSequence: (v: unknown) => v,
    withRepeat: (v: unknown) => v,
    runOnJS: (fn: unknown) => fn,
    runOnUI: (fn: unknown) => fn,
    useAnimatedScrollView: (Comp: unknown) => Comp,
    useAnimatedFlatList: (Comp: unknown) => Comp,
  };
});
jest.mock('react-native-safe-area-context', () => {
  const {View} = require('react-native');
  return {
    SafeAreaProvider: View,
    SafeAreaView: View,
    useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
  };
});

import React from 'react';
import {Text} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import App from '../src/App';

test('renders the splash screen without crashing', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
    await new Promise(r => setTimeout(r, 0));
  });
  const text = tree!
    .root.findAllByType(Text)
    .map(n => String(n.props.children))
    .join('');
  expect(text).toContain('Poor Adrian');
});

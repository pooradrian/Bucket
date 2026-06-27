import {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, FlatList, Text, View} from 'react-native';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import {createNativeStackNavigator, NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Character} from './CharacterEditor';
import {GroupChat, AppSettings, useAppStore} from './store';
import {useTheme} from './ThemeContext';
import {
  getAllSessionsForCharacter,
  getSessionsForGroupChat,
  deleteSession,
  SessionSummary,
  getKV,
  setKV,
} from './Database';
import ChatHandler from './ChatHandler';
import SettingsHandler from './SettingsHandler';
import CharacterEditor from './CharacterEditor';
import Debugger from './Debugger';
import CharacterCard from './components/CharacterCard';
import GroupCard from './components/GroupCard';
import GroupEditor from './components/GroupEditor';
import HistoryModal from './components/HistoryModal';
import TabBar from './components/TabBar';
import WelcomeGuide from './WelcomeGuide';

type RootStackParamList = {
  Home: undefined;
  Settings: undefined;
  Editor: {characterId?: string};
  Debugger: undefined;
};

export type Navigation = NativeStackNavigationProp<RootStackParamList>;

type ContentTab = 'menu' | 'chat';

const WELCOME_ID = '__welcome__';
const WELCOME_CHARACTER: Character = {
  id: WELCOME_ID,
  name: 'Welcome to Bucket!',
  description: 'Click on me for a quick guide!',
  initialMessage: '',
  writingStyle: '',
  personality: '',
  scenario: '',
  lorebookIds: [],
};

function HomeScreen() {
  const st = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Navigation>();
  const characters = useAppStore(s => s.characters);
  const charactersLoading = useAppStore(s => s.charactersLoading);
  const groupChats = useAppStore(s => s.groupChats);
  const groupChatsLoading = useAppStore(s => s.groupChatsLoading);
  const showCharacterIcons = useAppStore(s => s.appSettings.showCharacterIcons);
  const deleteCharacter = useAppStore(s => s.deleteCharacter);
  const deleteGroupChat = useAppStore(s => s.deleteGroupChat);
  const saveGroupChat = useAppStore(s => s.saveGroupChat);
  const loadGroupChats = useAppStore(s => s.loadGroupChats);

  const [activeTab, setActiveTab] = useState<ContentTab>('menu');
  const [activeChatCharacter, setActiveChatCharacter] = useState<Character | null>(null);
  const [activeGroupChat, setActiveGroupChat] = useState<GroupChat | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historySessions, setHistorySessions] = useState<SessionSummary[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteConfirmGroupId, setDeleteConfirmGroupId] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<GroupChat | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(true);

  useEffect(() => {
    const v = getKV('welcome_dismissed');
    setWelcomeDismissed(v === 'true');
  }, []);

  const hasChat = !!(activeChatCharacter || activeGroupChat || showWelcome);
  const isChat = activeTab === 'chat' && hasChat;

  const loadHistorySessions = useCallback(() => {
    if (activeGroupChat) {
      setHistorySessions(getSessionsForGroupChat(activeGroupChat.id));
    } else if (activeChatCharacter) {
      setHistorySessions(getAllSessionsForCharacter(activeChatCharacter.id));
    }
  }, [activeChatCharacter, activeGroupChat]);

  const closeChat = useCallback(() => {
    setActiveChatCharacter(null);
    setActiveGroupChat(null);
    setActiveSessionId(null);
    setShowWelcome(false);
    setActiveTab('menu');
  }, []);

  const handleNewChat = useCallback(() => {
    setShowHistory(false);
    setActiveSessionId(null);
  }, []);

  const handleSwitchSession = useCallback((sessionId: string) => {
    setShowHistory(false);
    setActiveSessionId(sessionId);
  }, []);

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      deleteSession(sessionId);
      if (sessionId === activeSessionId) {
        const remaining = historySessions.filter(s => s.id !== sessionId);
        if (remaining.length > 0) {
          setActiveSessionId(remaining[0].id);
        } else {
          setActiveSessionId(null);
        }
      }
      loadHistorySessions();
    },
    [activeSessionId, historySessions, loadHistorySessions],
  );

  const handleSessionCreated = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      loadHistorySessions();
    },
    [loadHistorySessions],
  );

  const openChat = useCallback(
    (char: Character | null, group: GroupChat | null) => {
      if (char?.id === WELCOME_ID) {
        setShowWelcome(true);
        setActiveChatCharacter(null);
        setActiveGroupChat(null);
        setActiveSessionId(null);
        setActiveTab('chat');
        return;
      }
      setActiveChatCharacter(char);
      setActiveGroupChat(group);
      const sessions = char
        ? getAllSessionsForCharacter(char.id)
        : group
        ? getSessionsForGroupChat(group.id)
        : [];
      setActiveSessionId(sessions.length > 0 ? sessions[0].id : null);
      setActiveTab('chat');
    },
    [],
  );

  const handleCharacterOpenChat = useCallback(
    (char: Character) => openChat(char, null),
    [openChat],
  );

  const handleGroupOpenChat = useCallback(
    (group: GroupChat) => openChat(null, group),
    [openChat],
  );

  const handleCharacterEdit = useCallback(
    (char: Character) => navigation.navigate('Editor', {characterId: char.id}),
    [navigation],
  );

  const handleGroupEdit = useCallback(
    (group: GroupChat) => setEditingGroup(group),
    [],
  );

  const handleGroupEditSave = useCallback(
    (group: GroupChat) => {
      saveGroupChat(group);
      setEditingGroup(null);
      loadGroupChats();
    },
    [saveGroupChat, loadGroupChats],
  );

  const loading = charactersLoading || groupChatsLoading;

  const handleWelcomeDelete = useCallback(() => {
    setKV('welcome_dismissed', 'true');
    setWelcomeDismissed(true);
    setShowWelcome(false);
    setActiveTab('menu');
  }, []);

  const showWelcomeCard = !welcomeDismissed && characters.length === 0;

  const menuData = [
    ...(showWelcomeCard ? [{type: 'character' as const, data: WELCOME_CHARACTER}] : []),
    ...characters.map(c => ({type: 'character' as const, data: c})),
    ...groupChats.map(g => ({type: 'group' as const, data: g})),
  ];

  return (
    <View style={st.screen}>
      <View style={[st.safeArea, {paddingTop: insets.top}]}>
        {isChat ? (
          <>
            <View style={st.chatVisible}>
              {showWelcome ? (
                <WelcomeGuide />
              ) : (
                <ChatHandler
                  character={activeChatCharacter}
                  groupChat={activeGroupChat}
                  activeSessionId={activeSessionId}
                  onHistoryPress={() => {
                    loadHistorySessions();
                    setShowHistory(true);
                  }}
                  onSessionCreated={handleSessionCreated}
                  bottomInset={insets.bottom}
                />
              )}
            </View>
            {activeTab !== 'chat' && (
              <View style={st.flatListContainer}>
                <FlatList
                  data={menuData}
                  keyExtractor={item => item.data.id}
                  renderItem={({item}) =>
                    item.type === 'character' ? (
                      <CharacterCard
                        item={item.data as Character}
                        showCharacterIcons={showCharacterIcons}
                        isConfirmingDelete={deleteConfirmId === item.data.id}
                        hideEdit={(item.data as Character).id === WELCOME_ID}
                        onOpenChat={handleCharacterOpenChat}
                        onEdit={handleCharacterEdit}
                        onTriggerDelete={setDeleteConfirmId}
                        onConfirmDelete={(id: string) => {
                          if (id === WELCOME_ID) {
                            handleWelcomeDelete();
                          } else {
                            deleteCharacter(id);
                          }
                          setDeleteConfirmId(null);
                        }}
                        onCancelDelete={() => setDeleteConfirmId(null)}
                      />
                    ) : (
                      <GroupCard
                        item={item.data as GroupChat}
                        isConfirmingDelete={deleteConfirmGroupId === item.data.id}
                        onOpenChat={handleGroupOpenChat}
                        onEdit={handleGroupEdit}
                        onTriggerDelete={setDeleteConfirmGroupId}
                        onConfirmDelete={(id: string) => {
                          deleteGroupChat(id);
                          setDeleteConfirmGroupId(null);
                        }}
                        onCancelDelete={() => setDeleteConfirmGroupId(null)}
                      />
                    )
                  }
                  contentContainerStyle={st.flatListContent}
                  style={st.flatListContainer}
                  ListEmptyComponent={
                    loading
                      ? <ActivityIndicator size="small" color={st.textMuted.color} style={{marginTop: 40}} />
                      : <Text style={st.emptyText}>No characters yet</Text>
                  }
                />
              </View>
            )}
          </>
        ) : (
          <View style={st.flatListContainer}>
            <FlatList
              data={menuData}
              keyExtractor={item => item.data.id}
              renderItem={({item}) =>
                item.type === 'character' ? (
                  <CharacterCard
                    item={item.data as Character}
                    showCharacterIcons={showCharacterIcons}
                    isConfirmingDelete={deleteConfirmId === item.data.id}
                    hideEdit={(item.data as Character).id === WELCOME_ID}
                    onOpenChat={handleCharacterOpenChat}
                    onEdit={handleCharacterEdit}
                    onTriggerDelete={setDeleteConfirmId}
                    onConfirmDelete={(id: string) => {
                      if (id === WELCOME_ID) {
                        handleWelcomeDelete();
                      } else {
                        deleteCharacter(id);
                      }
                      setDeleteConfirmId(null);
                    }}
                    onCancelDelete={() => setDeleteConfirmId(null)}
                  />
                ) : (
                  <GroupCard
                    item={item.data as GroupChat}
                    isConfirmingDelete={deleteConfirmGroupId === item.data.id}
                    onOpenChat={handleGroupOpenChat}
                    onEdit={handleGroupEdit}
                    onTriggerDelete={setDeleteConfirmGroupId}
                    onConfirmDelete={(id: string) => {
                      deleteGroupChat(id);
                      setDeleteConfirmGroupId(null);
                    }}
                    onCancelDelete={() => setDeleteConfirmGroupId(null)}
                  />
                )
              }
              contentContainerStyle={st.flatListContent}
              style={st.flatListContainer}
              ListEmptyComponent={
                loading
                  ? <ActivityIndicator size="small" color={st.textMuted.color} style={{marginTop: 40}} />
                  : <Text style={st.emptyText}>No characters yet</Text>
              }
            />
          </View>
        )}

        <View style={[st.bottomBar, {paddingBottom: insets.bottom}]}>
          <TabBar
            hasChat={hasChat}
            isChat={isChat}
            onSettingsPress={() => navigation.navigate('Settings')}
            onNewPress={() => navigation.navigate('Editor', {})}
            onMenuPress={() => setActiveTab('menu')}
            onChatPress={() => setActiveTab('chat')}
            onCloseChat={closeChat}
          />
        </View>

        <HistoryModal
          visible={showHistory}
          sessions={historySessions}
          activeSessionId={activeSessionId}
          onNewChat={handleNewChat}
          onSwitchSession={handleSwitchSession}
          onDeleteSession={handleDeleteSession}
          onClose={() => setShowHistory(false)}
        />

        <GroupEditor
          visible={editingGroup !== null}
          group={editingGroup}
          onClose={() => setEditingGroup(null)}
          onSave={handleGroupEditSave}
        />
      </View>
    </View>
  );
}

function SettingsScreen() {
  const st = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Navigation>();
  const setAppSettings = useAppStore(s => s.setAppSettings);

  return (
    <View style={st.screen}>
      <View style={[st.safeArea, {paddingTop: insets.top, flex: 1}]}>
        <SettingsHandler
          onApply={updated => setAppSettings(updated as unknown as AppSettings)}
          onOpenDebugger={() => navigation.navigate('Debugger')}
          bottomInset={insets.bottom}
        />
      </View>
    </View>
  );
}

function EditorScreen() {
  const st = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<RouteProp<RootStackParamList, 'Editor'>>();
  const characters = useAppStore(s => s.characters);
  const saveCharacter = useAppStore(s => s.saveCharacter);
  const loadGroupChats = useAppStore(s => s.loadGroupChats);

  const editingCharacter = route.params.characterId
    ? characters.find(c => c.id === route.params.characterId) ?? null
    : null;

  return (
    <View style={st.screen}>
      <View style={[st.safeArea, {paddingTop: insets.top, flex: 1}]}>
        <CharacterEditor
          character={editingCharacter}
          onClose={() => navigation.goBack()}
          onSave={(char: Character) => {
            saveCharacter(char);
            navigation.goBack();
          }}
          onMakeGroup={() => {
            loadGroupChats();
            navigation.goBack();
          }}
        />
      </View>
    </View>
  );
}

function DebuggerScreen() {
  const st = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Navigation>();

  return (
    <View style={st.screen}>
      <View style={[st.safeArea, {paddingTop: insets.top, flex: 1}]}>
        <Debugger
          onClose={() => navigation.goBack()}
          bottomInset={insets.bottom}
        />
      </View>
    </View>
  );
}

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'none',
        contentStyle: {backgroundColor: '#000'},
      }}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{animation: 'slide_from_left'}}
      />
      <Stack.Screen
        name="Editor"
        component={EditorScreen}
        options={{animation: 'slide_from_right'}}
      />
      <Stack.Screen
        name="Debugger"
        component={DebuggerScreen}
        options={{animation: 'slide_from_bottom'}}
      />
    </Stack.Navigator>
  );
}

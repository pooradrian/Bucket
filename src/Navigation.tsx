import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  RouteProp,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Character } from './CharacterEditor';
import { Folder, GroupChat, AppSettings, useAppStore } from './store';
import { useTheme } from './ThemeContext';
import {
  getAllSessionsForCharacter,
  getSessionsForGroupChat,
  deleteSession,
  renameSession,
  migrateSessionToGroup,
  SessionSummary,
  getKV,
  setKV,
  getQuickCharactersForSession,
  getQuickCharactersForCharacter,
  saveQuickCharacter,
  deleteQuickCharacter,
  preserveSpeakerNames,
  generateId,
  createSession,
} from './Database';
import { QuickCharacter } from './useChat';
import { logEvent } from './EventLogger';
import ChatHandler from './ChatHandler';
import SettingsHandler from './SettingsHandler';
import CharacterEditor from './CharacterEditor';
import Debugger from './Debugger';
import CharacterCard from './components/CharacterCard';
import GroupCard from './components/GroupCard';
import GroupEditor from './components/GroupEditor';
import FolderCard from './components/FolderCard';
import FolderPicker from './components/FolderPicker';
import HistoryModal from './components/HistoryModal';
import TabBar from './components/TabBar';
import GenerationBanner from './components/GenerationBanner';
import {
  clearGenerationError,
  stopGeneration,
  useGenerationStore,
} from './GenerationEngine';
import WelcomeGuide from './WelcomeGuide';

type RootStackParamList = {
  Home: undefined;
  Settings: undefined;
  Editor: { characterId?: string };
  Debugger: undefined;
};

export type Navigation = NativeStackNavigationProp<RootStackParamList>;

type ContentTab = 'menu' | 'chat';

type MenuItem =
  | { type: 'folder'; data: Folder; characterCount: number; expanded: boolean }
  | { type: 'character'; data: Character; nested?: boolean }
  | { type: 'group'; data: GroupChat };

function menuItemKey(item: MenuItem): string {
  return item.type === 'folder' ? `folder:${item.data.id}` : item.data.id;
}

const WELCOME_ID = '__welcome__';
const WELCOME_CHARACTER: Character = {
  id: WELCOME_ID,
  name: 'Welcome to Bucket!',
  description: 'Click on me for a quick guide!',
  initialMessage: '',
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
  const folders = useAppStore(s => s.folders);
  const saveFolder = useAppStore(s => s.saveFolder);
  const deleteFolder = useAppStore(s => s.deleteFolder);
  const moveCharacterToFolder = useAppStore(s => s.moveCharacterToFolder);

  const [activeTab, setActiveTab] = useState<ContentTab>('menu');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeChatCharacter, setActiveChatCharacter] =
    useState<Character | null>(null);
  const [activeGroupChat, setActiveGroupChat] = useState<GroupChat | null>(
    null,
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historySessions, setHistorySessions] = useState<SessionSummary[]>([]);
  const [quickCharacters, setQuickCharacters] = useState<QuickCharacter[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteConfirmGroupId, setDeleteConfirmGroupId] = useState<
    string | null
  >(null);
  const [deleteConfirmFolderId, setDeleteConfirmFolderId] = useState<
    string | null
  >(null);
  const [expandedFolders, setExpandedFolders] = useState<
    Record<string, boolean>
  >({});
  const [renamingFolder, setRenamingFolder] = useState<{
    id: string;
    draft: string;
  } | null>(null);
  const [movingCharacter, setMovingCharacter] = useState<Character | null>(
    null,
  );
  const [editingGroup, setEditingGroup] = useState<GroupChat | null>(null);
  const [showConvertGroup, setShowConvertGroup] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(true);
  const lastBackRef = useRef(0);
  const qcReloadRef = useRef(0);
  const dataVersion = useAppStore(s => s.dataVersion);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (showHistory) {
          setShowHistory(false);
          return true;
        }
        if (editingGroup !== null) {
          setEditingGroup(null);
          return true;
        }
        if (showConvertGroup) {
          setShowConvertGroup(false);
          return true;
        }
        if (renamingFolder !== null) {
          setRenamingFolder(null);
          return true;
        }
        if (Platform.OS !== 'android') return false;
        const now = Date.now();
        if (now - lastBackRef.current < 2000) {
          return false;
        }
        lastBackRef.current = now;
        ToastAndroid.show('Press back again to exit', ToastAndroid.SHORT);
        return true;
      });
      return () => sub.remove();
    }, [showHistory, editingGroup, showConvertGroup, renamingFolder]),
  );

  useEffect(() => {
    const v = getKV('welcome_dismissed');
    setWelcomeDismissed(v === 'true');
  }, []);

  const reloadQCs = useCallback(
    async (sessionId: string | null) => {
      const request = ++qcReloadRef.current;
      const dbQCs = activeChatCharacter
        ? await getQuickCharactersForCharacter(
            activeChatCharacter.id,
            sessionId ?? '',
          )
        : sessionId
          ? await getQuickCharactersForSession(sessionId)
          : [];
      if (request !== qcReloadRef.current) {
        return;
      }
      setQuickCharacters(
        dbQCs.map(dbQc => ({
          id: dbQc.id,
          session_id: dbQc.session_id,
          name: dbQc.name,
          description: dbQc.description,
          personality: dbQc.personality,
          starred: dbQc.starred === 1,
          icon: dbQc.icon || undefined,
        })),
      );
    },
    [activeChatCharacter],
  );

  useEffect(() => {
    reloadQCs(activeSessionId);
  }, [activeSessionId, reloadQCs, dataVersion]);

  const hasChat = !!(activeChatCharacter || activeGroupChat || showWelcome);
  const isChat = activeTab === 'chat' && hasChat;

  const loadHistorySessions = useCallback(async () => {
    if (activeGroupChat) {
      setHistorySessions(await getSessionsForGroupChat(activeGroupChat.id));
    } else if (activeChatCharacter) {
      setHistorySessions(
        await getAllSessionsForCharacter(activeChatCharacter.id),
      );
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
    logEvent('session_created', { msgCount: 0 });
  }, []);

  const handleSwitchSession = useCallback(
    (sessionId: string) => {
      setShowHistory(false);
      setActiveSessionId(sessionId);
      const session = historySessions.find(s => s.id === sessionId);
      logEvent('session_switched', { msgCount: session?.messageCount ?? 0 });
    },
    [historySessions],
  );

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      const session = historySessions.find(s => s.id === sessionId);
      stopGeneration(sessionId);
      clearGenerationError(sessionId);
      deleteSession(sessionId);
      logEvent('session_deleted', { msgCount: session?.messageCount ?? 0 });
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
    async (char: Character | null, group: GroupChat | null) => {
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
        ? await getAllSessionsForCharacter(char.id)
        : group
          ? await getSessionsForGroupChat(group.id)
          : [];
      setActiveSessionId(sessions.length > 0 ? sessions[0].id : null);
      setActiveTab('chat');
    },
    [],
  );

  const handleOpenGeneration = useCallback(
    (sessionId: string) => {
      const run = useGenerationStore.getState().runs[sessionId];
      if (!run) {
        return;
      }
      const char = run.characterId
        ? (characters.find(c => c.id === run.characterId) ?? null)
        : null;
      const group = run.groupChatId
        ? (groupChats.find(g => g.id === run.groupChatId) ?? null)
        : null;
      if (!char && !group) {
        return;
      }
      setActiveChatCharacter(char);
      setActiveGroupChat(group);
      setActiveSessionId(sessionId);
      setActiveTab('chat');
    },
    [characters, groupChats],
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
    (char: Character) =>
      navigation.navigate('Editor', { characterId: char.id }),
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
      if (activeGroupChat?.id === group.id) {
        setActiveGroupChat(group);
      }
      loadGroupChats();
    },
    [activeGroupChat, saveGroupChat, loadGroupChats],
  );

  const handleRenameSession = useCallback((sessionId: string, name: string) => {
    renameSession(sessionId, name);
    setHistorySessions(prev =>
      prev.map(s => (s.id === sessionId ? { ...s, name: name.trim() } : s)),
    );
  }, []);

  const toggleFolder = useCallback((id: string) => {
    setExpandedFolders(prev => ({ ...prev, [id]: !(prev[id] ?? false) }));
  }, []);

  const handleFolderRenameSave = useCallback(() => {
    if (!renamingFolder || !renamingFolder.draft.trim()) return;
    saveFolder({ id: renamingFolder.id, name: renamingFolder.draft.trim() });
    setRenamingFolder(null);
  }, [renamingFolder, saveFolder]);

  const handleCharacterMove = useCallback((char: Character) => {
    setMovingCharacter(char);
  }, []);

  const handleMoveSelect = useCallback(
    (folderId: string) => {
      if (movingCharacter) {
        moveCharacterToFolder(movingCharacter.id, folderId);
      }
      setMovingCharacter(null);
    },
    [movingCharacter, moveCharacterToFolder],
  );

  const handleConvertSave = useCallback(
    (group: GroupChat) => {
      if (!activeSessionId) return;
      saveGroupChat(group);
      migrateSessionToGroup(activeSessionId, group.id);
      logEvent('chat_converted_to_group', {
        memberCount: group.characterIds.length,
      });
      setShowConvertGroup(false);
      setShowHistory(false);
      loadGroupChats();
      setActiveGroupChat(group);
      setActiveChatCharacter(null);
      setActiveTab('chat');
    },
    [activeSessionId, saveGroupChat, loadGroupChats],
  );

  const loading = charactersLoading || groupChatsLoading;

  const activeGroupMembers = useMemo(() => {
    if (!activeGroupChat) return [];
    return activeGroupChat.characterIds
      .map(id => characters.find(c => c.id === id))
      .filter(Boolean) as Character[];
  }, [activeGroupChat, characters]);

  const handleWelcomeDelete = useCallback(() => {
    setKV('welcome_dismissed', 'true');
    setWelcomeDismissed(true);
    setShowWelcome(false);
    setActiveTab('menu');
  }, []);

  const handleCreateQC = useCallback(
    async (qcData: {
      name: string;
      description: string;
      personality: string;
      icon?: string;
    }) => {
      let sessionId = activeSessionId;
      if (!sessionId && (activeChatCharacter || activeGroupChat)) {
        const newSession = {
          id: generateId(),
          characterId: activeGroupChat ? '' : activeChatCharacter!.id,
          groupChatId: activeGroupChat?.id,
          messages: activeChatCharacter?.initialMessage
            ? [
                {
                  id: generateId(),
                  role: 'assistant' as const,
                  content: activeChatCharacter.initialMessage,
                  timestamp: Date.now(),
                },
              ]
            : [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await createSession(newSession);
        sessionId = newSession.id;
        setActiveSessionId(newSession.id);
        loadHistorySessions();
      }
      if (!sessionId) return;
      await saveQuickCharacter({
        id: generateId(),
        session_id: sessionId,
        character_id: '',
        name: qcData.name,
        description: qcData.description,
        personality: qcData.personality,
        starred: 0,
        icon: qcData.icon || '',
      });
      logEvent('qc_created', {
        nameLen: qcData.name.length,
        descLen: qcData.description?.length || 0,
        hasPersonality: !!qcData.personality,
      });
      reloadQCs(sessionId);
    },
    [
      activeSessionId,
      activeChatCharacter,
      activeGroupChat,
      reloadQCs,
      loadHistorySessions,
    ],
  );

  const handleUpdateQC = useCallback(
    async (
      qcId: string,
      qcData: {
        name: string;
        description: string;
        personality: string;
        icon?: string;
      },
    ) => {
      const qc = quickCharacters.find(q => q.id === qcId);
      if (!qc) return;
      await saveQuickCharacter({
        id: qc.id,
        session_id: qc.session_id || activeSessionId || '',
        character_id: qc.starred ? activeChatCharacter?.id || '' : '',
        name: qcData.name,
        description: qcData.description,
        personality: qcData.personality,
        starred: qc.starred ? 1 : 0,
        icon: qcData.icon || '',
      });
      logEvent('qc_updated', { nameLen: qcData.name.length });
      reloadQCs(activeSessionId);
    },
    [quickCharacters, activeSessionId, activeChatCharacter, reloadQCs],
  );

  const handleToggleQCStar = useCallback(
    async (qcId: string) => {
      const qc = quickCharacters.find(q => q.id === qcId);
      if (!qc) return;
      if (!qc.starred) {
        await saveQuickCharacter({
          id: qc.id,
          session_id: qc.session_id || '',
          character_id: activeChatCharacter?.id || '',
          name: qc.name,
          description: qc.description,
          personality: qc.personality,
          starred: 1,
          icon: qc.icon || '',
        });
      } else if (activeSessionId) {
        await saveQuickCharacter({
          id: qc.id,
          session_id: activeSessionId,
          character_id: '',
          name: qc.name,
          description: qc.description,
          personality: qc.personality,
          starred: 0,
          icon: qc.icon || '',
        });
      } else {
        deleteQuickCharacter(qc.id);
      }
      logEvent(qc.starred ? 'qc_unstarred' : 'qc_starred', {
        nameLen: qc.name.length,
      });
      reloadQCs(activeSessionId);
    },
    [quickCharacters, activeSessionId, activeChatCharacter, reloadQCs],
  );

  const handleDeleteQC = useCallback(
    async (qcId: string) => {
      const qc = quickCharacters.find(q => q.id === qcId);
      if (qc) {
        await deleteQuickCharacter(qcId);
        await preserveSpeakerNames(qc.id, qc.name);
        logEvent('qc_deleted', { nameLen: qc.name.length });
      } else {
        await deleteQuickCharacter(qcId);
      }
      reloadQCs(activeSessionId);
    },
    [activeSessionId, reloadQCs, quickCharacters],
  );

  const showWelcomeCard = !welcomeDismissed && characters.length === 0;

  const menuData = useMemo(() => {
    const items: MenuItem[] = [];
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      for (const char of characters) {
        if (
          char.name.toLowerCase().includes(query) ||
          char.description.toLowerCase().includes(query)
        ) {
          items.push({ type: 'character', data: char });
        }
      }
      for (const group of groupChats) {
        if (
          group.name.toLowerCase().includes(query) ||
          group.description.toLowerCase().includes(query)
        ) {
          items.push({ type: 'group', data: group });
        }
      }
      return items;
    }
    if (showWelcomeCard) {
      items.push({ type: 'character', data: WELCOME_CHARACTER });
    }
    const folderIds = new Set(folders.map(f => f.id));
    for (const folder of folders) {
      const members = characters.filter(c => c.folderId === folder.id);
      const expanded = expandedFolders[folder.id] ?? false;
      items.push({
        type: 'folder',
        data: folder,
        characterCount: members.length,
        expanded,
      });
      if (expanded) {
        for (const char of members) {
          items.push({ type: 'character', data: char, nested: true });
        }
      }
    }
    for (const char of characters) {
      if (!char.folderId || !folderIds.has(char.folderId)) {
        items.push({ type: 'character', data: char });
      }
    }
    for (const group of groupChats) {
      items.push({ type: 'group', data: group });
    }
    return items;
  }, [
    characters,
    groupChats,
    folders,
    showWelcomeCard,
    expandedFolders,
    searchQuery,
  ]);

  const renderMenuItem = ({ item }: { item: MenuItem }) => {
    if (item.type === 'folder') {
      return (
        <FolderCard
          item={item.data}
          characterCount={item.characterCount}
          expanded={item.expanded}
          isConfirmingDelete={deleteConfirmFolderId === item.data.id}
          onToggleExpand={toggleFolder}
          onRename={folder =>
            setRenamingFolder({ id: folder.id, draft: folder.name })
          }
          onTriggerDelete={setDeleteConfirmFolderId}
          onConfirmDelete={id => {
            deleteFolder(id);
            setDeleteConfirmFolderId(null);
          }}
          onCancelDelete={() => setDeleteConfirmFolderId(null)}
        />
      );
    }

    if (item.type === 'character') {
      return (
        <View style={item.nested ? st.folderNested : undefined}>
          <CharacterCard
            item={item.data}
            showCharacterIcons={showCharacterIcons}
            isConfirmingDelete={deleteConfirmId === item.data.id}
            hideEdit={item.data.id === WELCOME_ID}
            onMove={handleCharacterMove}
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
        </View>
      );
    }

    return (
      <GroupCard
        item={item.data}
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
    );
  };

  const menuList = (
    <View style={st.flatListContainer}>
      <View style={st.searchBar}>
        <TextInput
          style={st.searchInput}
          placeholder="Search characters and groups..."
          placeholderTextColor={st.textMuted.color}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Text style={st.searchClear}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={menuData}
        keyExtractor={menuItemKey}
        renderItem={renderMenuItem}
        contentContainerStyle={st.flatListContent}
        style={st.flatListContainer}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator
              size="small"
              color={st.textMuted.color}
              style={{ marginTop: 40 }}
            />
          ) : (
            <Text style={[st.emptyText, st.textMuted]}>
              {searchQuery.trim() ? 'No matches' : 'No characters yet'}
            </Text>
          )
        }
      />
    </View>
  );

  return (
    <View style={st.screen}>
      <View style={[st.safeArea, { paddingTop: insets.top }]}>
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
                  quickCharacters={quickCharacters}
                  onHistoryPress={() => {
                    loadHistorySessions();
                    setShowHistory(true);
                  }}
                  onSessionCreated={handleSessionCreated}
                  bottomInset={insets.bottom}
                />
              )}
            </View>
            {activeTab !== 'chat' && menuList}
          </>
        ) : (
          menuList
        )}

        <GenerationBanner
          excludeSessionId={isChat ? activeSessionId : null}
          onOpen={handleOpenGeneration}
        />

        <View style={[st.bottomBar, { paddingBottom: insets.bottom }]}>
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
          quickCharacters={quickCharacters}
          isGroupChat={!!activeGroupChat}
          groupMembers={activeGroupMembers}
          onNewChat={handleNewChat}
          onSwitchSession={handleSwitchSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
          onConvertToGroup={
            !activeGroupChat && activeChatCharacter
              ? () => setShowConvertGroup(true)
              : undefined
          }
          onEditGroup={
            activeGroupChat
              ? () => {
                  setShowHistory(false);
                  setEditingGroup(activeGroupChat);
                }
              : undefined
          }
          onClose={() => setShowHistory(false)}
          onCreateQC={handleCreateQC}
          onUpdateQC={handleUpdateQC}
          onToggleQCStar={handleToggleQCStar}
          onDeleteQC={handleDeleteQC}
        />

        <GroupEditor
          visible={editingGroup !== null}
          group={editingGroup}
          onClose={() => setEditingGroup(null)}
          onSave={handleGroupEditSave}
        />

        <GroupEditor
          visible={showConvertGroup && !!activeChatCharacter}
          group={null}
          fixedMemberId={activeChatCharacter?.id}
          defaultName={activeChatCharacter?.name}
          title="Convert to Group Chat"
          saveLabel="Convert"
          onClose={() => setShowConvertGroup(false)}
          onSave={handleConvertSave}
        />

        <FolderPicker
          visible={movingCharacter !== null}
          selectedId={movingCharacter?.folderId}
          onSelect={handleMoveSelect}
          onClose={() => setMovingCharacter(null)}
        />

        {renamingFolder && (
          <KeyboardAvoidingView
            style={st.historyPopupOverlay}
            behavior="padding"
          >
            <View style={st.historyPopupCard}>
              <Text style={st.historyPopupTitle}>Rename Folder</Text>
              <TextInput
                style={st.historyQCInput}
                placeholder="Folder name..."
                placeholderTextColor={st.textMuted.color}
                value={renamingFolder.draft}
                onChangeText={draft =>
                  setRenamingFolder({ ...renamingFolder, draft })
                }
                autoFocus
                onSubmitEditing={handleFolderRenameSave}
              />
              <View style={st.historyQCFormActions}>
                <TouchableOpacity
                  onPress={() => setRenamingFolder(null)}
                  style={st.historyQCFormBtn}
                >
                  <Text style={st.historyQCFormBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleFolderRenameSave}
                  style={[
                    st.historyQCFormBtn,
                    !renamingFolder.draft.trim() && { opacity: 0.4 },
                  ]}
                >
                  <Text style={st.historyQCFormBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        )}
      </View>
    </View>
  );
}

function SettingsScreen() {
  const st = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Navigation>();
  const setAppSettings = useAppStore(s => s.setAppSettings);

  useFocusEffect(
    useCallback(() => {
      return () => Keyboard.dismiss();
    }, []),
  );

  return (
    <View style={st.screen}>
      <View style={[st.safeArea, { paddingTop: insets.top, flex: 1 }]}>
        <SettingsHandler
          onApply={updated => setAppSettings(updated as unknown as AppSettings)}
          onOpenDebugger={() => navigation.navigate('Debugger')}
          onClose={() => navigation.goBack()}
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
    ? (characters.find(c => c.id === route.params.characterId) ?? null)
    : null;

  return (
    <View style={st.screen}>
      <View style={[st.safeArea, { paddingTop: insets.top, flex: 1 }]}>
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
      <View style={[st.safeArea, { paddingTop: insets.top, flex: 1 }]}>
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
        contentStyle: { backgroundColor: '#000' },
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ animation: 'slide_from_left' }}
      />
      <Stack.Screen
        name="Editor"
        component={EditorScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Debugger"
        component={DebuggerScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
    </Stack.Navigator>
  );
}

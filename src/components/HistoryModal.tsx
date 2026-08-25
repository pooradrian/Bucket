import {useEffect, useState} from 'react';
import {FlatList, Modal, ScrollView, Text, TextInput, TouchableOpacity, View} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {SessionSummary} from '../Database';
import {useTheme} from '../ThemeContext';
import {Character} from '../CharacterEditor';
import {QuickCharacter} from '../useChat';
import {formatRelativeTime} from '../relativeTime';

type HistoryTab = 'threads' | 'characters';

interface HistoryModalProps {
  visible: boolean;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  quickCharacters: QuickCharacter[];
  isGroupChat: boolean;
  groupMembers: Character[];
  onNewChat: () => void;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onConvertToGroup?: () => void;
  onEditGroup?: () => void;
  onClose: () => void;
  onCreateQC: (qc: {name: string; description: string; personality: string}) => void;
  onToggleQCStar: (id: string) => void;
  onDeleteQC: (id: string) => void;
}

export default function HistoryModal({
  visible,
  sessions,
  activeSessionId,
  quickCharacters,
  isGroupChat,
  groupMembers,
  onNewChat,
  onSwitchSession,
  onDeleteSession,
  onRenameSession,
  onConvertToGroup,
  onEditGroup,
  onClose,
  onCreateQC,
  onToggleQCStar,
  onDeleteQC,
}: HistoryModalProps) {
  const st = useTheme();
  const historySlide = useSharedValue(300);

  const [tab, setTab] = useState<HistoryTab>('threads');
  const [qcFormVisible, setQcFormVisible] = useState(false);
  const [qcName, setQcName] = useState('');
  const [qcDesc, setQcDesc] = useState('');
  const [qcPersonality, setQcPersonality] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{id: string; draft: string} | null>(null);

  const historyContentStyle = useAnimatedStyle(() => ({
    transform: [{translateY: historySlide.value}],
  }));

  useEffect(() => {
    if (visible) {
      historySlide.value = withTiming(0, {duration: 250});
    } else {
      historySlide.value = 300;
      setTab('threads');
      setQcFormVisible(false);
      setQcName('');
      setQcDesc('');
      setQcPersonality('');
      setConfirmingDeleteId(null);
      setRenaming(null);
    }
  }, [visible, historySlide]);

  const switchTab = (next: HistoryTab) => {
    setTab(next);
    setConfirmingDeleteId(null);
    setRenaming(null);
    if (next === 'characters') {
      setQcFormVisible(false);
    }
  };

  const handleCreateQC = () => {
    if (!qcName.trim()) return;
    onCreateQC({
      name: qcName.trim(),
      description: qcDesc.trim(),
      personality: qcPersonality.trim(),
    });
    setQcFormVisible(false);
    setQcName('');
    setQcDesc('');
    setQcPersonality('');
  };

  const handleRenameSave = () => {
    if (!renaming || !renaming.draft.trim()) return;
    onRenameSession(renaming.id, renaming.draft.trim());
    setRenaming(null);
  };

  const renderSessionRow = ({item}: {item: SessionSummary}) => {
    const isActive = item.id === activeSessionId;
    const confirming = confirmingDeleteId === item.id;
    const date = new Date(item.updatedAt);
    const timeStr =
      date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) +
      ' ' +
      date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
    return (
      <TouchableOpacity
        onPress={() => {
          if (!confirming) {
            onSwitchSession(item.id);
          }
        }}
        onLongPress={() => setRenaming({id: item.id, draft: item.name})}
        style={[st.sessionRow, isActive && st.sessionRowActive]}>
        <View style={st.sessionInfo}>
          <Text
            numberOfLines={1}
            style={isActive ? st.sessionDateActive : st.sessionDate}>
            {item.name || timeStr}
          </Text>
          <Text style={st.sessionMeta}>
            {formatRelativeTime(item.updatedAt)} · {item.messageCount}{' '}
            message{item.messageCount !== 1 ? 's' : ''}
          </Text>
          {!confirming && item.preview ? (
            <Text style={st.sessionPreview} numberOfLines={1}>
              {item.preview}
            </Text>
          ) : null}
        </View>
        {confirming ? (
          <View style={st.sessionActions}>
            <TouchableOpacity
              onPress={() => onDeleteSession(item.id)}
              style={[st.sessionConfirmBtn, st.sessionConfirmBtnDanger]}>
              <Text style={st.sessionConfirmBtnText}>Confirm</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setConfirmingDeleteId(null)}
              style={[st.sessionConfirmBtn, st.sessionConfirmBtnNeutral]}>
              <Text style={[st.sessionConfirmBtnText, st.sessionConfirmBtnTextNeutral]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={st.sessionActions}>
            <TouchableOpacity
              onPress={() => setRenaming({id: item.id, draft: item.name})}
              style={st.sessionEditBtn}>
              <Text style={st.sessionEditBtnText}>{'✎'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setConfirmingDeleteId(item.id)}
              style={st.sessionDeleteBtn}>
              <Text style={st.sessionDeleteBtnText}>×</Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderThreadsTab = () => (
    <FlatList
      data={sessions}
      keyExtractor={item => item.id}
      renderItem={renderSessionRow}
      ListHeaderComponent={
        <TouchableOpacity onPress={onNewChat} style={st.newChatBtn}>
          <Text style={st.newChatBtnText}>+ New Chat</Text>
        </TouchableOpacity>
      }
      ListEmptyComponent={<Text style={st.emptyHistoryText}>No chats yet</Text>}
    />
  );

  const renderCharactersTab = () => (
    <ScrollView>
      {isGroupChat ? (
        <>
          <Text style={st.historySectionTitle}>Members</Text>
          {groupMembers.map(member => (
            <View key={member.id} style={st.historyQCItem}>
              <View style={st.historyQCInfo}>
                <Text style={st.historyQCName}>{member.name}</Text>
              </View>
            </View>
          ))}
          {groupMembers.length === 0 && (
            <Text style={st.emptyHistoryText}>No members yet</Text>
          )}
          {onEditGroup && (
            <TouchableOpacity onPress={onEditGroup} style={st.newChatBtn}>
              <Text style={st.newChatBtnText}>Edit Group Members</Text>
            </TouchableOpacity>
          )}
        </>
      ) : (
        <>
          {activeSessionId ? (
            <>
              <Text style={st.historySectionTitle}>Quick Characters</Text>
              {quickCharacters.map(qc => (
                <View key={qc.id} style={st.historyQCItem}>
                  <View style={st.historyQCInfo}>
                    <Text style={st.historyQCName}>{qc.name}</Text>
                    {qc.description ? (
                      <Text style={st.historyQCDesc} numberOfLines={1}>
                        {qc.description}
                      </Text>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    onPress={() => onToggleQCStar(qc.id)}
                    style={st.historyQCActionBtn}>
                    <Text
                      style={[
                        st.historyQCActionBtnText,
                        {color: qc.starred ? '#f39c12' : st.textMuted.color},
                      ]}>
                      {qc.starred ? '★' : '☆'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onDeleteQC(qc.id)}
                    style={st.historyQCActionBtn}>
                    <Text style={[st.historyQCActionBtnText, {color: st.dangerText.color}]}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}

              {qcFormVisible ? (
                <View style={st.historyQCForm}>
                  <TextInput
                    style={st.historyQCInput}
                    placeholder="Name..."
                    placeholderTextColor={st.textMuted.color}
                    value={qcName}
                    onChangeText={setQcName}
                  />
                  <TextInput
                    style={st.historyQCInput}
                    placeholder="Description..."
                    placeholderTextColor={st.textMuted.color}
                    value={qcDesc}
                    onChangeText={setQcDesc}
                  />
                  <TextInput
                    style={st.historyQCInput}
                    placeholder="Personality..."
                    placeholderTextColor={st.textMuted.color}
                    value={qcPersonality}
                    onChangeText={setQcPersonality}
                  />
                  <View style={st.historyQCFormActions}>
                    <TouchableOpacity
                      onPress={() => setQcFormVisible(false)}
                      style={st.historyQCFormBtn}>
                      <Text style={st.historyQCFormBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleCreateQC} style={st.historyQCFormBtn}>
                      <Text style={st.historyQCFormBtnText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => setQcFormVisible(true)}
                  style={st.newChatBtn}>
                  <Text style={st.newChatBtnText}>+ Quick Character</Text>
                </TouchableOpacity>
              )}

              {activeSessionId && onConvertToGroup && (
                <TouchableOpacity onPress={onConvertToGroup} style={st.newChatBtn}>
                  <Text style={st.newChatBtnText}>Convert to Group</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <Text style={st.emptyHistoryText}>
              Send the first message to manage quick characters.
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={onClose}>
      <View style={st.historyModalOverlay}>
        <Animated.View style={[st.historyModalContent, historyContentStyle]}>
          <View style={st.historyHeader}>
            <Text style={st.historyHeaderText}>Chat History</Text>
            <TouchableOpacity onPress={onClose} style={st.historyCloseBtn}>
              <Text style={st.historyCloseBtnText}>×</Text>
            </TouchableOpacity>
          </View>

          <View style={st.historyTabs}>
            <TouchableOpacity
              onPress={() => switchTab('threads')}
              style={[st.historyTabBtn, tab === 'threads' && st.historyTabBtnActive]}>
              <Text
                style={[
                  st.historyTabBtnText,
                  tab === 'threads' && st.historyTabBtnTextActive,
                ]}>
                Threads
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => switchTab('characters')}
              style={[st.historyTabBtn, tab === 'characters' && st.historyTabBtnActive]}>
              <Text
                style={[
                  st.historyTabBtnText,
                  tab === 'characters' && st.historyTabBtnTextActive,
                ]}>
                Characters
              </Text>
            </TouchableOpacity>
          </View>

          {tab === 'threads' ? renderThreadsTab() : renderCharactersTab()}
        </Animated.View>

        {renaming && (
          <View style={st.historyPopupOverlay}>
            <View style={st.historyPopupCard}>
              <Text style={st.historyPopupTitle}>Rename Chat</Text>
              <TextInput
                style={st.historyQCInput}
                placeholder="Chat name..."
                placeholderTextColor={st.textMuted.color}
                value={renaming.draft}
                onChangeText={draft => setRenaming({...renaming, draft})}
                autoFocus
                onSubmitEditing={handleRenameSave}
              />
              <View style={st.historyQCFormActions}>
                <TouchableOpacity
                  onPress={() => setRenaming(null)}
                  style={st.historyQCFormBtn}>
                  <Text style={st.historyQCFormBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleRenameSave}
                  style={[st.historyQCFormBtn, !renaming.draft.trim() && {opacity: 0.4}]}>
                  <Text style={st.historyQCFormBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

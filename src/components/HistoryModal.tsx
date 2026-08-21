import {useEffect, useState} from 'react';
import {FlatList, Modal, Text, TextInput, TouchableOpacity, View} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {SessionSummary} from '../Database';
import {useTheme} from '../ThemeContext';
import {QuickCharacter} from '../useChat';

interface HistoryModalProps {
  visible: boolean;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  quickCharacters: QuickCharacter[];
  onNewChat: () => void;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onConvertToGroup?: () => void;
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
  onNewChat,
  onSwitchSession,
  onDeleteSession,
  onConvertToGroup,
  onClose,
  onCreateQC,
  onToggleQCStar,
  onDeleteQC,
}: HistoryModalProps) {
  const st = useTheme();
  const historySlide = useSharedValue(300);

  const [qcFormVisible, setQcFormVisible] = useState(false);
  const [qcName, setQcName] = useState('');
  const [qcDesc, setQcDesc] = useState('');
  const [qcPersonality, setQcPersonality] = useState('');

  const historyContentStyle = useAnimatedStyle(() => ({
    transform: [{translateY: historySlide.value}],
  }));

  useEffect(() => {
    if (visible) {
      historySlide.value = withTiming(0, {duration: 250});
    } else {
      historySlide.value = 300;
      setQcFormVisible(false);
      setQcName('');
      setQcDesc('');
      setQcPersonality('');
    }
  }, [visible, historySlide]);

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

          <FlatList
            data={sessions}
            keyExtractor={item => item.id}
            ListHeaderComponent={
              <>
                <TouchableOpacity onPress={onNewChat} style={st.newChatBtn}>
                  <Text style={st.newChatBtnText}>+ New Chat</Text>
                </TouchableOpacity>

                {activeSessionId && onConvertToGroup && (
                  <TouchableOpacity onPress={onConvertToGroup} style={st.newChatBtn}>
                    <Text style={st.newChatBtnText}>Convert to Group</Text>
                  </TouchableOpacity>
                )}

                {activeSessionId && (
                  <>
                    <Text style={st.historySectionTitle}>Quick Characters</Text>
                    {quickCharacters.map(qc => (
                      <View key={qc.id} style={st.historyQCItem}>
                        <View style={st.historyQCInfo}>
                          <Text style={st.historyQCName}>{qc.name}</Text>
                          {qc.description ? <Text style={st.historyQCDesc} numberOfLines={1}>{qc.description}</Text> : null}
                        </View>
                        <TouchableOpacity onPress={() => onToggleQCStar(qc.id)} style={st.historyQCActionBtn}>
                          <Text style={[st.historyQCActionBtnText, {color: qc.starred ? '#f39c12' : st.textMuted.color}]}>
                            {qc.starred ? '★' : '☆'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => onDeleteQC(qc.id)} style={st.historyQCActionBtn}>
                          <Text style={[st.historyQCActionBtnText, {color: '#cc3333'}]}>×</Text>
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
                          <TouchableOpacity onPress={() => setQcFormVisible(false)} style={st.historyQCFormBtn}>
                            <Text style={st.historyQCFormBtnText}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={handleCreateQC} style={st.historyQCFormBtn}>
                            <Text style={st.historyQCFormBtnText}>Add</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity onPress={() => setQcFormVisible(true)} style={st.newChatBtn}>
                        <Text style={st.newChatBtnText}>+ Quick Character</Text>
                      </TouchableOpacity>
                    )}
                    <Text style={[st.historySectionTitle, {marginTop: 16}]}>Sessions</Text>
                  </>
                )}
              </>
            }
            renderItem={({item}) => {
              const isActive = item.id === activeSessionId;
              const date = new Date(item.updatedAt);
              const timeStr =
                date.toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                }) +
                ' ' +
                date.toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                });
              return (
                <TouchableOpacity
                  onPress={() => onSwitchSession(item.id)}
                  style={[
                    st.sessionRow,
                    isActive && st.sessionRowActive,
                  ]}>
                  <View style={st.sessionInfo}>
                    <Text
                      style={
                        isActive ? st.sessionDateActive : st.sessionDate
                      }>
                      {timeStr}
                    </Text>
                    <Text style={st.sessionCount}>
                      {item.messageCount} message
                      {item.messageCount !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => onDeleteSession(item.id)}
                    style={st.sessionDeleteBtn}>
                    <Text style={st.sessionDeleteBtnText}>×</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <Text style={st.emptyHistoryText}>No chats yet</Text>
            }
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

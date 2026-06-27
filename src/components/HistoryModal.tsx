import {useEffect} from 'react';
import {FlatList, Modal, Text, TouchableOpacity, View} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {SessionSummary} from '../Database';
import {useTheme} from '../ThemeContext';

interface HistoryModalProps {
  visible: boolean;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onNewChat: () => void;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onClose: () => void;
}

export default function HistoryModal({
  visible,
  sessions,
  activeSessionId,
  onNewChat,
  onSwitchSession,
  onDeleteSession,
  onClose,
}: HistoryModalProps) {
  const st = useTheme();
  const historySlide = useSharedValue(300);

  const historyContentStyle = useAnimatedStyle(() => ({
    transform: [{translateY: historySlide.value}],
  }));

  useEffect(() => {
    if (visible) {
      historySlide.value = withTiming(0, {duration: 250});
    } else {
      historySlide.value = 300;
    }
  }, [visible, historySlide]);

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

          <TouchableOpacity onPress={onNewChat} style={st.newChatBtn}>
            <Text style={st.newChatBtnText}>+ New Chat</Text>
          </TouchableOpacity>

          <FlatList
            data={sessions}
            keyExtractor={item => item.id}
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

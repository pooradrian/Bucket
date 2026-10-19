import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { generateId } from '../Database';
import { useAppStore } from '../store';
import { useTheme } from '../ThemeContext';

interface FolderPickerProps {
  visible: boolean;
  selectedId?: string;
  onSelect: (folderId: string) => void;
  onClose: () => void;
}

export default function FolderPicker({
  visible,
  selectedId,
  onSelect,
  onClose,
}: FolderPickerProps) {
  const st = useTheme();
  const folders = useAppStore(store => store.folders);
  const saveFolder = useAppStore(store => store.saveFolder);
  const [newName, setNewName] = useState('');

  const slide = useSharedValue(300);
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slide.value }],
  }));

  useEffect(() => {
    if (visible) {
      slide.value = withTiming(0, { duration: 250 });
    } else {
      slide.value = 300;
      setNewName('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    const id = generateId();
    saveFolder({ id, name });
    onSelect(id);
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={st.lorebookModalOverlay}>
          <Animated.View style={[st.lorebookModalContent, contentStyle]}>
            <View style={st.lorebookModalHeader}>
              <Text style={st.lorebookModalTitle}>Choose Folder</Text>
              <TouchableOpacity onPress={onClose} style={st.lorebookCloseBtn}>
                <Text style={st.lorebookCloseBtnText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <TouchableOpacity
                onPress={() => onSelect('')}
                style={[
                  st.lorebookOption,
                  !selectedId && st.lorebookOptionActive,
                ]}
              >
                <Text
                  style={
                    !selectedId
                      ? st.lorebookOptionTextActive
                      : st.lorebookOptionText
                  }
                >
                  No folder
                </Text>
              </TouchableOpacity>

              {folders.map(folder => {
                const isSelected = folder.id === selectedId;
                return (
                  <TouchableOpacity
                    key={folder.id}
                    onPress={() => onSelect(folder.id)}
                    style={[
                      st.lorebookOption,
                      isSelected && st.lorebookOptionActive,
                    ]}
                  >
                    <Text
                      style={
                        isSelected
                          ? st.lorebookOptionTextActive
                          : st.lorebookOptionText
                      }
                    >
                      {folder.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
              <TextInput
                style={st.historyQCInput}
                placeholder="New folder name..."
                placeholderTextColor={st.textMuted.color}
                value={newName}
                onChangeText={setNewName}
                onSubmitEditing={handleCreate}
              />
              <View style={st.historyQCFormActions}>
                <TouchableOpacity
                  onPress={handleCreate}
                  style={[
                    st.historyQCFormBtn,
                    !newName.trim() && { opacity: 0.4 },
                  ]}
                >
                  <Text style={st.historyQCFormBtnText}>Create Folder</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

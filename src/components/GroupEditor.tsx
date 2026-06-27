import {useEffect, useState} from 'react';
import {
  Image,
  Modal,
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
import {useAppStore, GroupChat} from '../store';
import {useTheme} from '../ThemeContext';

interface GroupEditorProps {
  visible: boolean;
  group: GroupChat | null;
  onClose: () => void;
  onSave: (group: GroupChat) => void;
}

export default function GroupEditor({
  visible,
  group,
  onClose,
  onSave,
}: GroupEditorProps) {
  const st = useTheme();
  const characters = useAppStore(store => store.characters);

  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);

  const slide = useSharedValue(300);
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{translateY: slide.value}],
  }));

  useEffect(() => {
    if (visible) {
      slide.value = withTiming(0, {duration: 250});
      if (group) {
        setGroupName(group.name);
        setGroupDescription(group.description || '');
        setSelectedCharacterIds([...group.characterIds]);
      } else {
        setGroupName('');
        setGroupDescription('');
        setSelectedCharacterIds([]);
      }
    } else {
      slide.value = 300;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggleCharacterSelection = (id: string) => {
    setSelectedCharacterIds(prev =>
      prev.includes(id) ? prev.filter(cId => cId !== id) : [...prev, id],
    );
  };

  const handleSave = () => {
    if (!groupName.trim() || selectedCharacterIds.length === 0 || !group) return;
    onSave({
      ...group,
      name: groupName.trim(),
      description: groupDescription.trim(),
      characterIds: selectedCharacterIds,
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={onClose}>
      <View style={st.groupEditorOverlay}>
        <Animated.View style={[st.groupEditorContent, contentStyle]}>
          <View style={st.groupEditorHeader}>
            <Text style={st.groupEditorTitle}>Edit Group Chat</Text>
            <TouchableOpacity
              onPress={onClose}
              style={st.groupEditorCloseBtn}>
              <Text style={st.groupEditorCloseBtnText}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={st.groupEditorBody}>
            <View style={st.groupEditorField}>
              <Text style={st.groupEditorLabel}>Group Name</Text>
              <TextInput
                style={st.groupEditorInput}
                value={groupName}
                onChangeText={setGroupName}
                placeholder="Enter group name"
                placeholderTextColor={st.textMuted.color}
              />
            </View>

            <View style={st.groupEditorField}>
              <Text style={st.groupEditorLabel}>Description (optional)</Text>
              <TextInput
                style={[st.groupEditorInput, {minHeight: 60, textAlignVertical: 'top'}]}
                value={groupDescription}
                onChangeText={setGroupDescription}
                placeholder="What is this group about?"
                placeholderTextColor={st.textMuted.color}
                multiline
                numberOfLines={2}
              />
            </View>

            <View style={st.groupEditorField}>
              <Text style={st.groupEditorLabel}>Select Characters</Text>
              {characters.map(char => (
                <TouchableOpacity
                  key={char.id}
                  onPress={() => toggleCharacterSelection(char.id)}
                  style={st.groupEditorMemberRow}>
                  {char.icon ? (
                    <Image source={{uri: char.icon}} style={st.groupEditorMemberAvatar} />
                  ) : (
                    <View style={[st.groupEditorMemberAvatar, {justifyContent: 'center', alignItems: 'center'}]}>
                      <Text style={{color: st.textMuted.color, fontSize: 16}}>{char.name[0]}</Text>
                    </View>
                  )}
                  <View style={st.groupEditorMemberInfo}>
                    <Text style={st.groupEditorMemberName}>{char.name}</Text>
                    {char.description ? (
                      <Text style={st.groupEditorMemberDesc} numberOfLines={1}>{char.description}</Text>
                    ) : null}
                  </View>
                  <View style={[
                    st.groupEditorMemberCheck,
                    selectedCharacterIds.includes(char.id) && st.groupEditorMemberCheckActive,
                  ]}>
                    {selectedCharacterIds.includes(char.id) && (
                      <Text style={st.groupEditorMemberCheckText}>✓</Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
              {characters.length === 0 && (
                <Text style={st.lorebookEmptyText}>
                  No characters yet.{'\n'}Create some characters first.
                </Text>
              )}
            </View>

            <TouchableOpacity
              onPress={handleSave}
              style={[st.groupEditorSaveBtn, (!groupName.trim() || selectedCharacterIds.length === 0) && {opacity: 0.4}]}>
              <Text style={st.groupEditorSaveBtnText}>Save Group</Text>
            </TouchableOpacity>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

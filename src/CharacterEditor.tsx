import React, {useEffect, useState} from 'react';
import {
  Image,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {launchImageLibrary} from 'react-native-image-picker';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {useAppStore, GroupChat} from './store';
import {generateId} from './Database';
import {useTheme} from './ThemeContext';
import {estimateTokens} from './PromptHandler';

export interface Character {
  id: string;
  name: string;
  description: string;
  initialMessage: string;
  writingStyle: string;
  personality: string;
  scenario: string;
  exampleMessages?: string;
  lorebookIds: string[];
  icon?: string;
}

interface CharacterEditorProps {
  character: Character | null;
  onClose: () => void;
  onSave: (character: Character) => void;
  onMakeGroup?: () => void;
}

export default function CharacterEditor({
  character,
  onClose,
  onSave,
  onMakeGroup,
}: CharacterEditorProps) {
  const st = useTheme();
  const lorebooks = useAppStore(store => store.lorebooks);
  const characters = useAppStore(store => store.characters);
  const saveGroupChat = useAppStore(store => store.saveGroupChat);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [initialMessage, setInitialMessage] = useState('');
  const [writingStyle, setWritingStyle] = useState('');
  const [personality, setPersonality] = useState('');
  const [scenario, setScenario] = useState('');
  const [exampleMessages, setExampleMessages] = useState('');
  const [lorebookIds, setLorebookIds] = useState<string[]>([]);
  const [showLorebookPicker, setShowLorebookPicker] = useState(false);
  const [icon, setIcon] = useState('');
  const [showGroupEditor, setShowGroupEditor] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);

  const lorebookSlide = useSharedValue(300);
  const lorebookContentStyle = useAnimatedStyle(() => ({
    transform: [{translateY: lorebookSlide.value}],
  }));
  const groupSlide = useSharedValue(300);
  const groupContentStyle = useAnimatedStyle(() => ({
    transform: [{translateY: groupSlide.value}],
  }));

  useEffect(() => {
    if (showLorebookPicker) {
      lorebookSlide.value = withTiming(0, {duration: 250});
    } else {
      lorebookSlide.value = 300;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLorebookPicker]);

  useEffect(() => {
    if (showGroupEditor) {
      groupSlide.value = withTiming(0, {duration: 250});
    } else {
      groupSlide.value = 300;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGroupEditor]);

  useEffect(() => {
    if (character) {
      setName(character.name);
      setDescription(character.description || '');
      setInitialMessage(character.initialMessage || '');
      setWritingStyle(character.writingStyle || '');
      setPersonality(character.personality || '');
      setScenario(character.scenario || '');
      setExampleMessages(character.exampleMessages || '');
      setLorebookIds(character.lorebookIds || []);
      setIcon(character.icon || '');
    } else {
      setName('');
      setDescription('');
      setInitialMessage('');
      setWritingStyle('');
      setPersonality('');
      setScenario('');
      setExampleMessages('');
      setLorebookIds([]);
      setIcon('');
    }
  }, [character]);

  const handleSave = () => {
    if (!name.trim()) return;
    const newCharacter: Character = {
      id: character ? character.id : generateId(),
      name: name.trim(),
      description: description.trim(),
      initialMessage: initialMessage.trim(),
      writingStyle: writingStyle.trim(),
      personality: personality.trim(),
      scenario: scenario.trim(),
      lorebookIds,
      icon,
    };
    if (exampleMessages.trim()) {
      newCharacter.exampleMessages = exampleMessages.trim();
    }
    onSave(newCharacter);
  };

  const handlePickIcon = async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      maxWidth: 256,
      maxHeight: 256,
      quality: 0.8,
    });
    if (result.assets && result.assets.length > 0 && result.assets[0].uri) {
      setIcon(result.assets[0].uri);
    }
  };

  const handleSaveGroup = () => {
    if (!groupName.trim() || selectedCharacterIds.length === 0) return;
    const group: GroupChat = {
      id: generateId(),
      name: groupName.trim(),
      description: groupDescription.trim(),
      characterIds: selectedCharacterIds,
    };
    saveGroupChat(group);
    setShowGroupEditor(false);
    setGroupName('');
    setGroupDescription('');
    setSelectedCharacterIds([]);
    if (onMakeGroup) onMakeGroup();
  };

  const toggleCharacterSelection = (id: string) => {
    setSelectedCharacterIds(prev =>
      prev.includes(id) ? prev.filter(cId => cId !== id) : [...prev, id],
    );
  };

  const totalTokens =
    estimateTokens(name) +
    estimateTokens(description) +
    estimateTokens(initialMessage) +
    estimateTokens(writingStyle) +
    estimateTokens(personality) +
    estimateTokens(scenario) +
    estimateTokens(exampleMessages);

  return (
    <View style={st.editorScreen}>
      <View style={st.editorHeader}>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <TouchableOpacity onPress={onClose} style={st.editorCancelBtn}>
            <Text style={st.editorCancelText}>Cancel</Text>
          </TouchableOpacity>
          {onMakeGroup && (
            <TouchableOpacity onPress={() => setShowGroupEditor(true)} style={st.makeGroupBtn}>
              <Text style={st.makeGroupBtnText}>Make Group</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={st.editorTitle}>
          {character ? 'Edit Character' : 'New Character'}
        </Text>
        <TouchableOpacity onPress={handleSave}>
          <Text style={st.editorSave}>Save</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={st.editorKeyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={st.editorScroll}>
          {/* Icon */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Avatar</Text>
            <TouchableOpacity
              onPress={handlePickIcon}
              style={st.iconCircle}>
              {icon ? (
                <Image
                  source={{uri: icon}}
                  style={st.iconImage}
                />
              ) : (
                <Text style={st.iconPlaceholder}>Tap to{'\n'}pick image</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Name */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Name</Text>
            <TextInput
              style={st.cardInput}
              value={name}
              onChangeText={setName}
              placeholder="Character name"
              placeholderTextColor={st.textMuted.color}
              autoFocus
            />
          </View>

          {/* Description */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Description</Text>
            <TextInput
              style={st.cardInputMultiline}
              value={description}
              onChangeText={setDescription}
              placeholder="A short description of who this character is"
              placeholderTextColor={st.textMuted.color}
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Personality */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Personality</Text>
            <TextInput
              style={st.cardInputMultiline}
              value={personality}
              onChangeText={setPersonality}
              placeholder="Describe their personality traits, quirks, and demeanor"
              placeholderTextColor={st.textMuted.color}
              multiline
              numberOfLines={4}
            />
          </View>

          {/* Writing Style */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Writing Style</Text>
            <TextInput
              style={st.cardInputMultiline}
              value={writingStyle}
              onChangeText={setWritingStyle}
              placeholder="How do they write? Formal, casual, verbose, terse, poetic..."
              placeholderTextColor={st.textMuted.color}
              multiline
              numberOfLines={4}
            />
          </View>

          {/* Scenario */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Scenario</Text>
            <TextInput
              style={st.cardInputMultiline}
              value={scenario}
              onChangeText={setScenario}
              placeholder="The setting or context of the conversation"
              placeholderTextColor={st.textMuted.color}
              multiline
              numberOfLines={4}
            />
          </View>

          {/* Example Messages */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Example Messages</Text>
            <TextInput
              style={st.cardInputMultilineLarge}
              value={exampleMessages}
              onChangeText={setExampleMessages}
              placeholder="Sample dialogue showing how the character speaks (one example per line)"
              placeholderTextColor={st.textMuted.color}
              multiline
              numberOfLines={5}
            />
          </View>

          {/* Initial Message */}
          <View style={st.card}>
            <Text style={st.cardTitle}>First Message</Text>
            <TextInput
              style={st.cardInputMultilineLarge}
              value={initialMessage}
              onChangeText={setInitialMessage}
              placeholder="The character's opening message when a new chat starts"
              placeholderTextColor={st.textMuted.color}
              multiline
              numberOfLines={5}
            />
          </View>

          {/* Lorebooks */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Lorebooks</Text>
            <TouchableOpacity
              onPress={() => setShowLorebookPicker(true)}>
              <Text style={st.cardDescription}>
                {lorebookIds.length > 0
                  ? lorebookIds
                      .map(id => lorebooks.find(l => l.id === id)?.fileName || 'Unknown')
                      .join(', ')
                  : 'No lorebooks assigned'}
              </Text>
            </TouchableOpacity>
            {lorebookIds.length > 0 && (
              <TouchableOpacity
                onPress={() => setLorebookIds([])}
                style={st.removeAssignment}>
                <Text style={st.removeAssignmentText}>Remove all assignments</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Lorebook Picker Modal */}
          <Modal
            visible={showLorebookPicker}
            animationType="none"
            transparent
            onRequestClose={() => setShowLorebookPicker(false)}>
            <View style={st.lorebookModalOverlay}>
              <Animated.View style={[st.lorebookModalContent, lorebookContentStyle]}>
                <View style={st.lorebookModalHeader}>
                  <Text style={st.lorebookModalTitle}>
                    Choose Lorebooks
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowLorebookPicker(false)}
                    style={st.lorebookCloseBtn}>
                    <Text style={st.lorebookCloseBtnText}>×</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView>
                  {lorebooks.map(lorebook => {
                    const isSelected = lorebookIds.includes(lorebook.id);
                    return (
                      <TouchableOpacity
                        key={lorebook.id}
                        onPress={() => {
                          setLorebookIds(prev =>
                            isSelected
                              ? prev.filter(id => id !== lorebook.id)
                              : [...prev, lorebook.id],
                          );
                        }}
                        style={[st.lorebookOption, isSelected && st.lorebookOptionActive]}>
                        <Text style={isSelected ? st.lorebookOptionTextActive : st.lorebookOptionText}>
                          {lorebook.fileName}
                        </Text>
                        <Text style={st.lorebookEntryCount}>
                          {lorebook.entries.length} entries
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  {lorebooks.length === 0 && (
                    <Text style={st.lorebookEmptyText}>
                      No lorebooks imported yet.{'\n'}Import one in Settings.
                    </Text>
                  )}
                </ScrollView>
              </Animated.View>
            </View>
          </Modal>

          {/* Token Counter */}
          <View style={st.tokenCounter}>
            <Text style={st.tokenCounterLabel}>
              Estimated tokens
            </Text>
            <Text style={st.tokenCounterValue}>
              ~{totalTokens.toLocaleString()}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Group Editor Modal */}
      <Modal
        visible={showGroupEditor}
        animationType="none"
        transparent
        onRequestClose={() => setShowGroupEditor(false)}>
        <View style={st.groupEditorOverlay}>
          <Animated.View style={[st.groupEditorContent, groupContentStyle]}>
            <View style={st.groupEditorHeader}>
              <Text style={st.groupEditorTitle}>Create Group Chat</Text>
              <TouchableOpacity
                onPress={() => setShowGroupEditor(false)}
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
                onPress={handleSaveGroup}
                style={[st.groupEditorSaveBtn, (!groupName.trim() || selectedCharacterIds.length === 0) && {opacity: 0.4}]}>
                <Text style={st.groupEditorSaveBtnText}>Create Group</Text>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

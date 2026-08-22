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
import {estimateTokens, loadPromptConfig, Persona} from './PromptHandler';
import {CUSTOM_FIELDS, CustomFieldValue, getCustomField} from './CustomFields';
import AutoGrowTextInput from './components/AutoGrowTextInput';

export interface Character {
  id: string;
  name: string;
  description: string;
  initialMessage: string;
  personality: string;
  scenario: string;
  exampleMessages?: string;
  lorebookIds: string[];
  icon?: string;
  customFields?: CustomFieldValue[];
  personaId?: string;
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
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
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
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaId, setPersonaId] = useState('');
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);

  const lorebookSlide = useSharedValue(300);
  const lorebookContentStyle = useAnimatedStyle(() => ({
    transform: [{translateY: lorebookSlide.value}],
  }));
  const personaSlide = useSharedValue(300);
  const personaContentStyle = useAnimatedStyle(() => ({
    transform: [{translateY: personaSlide.value}],
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
    if (showPersonaPicker) {
      personaSlide.value = withTiming(0, {duration: 250});
    } else {
      personaSlide.value = 300;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPersonaPicker]);

  useEffect(() => {
    loadPromptConfig().then(cfg => setPersonas(cfg.personas ?? []));
  }, []);

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
      const values: Record<string, string> = {};
      for (const def of CUSTOM_FIELDS) {
        values[def.id] = getCustomField(character, def.id);
      }
      setCustomFieldValues(values);
      setPersonality(character.personality || '');
      setScenario(character.scenario || '');
      setExampleMessages(character.exampleMessages || '');
      setLorebookIds(character.lorebookIds || []);
      setIcon(character.icon || '');
      setPersonaId(character.personaId || '');
    } else {
      setName('');
      setDescription('');
      setInitialMessage('');
      setCustomFieldValues({});
      setPersonality('');
      setScenario('');
      setExampleMessages('');
      setLorebookIds([]);
      setIcon('');
      setPersonaId('');
    }
  }, [character]);

  const handleSave = () => {
    if (!name.trim()) return;
    const customFields: CustomFieldValue[] = CUSTOM_FIELDS.map(def => ({
      id: def.id,
      value: (customFieldValues[def.id] || '').trim(),
    })).filter(f => f.value.length > 0);
    const newCharacter: Character = {
      id: character ? character.id : generateId(),
      name: name.trim(),
      description: description.trim(),
      initialMessage: initialMessage.trim(),
      personality: personality.trim(),
      scenario: scenario.trim(),
      lorebookIds,
      icon,
      customFields,
      personaId: personaId || undefined,
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
    CUSTOM_FIELDS.reduce(
      (sum, def) => sum + estimateTokens(customFieldValues[def.id] || ''),
      0,
    ) +
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
            <AutoGrowTextInput
              style={st.cardInputMultiline}
              minHeight={80}
              value={description}
              onChangeText={setDescription}
              placeholder="A short description of who this character is"
              placeholderTextColor={st.textMuted.color}
            />
          </View>

          {/* Personality */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Personality</Text>
            <AutoGrowTextInput
              style={st.cardInputMultiline}
              minHeight={80}
              value={personality}
              onChangeText={setPersonality}
              placeholder="Describe their personality traits, quirks, and demeanor"
              placeholderTextColor={st.textMuted.color}
            />
          </View>

          {CUSTOM_FIELDS.map(def => (
            <View style={st.card} key={def.id}>
              <Text style={st.cardTitle}>{def.label}</Text>
              {def.multiline ? (
                <AutoGrowTextInput
                  style={st.cardInputMultiline}
                  minHeight={80}
                  value={customFieldValues[def.id] || ''}
                  onChangeText={text =>
                    setCustomFieldValues(prev => ({...prev, [def.id]: text}))
                  }
                  placeholder={def.placeholder}
                  placeholderTextColor={st.textMuted.color}
                />
              ) : (
                <TextInput
                  style={st.cardInput}
                  value={customFieldValues[def.id] || ''}
                  onChangeText={text =>
                    setCustomFieldValues(prev => ({...prev, [def.id]: text}))
                  }
                  placeholder={def.placeholder}
                  placeholderTextColor={st.textMuted.color}
                />
              )}
            </View>
          ))}

          {/* Scenario */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Scenario</Text>
            <AutoGrowTextInput
              style={st.cardInputMultiline}
              minHeight={80}
              value={scenario}
              onChangeText={setScenario}
              placeholder="The setting or context of the conversation"
              placeholderTextColor={st.textMuted.color}
            />
          </View>

          {/* Example Messages */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Example Messages</Text>
            <AutoGrowTextInput
              style={st.cardInputMultilineLarge}
              minHeight={100}
              value={exampleMessages}
              onChangeText={setExampleMessages}
              placeholder="Sample dialogue showing how the character speaks (one example per line)"
              placeholderTextColor={st.textMuted.color}
            />
          </View>

          {/* Initial Message */}
          <View style={st.card}>
            <Text style={st.cardTitle}>First Message</Text>
            <AutoGrowTextInput
              style={st.cardInputMultilineLarge}
              minHeight={100}
              value={initialMessage}
              onChangeText={setInitialMessage}
              placeholder="The character's opening message when a new chat starts"
              placeholderTextColor={st.textMuted.color}
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

          {/* Persona */}
          <View style={st.card}>
            <Text style={st.cardTitle}>Persona</Text>
            <TouchableOpacity onPress={() => setShowPersonaPicker(true)}>
              <Text style={st.cardDescription}>
                {personaId
                  ? (personas.find(p => p.id === personaId)?.name || 'Unknown persona')
                  : 'No persona assigned (follows global settings)'}
              </Text>
            </TouchableOpacity>
            {personaId && (
              <TouchableOpacity
                onPress={() => setPersonaId('')}
                style={st.removeAssignment}>
                <Text style={st.removeAssignmentText}>Remove assignment</Text>
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
                          {lorebook.entryCount} entries
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

          {/* Persona Picker Modal */}
          <Modal
            visible={showPersonaPicker}
            animationType="none"
            transparent
            onRequestClose={() => setShowPersonaPicker(false)}>
            <View style={st.lorebookModalOverlay}>
              <Animated.View style={[st.lorebookModalContent, personaContentStyle]}>
                <View style={st.lorebookModalHeader}>
                  <Text style={st.lorebookModalTitle}>
                    Choose Persona
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowPersonaPicker(false)}
                    style={st.lorebookCloseBtn}>
                    <Text style={st.lorebookCloseBtnText}>×</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView>
                  <TouchableOpacity
                    onPress={() => {
                      setPersonaId('');
                      setShowPersonaPicker(false);
                    }}
                    style={[st.lorebookOption, !personaId && st.lorebookOptionActive]}>
                    <Text style={!personaId ? st.lorebookOptionTextActive : st.lorebookOptionText}>
                      None (follow global settings)
                    </Text>
                  </TouchableOpacity>

                  {personas.map(persona => {
                    const isSelected = personaId === persona.id;
                    return (
                      <TouchableOpacity
                        key={persona.id}
                        onPress={() => {
                          setPersonaId(persona.id);
                          setShowPersonaPicker(false);
                        }}
                        style={[st.lorebookOption, isSelected && st.lorebookOptionActive]}>
                        <Text style={isSelected ? st.lorebookOptionTextActive : st.lorebookOptionText}>
                          {persona.name}
                        </Text>
                        {persona.description ? (
                          <Text style={st.lorebookEntryCount} numberOfLines={1}>
                            {persona.description}
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}

                  {personas.length === 0 && (
                    <Text style={st.lorebookEmptyText}>
                      No personas defined yet.{'\n'}Create them in Settings → System Prompt.
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

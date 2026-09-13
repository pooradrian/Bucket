import {useEffect, useRef, useState} from 'react';
import {
  Alert,
  Keyboard,
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
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {useTheme} from '../ThemeContext';
import {generateId, getLorebookEntriesFromDB} from '../Database';
import {
  LorebookState,
  buildLorebookState,
  saveLorebookState,
  splitBulkLines,
} from '../RAGHandler';

interface Draft {
  key: string;
  text: string;
}

interface LorebookEditorProps {
  visible: boolean;
  lorebook: LorebookState | null;
  onClose: () => void;
  onSaved: (lorebooks: LorebookState[], savedId: string) => void;
}

export default function LorebookEditor({visible, lorebook, onClose, onSaved}: LorebookEditorProps) {
  const st = useTheme();
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [bulk, setBulk] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const keyCounter = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);

  const slide = useSharedValue(300);
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{translateY: slide.value}],
  }));

  const nextKey = () => {
    keyCounter.current += 1;
    return `draft-${Date.now()}-${keyCounter.current}`;
  };

  useEffect(() => {
    if (!visible) {
      slide.value = 300;
      return;
    }
    closingRef.current = false;
    slide.value = withTiming(0, {duration: 250});
    setBulk('');
    setSaving(false);
    if (lorebook) {
      setName(lorebook.fileName);
      setLoading(true);
      setDrafts([]);
      getLorebookEntriesFromDB(lorebook.id)
        .then(entries => {
          setDrafts(entries.map(e => ({key: `entry-${e.id}`, text: e.text})));
        })
        .catch(e => console.warn('Failed to load lorebook entries:', e))
        .finally(() => setLoading(false));
    } else {
      setName('');
      setLoading(false);
      setDrafts([{key: nextKey(), text: ''}]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const updateDraft = (key: string, text: string) => {
    setDrafts(prev => prev.map(d => (d.key === key ? {...d, text} : d)));
  };

  const deleteDraft = (key: string) => {
    setDrafts(prev => prev.filter(d => d.key !== key));
  };

  const moveDraft = (key: string, dir: -1 | 1) => {
    setDrafts(prev => {
      const idx = prev.findIndex(d => d.key === key);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  const handleAddBulk = () => {
    const lines = splitBulkLines(bulk);
    if (lines.length === 0) return;
    setDrafts(prev => [...prev, ...lines.map(text => ({key: nextKey(), text}))]);
    setBulk('');
  };

  const handleClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    Keyboard.dismiss();
    slide.value = withTiming(300, {duration: 200});
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(onClose, 210);
  };

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const handleSave = async () => {
    const trimmedName = name.trim();
    const texts = drafts.map(d => d.text.trim()).filter(t => t.length > 0);
    if (!trimmedName) {
      Alert.alert('Missing name', 'Give this lorebook a name.');
      return;
    }
    if (texts.length === 0) {
      Alert.alert('No entries', 'Add at least one entry.');
      return;
    }
    setSaving(true);
    try {
      const state = buildLorebookState(lorebook?.id ?? generateId(), trimmedName, texts);
      const updated = await saveLorebookState(state);
      if (closingRef.current) return;
      closingRef.current = true;
      Keyboard.dismiss();
      slide.value = withTiming(300, {duration: 200});
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => onSaved(updated, state.id), 210);
    } catch (e) {
      console.warn('Failed to save lorebook:', e);
      Alert.alert('Save failed', 'Could not save the lorebook.');
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={{flex: 1}}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}>
        <View style={st.groupEditorOverlay}>
          <Animated.View style={[st.groupEditorContent, contentStyle]}>
            <View style={st.groupEditorHeader}>
              <Text style={st.groupEditorTitle}>{lorebook ? 'Edit Lorebook' : 'New Lorebook'}</Text>
              <TouchableOpacity onPress={handleClose} style={st.groupEditorCloseBtn}>
                <Text style={st.groupEditorCloseBtnText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={st.groupEditorBody}
              contentContainerStyle={{paddingBottom: 8}}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets>
              <View style={st.groupEditorField}>
                <Text style={st.groupEditorLabel}>Name</Text>
                <TextInput
                  style={st.groupEditorInput}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. World facts"
                  placeholderTextColor={st.textMuted.color}
                />
              </View>

              <View style={st.groupEditorField}>
                <Text style={st.groupEditorLabel}>Entries ({drafts.length})</Text>
                {loading && <Text style={st.lorebookEmptyText}>Loading entries...</Text>}
                {!loading &&
                  drafts.map((d, i) => (
                    <View key={d.key} style={{flexDirection: 'row', marginBottom: 8}}>
                      <TextInput
                        style={[st.groupEditorInput, {flex: 1, minHeight: 44, textAlignVertical: 'top'}]}
                        value={d.text}
                        onChangeText={text => updateDraft(d.key, text)}
                        placeholder={`Fact ${i + 1}`}
                        placeholderTextColor={st.textMuted.color}
                        multiline
                      />
                      <View style={{justifyContent: 'center', marginLeft: 6, gap: 4}}>
                        <TouchableOpacity
                          onPress={() => moveDraft(d.key, -1)}
                          disabled={i === 0}
                          style={{opacity: i === 0 ? 0.3 : 1, padding: 2}}>
                          <Text style={{color: st.textMuted.color, fontSize: 14}}>↑</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => moveDraft(d.key, 1)}
                          disabled={i === drafts.length - 1}
                          style={{opacity: i === drafts.length - 1 ? 0.3 : 1, padding: 2}}>
                          <Text style={{color: st.textMuted.color, fontSize: 14}}>↓</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => deleteDraft(d.key)} style={{padding: 2}}>
                          <Text style={{color: st.dangerText.color, fontSize: 16}}>×</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                {!loading && drafts.length === 0 && (
                  <Text style={st.lorebookEmptyText}>No entries yet.</Text>
                )}
                <TouchableOpacity
                  onPress={() => setDrafts(prev => [...prev, {key: nextKey(), text: ''}])}
                  style={[st.cardActionBtn, {alignSelf: 'flex-start', marginTop: 4}]}>
                  <Text style={st.cardActionBtnText}>+ Add entry</Text>
                </TouchableOpacity>
              </View>

              <View style={st.groupEditorField}>
                <Text style={st.groupEditorLabel}>Bulk add (one fact per line)</Text>
                <TextInput
                  style={[st.groupEditorInput, {minHeight: 60, textAlignVertical: 'top'}]}
                  value={bulk}
                  onChangeText={setBulk}
                  placeholder={'Elf capital is Sylvara\nDragons fear bells'}
                  placeholderTextColor={st.textMuted.color}
                  multiline
                />
                <TouchableOpacity
                  onPress={handleAddBulk}
                  disabled={splitBulkLines(bulk).length === 0}
                  style={[
                    st.cardActionBtn,
                    {alignSelf: 'flex-start', marginTop: 8},
                    splitBulkLines(bulk).length === 0 && {opacity: 0.4},
                  ]}>
                  <Text style={st.cardActionBtnText}>Add lines</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>

            <View style={{paddingHorizontal: 16, paddingTop: 4}}>
              <TouchableOpacity
                onPress={handleSave}
                disabled={!name.trim() || saving}
                style={[st.groupEditorSaveBtn, (!name.trim() || saving) && {opacity: 0.4}]}>
                <Text style={st.groupEditorSaveBtnText}>
                  {saving ? 'Saving...' : lorebook ? 'Save Lorebook' : 'Create Lorebook'}
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

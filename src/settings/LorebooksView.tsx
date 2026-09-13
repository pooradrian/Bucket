import {useState, useCallback} from 'react';
import {Alert, Text, TouchableOpacity, View} from 'react-native';
import {loadLorebook, addLorebook, removeLorebook, LorebookState} from '../RAGHandler';
import {useAppStore} from '../store';
import {PromptConfig} from '../PromptHandler';
import {logEvent} from '../EventLogger';
import {useTheme} from '../ThemeContext';
import {SectionHeader, TextField} from './ui';
import LorebookEditor from '../components/LorebookEditor';

interface LorebooksViewProps {
  promptValues: PromptConfig;
  setPromptValues: React.Dispatch<React.SetStateAction<PromptConfig>>;
}

export default function LorebooksView({
  promptValues,
  setPromptValues,
}: LorebooksViewProps) {
  const st = useTheme();
  const lorebooks = useAppStore(s => s.lorebooks);
  const setLorebooks = useAppStore(s => s.setLorebooks);
  const [lorebookLoading, setLorebookLoading] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingBook, setEditingBook] = useState<LorebookState | null>(null);

  const handleLoadLorebook = useCallback(async () => {
    setLorebookLoading(true);
    try {
      const loaded = await loadLorebook();
      if (loaded) {
        const updated = await addLorebook(loaded);
        setLorebooks(updated);
        logEvent('lorebook_imported', {
          entryCount: loaded.entries.length,
          fileNameLen: loaded.fileName.length,
        });
      }
    } catch (e) {
      console.warn('Failed to load lorebook:', e);
      Alert.alert(
        'Import lorebook',
        'Could not import the selected lorebook file.',
      );
    } finally {
      setLorebookLoading(false);
    }
  }, [setLorebooks]);

  const handleRemoveLorebook = useCallback(
    async (id: string) => {
      const lb = lorebooks.find(l => l.id === id);
      try {
        const updated = await removeLorebook(id);
        setLorebooks(updated);
        if (lb) {
          logEvent('lorebook_removed', {
            entryCount: lb.entryCount,
            fileNameLen: lb.fileName.length,
          });
        }
      } catch (e) {
        console.warn('Failed to remove lorebook:', e);
        Alert.alert('Remove lorebook', 'Could not remove the lorebook.');
      }
    },
    [setLorebooks, lorebooks],
  );

  return (
    <>
      <TouchableOpacity
        style={st.card}
        onPress={() => {
          setEditingBook(null);
          setEditorVisible(true);
        }}
      >
        <Text style={st.cardTitle}>New Lorebook</Text>
        <Text style={st.cardDescription}>
          Create and edit entries in the app
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={st.card}
        onPress={handleLoadLorebook}
        disabled={lorebookLoading}
      >
        <Text style={st.cardTitle}>
          {lorebookLoading ? 'Loading...' : 'Import Lorebook'}
        </Text>
        <Text style={st.cardDescription}>
          Import a .txt file (one fact per line)
        </Text>
      </TouchableOpacity>

      {lorebooks.map(lorebook => (
        <View key={lorebook.id} style={st.settingsLorebookItem}>
          <TouchableOpacity
            style={st.settingsLorebookItemInfo}
            onPress={() => {
              setEditingBook(lorebook);
              setEditorVisible(true);
            }}>
            <Text style={st.settingsLorebookItemName}>{lorebook.fileName}</Text>
            <Text style={st.settingsLorebookItemCount}>
              {lorebook.entryCount} entries · tap to edit
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleRemoveLorebook(lorebook.id)}
            style={st.settingsLorebookRemoveBtn}
          >
            <Text style={st.settingsLorebookRemoveBtnText}>Remove</Text>
          </TouchableOpacity>
        </View>
      ))}

      {lorebooks.length === 0 && (
        <Text style={st.settingsLorebookEmptyText}>
          No lorebooks yet. Create one or import a .txt file.
        </Text>
      )}

      <LorebookEditor
        visible={editorVisible}
        lorebook={editingBook}
        onClose={() => setEditorVisible(false)}
        onSaved={(updated, savedId) => {
          setLorebooks(updated);
          const saved = updated.find(l => l.id === savedId);
          logEvent('lorebook_saved', {
            entryCount: saved?.entryCount ?? 0,
            fileNameLen: saved?.fileName.length ?? 0,
            isNew: editingBook === null,
          });
          setEditorVisible(false);
        }}
      />

      <SectionHeader title="RAG Settings" />

      <TextField
        label="Embedding Model (leave blank to use main model)"
        value={promptValues.ragModel}
        onChangeText={text =>
          setPromptValues(prev => ({...prev, ragModel: text}))
        }
        placeholder="e.g. nomic-embed-text"
      />

      <TextField
        label="Max entries to embed per retrieval"
        value={promptValues.ragMaxEntriesToSend}
        onChangeText={text =>
          setPromptValues(prev => ({...prev, ragMaxEntriesToSend: text}))
        }
        placeholder="50"
        keyboardType="numeric"
      />

      <TextField
        label="Max relevant facts returned"
        value={promptValues.ragMaxResults}
        onChangeText={text =>
          setPromptValues(prev => ({...prev, ragMaxResults: text}))
        }
        placeholder="5"
        keyboardType="numeric"
      />
    </>
  );
}

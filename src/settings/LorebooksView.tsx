import {useState, useCallback} from 'react';
import {Alert, Text, TouchableOpacity, View} from 'react-native';
import {loadLorebook, addLorebook, removeLorebook} from '../RAGHandler';
import {useAppStore} from '../store';
import {PromptConfig} from '../PromptHandler';
import {logEvent} from '../EventLogger';
import {useTheme} from '../ThemeContext';
import {SectionHeader, TextField} from './ui';

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
          <View style={st.settingsLorebookItemInfo}>
            <Text style={st.settingsLorebookItemName}>{lorebook.fileName}</Text>
            <Text style={st.settingsLorebookItemCount}>
              {lorebook.entryCount} entries
            </Text>
          </View>
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
          No lorebooks imported yet.
        </Text>
      )}

      <SectionHeader title="RAG Settings" />

      <TextField
        label="RAG Model (leave blank to use main model)"
        value={promptValues.ragModel}
        onChangeText={text =>
          setPromptValues(prev => ({...prev, ragModel: text}))
        }
        placeholder="e.g. gpt-4o-mini"
      />

      <TextField
        label="Max entries sent to RAG model"
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

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../ThemeContext';
import { logEvent } from '../EventLogger';
import { SectionHeader, MutedNote } from './ui';
import {
  installRuntime,
  isRuntimeInstalled,
  removeRuntime,
} from '../EmbeddingRuntime';
import {
  deleteModel,
  formatBytes,
  importModel,
  listModels,
  LocalModel,
} from '../ModelFiles';
import { testLocalModel } from '../LocalEmbeddings';

const RUNTIME_DOWNLOAD_MB = 6;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface OnDeviceEmbeddingsProps {
  activeModel: string;
  onChangeModel: (name: string) => void;
  accent: string;
}

export default function OnDeviceEmbeddings({
  activeModel,
  onChangeModel,
  accent,
}: OnDeviceEmbeddingsProps) {
  const st = useTheme();
  const [runtimeReady, setRuntimeReady] = useState<boolean | null>(null);
  const [models, setModels] = useState<LocalModel[]>([]);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');

  const refresh = useCallback(async () => {
    const [installed, list] = await Promise.all([
      isRuntimeInstalled(),
      listModels(),
    ]);
    setRuntimeReady(installed);
    setModels(list);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleInstall = useCallback(async () => {
    setBusy('runtime');
    setProgress('0%');
    try {
      await installRuntime(p => {
        const total =
          p.bytesExpected > 0
            ? Math.round((p.bytesWritten / p.bytesExpected) * 100)
            : 0;
        setProgress(`${total}% · file ${p.index + 1}/${p.total}`);
      });
      setRuntimeReady(true);
      logEvent('embedding_runtime_installed', { version: 1 });
    } catch (e) {
      Alert.alert('On-device runtime', message(e));
      await refresh();
    } finally {
      setBusy('');
      setProgress('');
    }
  }, [refresh]);

  const handleRemoveRuntime = useCallback(() => {
    Alert.alert(
      'Remove on-device runtime',
      'On-device embeddings stop working until you install it again. Your model files are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusy('runtime');
            try {
              await removeRuntime();
              setRuntimeReady(false);
            } catch (e) {
              Alert.alert('On-device runtime', message(e));
            } finally {
              setBusy('');
            }
          },
        },
      ],
    );
  }, []);

  const handleImport = useCallback(async () => {
    setBusy('import');
    try {
      const imported = await importModel();
      if (imported) {
        setModels(await listModels());
        onChangeModel(imported.name);
        logEvent('embedding_model_imported', { bytes: imported.bytes });
      }
    } catch (e) {
      Alert.alert('Import model', message(e));
    } finally {
      setBusy('');
    }
  }, [onChangeModel]);

  const handleDelete = useCallback(
    (model: LocalModel) => {
      Alert.alert('Remove model', `Delete ${model.name}?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteModel(model.name);
              if (activeModel === model.name) onChangeModel('');
              setModels(await listModels());
              logEvent('embedding_model_removed', { bytes: model.bytes });
            } catch (e) {
              Alert.alert('Remove model', message(e));
            }
          },
        },
      ]);
    },
    [activeModel, onChangeModel],
  );

  const handleTest = useCallback(async () => {
    if (!activeModel) return;
    setBusy('test');
    try {
      const probe = await testLocalModel(
        activeModel,
        'The quick brown fox jumps over the lazy dog.',
      );
      logEvent('embedding_model_tested', {
        dimensions: probe.dimensions,
        ms: probe.ms,
      });
      Alert.alert(
        'On-device embeddings',
        [
          `${probe.dimensions} dimensions in ${probe.ms} ms`,
          probe.description,
          `context ${probe.contextSize} · pooling ${probe.pooling}`,
        ].join('\n'),
      );
    } catch (e) {
      Alert.alert('On-device embeddings', message(e));
    } finally {
      setBusy('');
    }
  }, [activeModel]);

  return (
    <>
      <SectionHeader title="On-device embedding model" />
      <MutedNote>
        Runs entirely on this device. Import a GGUF embedding model you already
        have (for example nomic-embed-text, bge-small or all-MiniLM).
      </MutedNote>

      {runtimeReady === false && (
        <TouchableOpacity
          style={st.card}
          onPress={handleInstall}
          disabled={busy !== ''}
        >
          <Text style={st.cardTitle}>
            {busy === 'runtime'
              ? `Downloading… ${progress}`
              : `Install runtime (~${RUNTIME_DOWNLOAD_MB} MB)`}
          </Text>
          <Text style={st.cardDescription}>
            Downloads the CPU inference libraries once, from the project's
            GitHub releases
          </Text>
        </TouchableOpacity>
      )}

      {runtimeReady === true && (
        <View style={st.settingsLorebookItem}>
          <View style={st.settingsLorebookItemInfo}>
            <Text style={st.settingsLorebookItemName}>Runtime installed</Text>
            <Text style={st.settingsLorebookItemCount}>
              llama.cpp · CPU
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleRemoveRuntime}
            disabled={busy !== ''}
            style={st.settingsLorebookRemoveBtn}
          >
            <Text style={st.settingsLorebookRemoveBtnText}>Remove</Text>
          </TouchableOpacity>
        </View>
      )}

      {busy === 'test' && <ActivityIndicator color={accent} />}

      {models.map(model => {
        const selected = model.name === activeModel;
        return (
          <View key={model.name} style={st.settingsLorebookItem}>
            <TouchableOpacity
              style={st.settingsLorebookItemInfo}
              onPress={() => onChangeModel(model.name)}
            >
              <Text
                style={[
                  st.settingsLorebookItemName,
                  selected && { color: accent },
                ]}
              >
                {selected ? `✓ ${model.name}` : model.name}
              </Text>
              <Text style={st.settingsLorebookItemCount}>
                {formatBytes(model.bytes)}
                {selected ? ' · in use' : ' · tap to use'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDelete(model)}
              style={st.settingsLorebookRemoveBtn}
            >
              <Text style={st.settingsLorebookRemoveBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>
        );
      })}

      <TouchableOpacity
        style={st.card}
        onPress={handleImport}
        disabled={busy !== ''}
      >
        <Text style={st.cardTitle}>
          {busy === 'import' ? 'Importing…' : 'Import GGUF model'}
        </Text>
        <Text style={st.cardDescription}>
          Pick a .gguf file from storage. It is copied into the app.
        </Text>
      </TouchableOpacity>

      {activeModel !== '' && runtimeReady === true && (
        <TouchableOpacity
          style={st.card}
          onPress={handleTest}
          disabled={busy !== ''}
        >
          <Text style={st.cardTitle}>Test model</Text>
          <Text style={st.cardDescription}>
            Embeds one sample sentence and reports dimensions and speed
          </Text>
        </TouchableOpacity>
      )}

      {models.length === 0 && (
        <Text style={st.settingsLorebookEmptyText}>
          No models imported yet.
        </Text>
      )}
    </>
  );
}

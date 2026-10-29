import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { ChatMessage } from '../useChat';
import type { PromptConfig } from '../PromptHandler';
import {
  BackfillProgress,
  MemorySettings,
  MEMORY_MIN_MESSAGES_FOR_BACKFILL,
  estimateMemoryBackfill,
  runMemoryBackfill,
} from '../Memory';
import { useTheme } from '../ThemeContext';

interface MemoryBackfillModalProps {
  visible: boolean;
  sessionId: string;
  characterName: string;
  scopeId: string;
  messages: ChatMessage[];
  settings: MemorySettings;
  config: PromptConfig;
  accent: string;
  onClose: () => void;
}

const CHUNK_OPTIONS = ['20', '40', '80', '160'];

export default function MemoryBackfillModal({
  visible,
  sessionId,
  characterName,
  scopeId,
  messages,
  settings,
  config,
  accent,
  onClose,
}: MemoryBackfillModalProps) {
  const st = useTheme();
  const [chunkSize, setChunkSize] = useState(
    () => String(Number(settings.backfillChunk) || 40),
  );
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BackfillProgress | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!visible) {
      controllerRef.current?.abort();
      setRunning(false);
      setProgress(null);
      setResult(null);
      setError('');
      setChunkSize(String(Number(settings.backfillChunk) || 40));
    }
  }, [visible, settings.backfillChunk]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const estimate = useMemo(
    () => estimateMemoryBackfill(messages, Number(chunkSize) || 40),
    [messages, chunkSize],
  );

  const start = async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setResult(null);
    setError('');
    try {
      const outcome = await runMemoryBackfill({
        sessionId,
        characterName,
        scopeId,
        messages,
        settings,
        config,
        chunkSize: Number(chunkSize) || 40,
        controller,
        onProgress: setProgress,
      });
      setResult(
        outcome.cancelled
          ? 'Cancelled. Memories saved so far were kept.'
          : `Saved ${outcome.facts} memories from ${outcome.calls} calls.`,
      );
    } catch (e) {
      if (controller.signal.aborted) {
        setResult('Cancelled. Memories saved so far were kept.');
      } else {
        setError(e instanceof Error ? e.message : 'Backfill failed.');
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={running ? () => {} : onClose}
    >
      <View style={st.crashPromptOverlay}>
        <View style={st.crashPromptCard}>
          <ScrollView>
            <Text style={st.crashPromptTitle}>Build long-term memory?</Text>
            <Text style={st.crashPromptMessage}>
              This chat has no long-term memories yet. The conversation has{' '}
              {estimate.messages} messages, which can be processed now so the
              character remembers events from before memory was enabled.
            </Text>
            <Text style={st.crashPromptMessage}>
              ~{estimate.tokens.toLocaleString()} input tokens ·{' '}
              {estimate.calls} model {estimate.calls === 1 ? 'call' : 'calls'}
            </Text>

            <Text style={st.settingsLabel}>Messages per call</Text>
            <View style={st.settingsToggleRow}>
              {CHUNK_OPTIONS.map(option => {
                const active = option === chunkSize;
                return (
                  <TouchableOpacity
                    key={option}
                    disabled={running}
                    style={[
                      st.settingsToggleButton,
                      active && { backgroundColor: accent },
                    ]}
                    onPress={() => setChunkSize(option)}
                  >
                    <Text
                      style={[
                        st.settingsToggleText,
                        active && st.settingsToggleTextActive,
                      ]}
                    >
                      {option}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={st.settingsDefaultText}>
              {MEMORY_MIN_MESSAGES_FOR_BACKFILL}+ messages are processed in
              separate calls; cancelling keeps what was already saved.
            </Text>

            {running && (
              <Text style={st.crashPromptMessage}>
                {progress
                  ? `Chunk ${progress.done}/${progress.total} · ${progress.facts} memories saved`
                  : 'Starting…'}
              </Text>
            )}
            {result && <Text style={st.crashPromptMessage}>{result}</Text>}
            {error ? (
              <Text style={st.crashPromptWarning}>{error}</Text>
            ) : null}

            <View style={st.settingsToggleRow}>
              {running ? (
                <TouchableOpacity
                  style={st.settingsToggleButton}
                  onPress={() => controllerRef.current?.abort()}
                >
                  <Text style={st.settingsToggleText}>Cancel</Text>
                </TouchableOpacity>
              ) : result ? (
                <TouchableOpacity
                  style={[st.settingsToggleButton, { backgroundColor: accent }]}
                  onPress={onClose}
                >
                  <Text
                    style={[
                      st.settingsToggleText,
                      st.settingsToggleTextActive,
                    ]}
                  >
                    Close
                  </Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    style={[st.settingsToggleButton, { backgroundColor: accent }]}
                    onPress={start}
                  >
                    <Text
                      style={[
                        st.settingsToggleText,
                        st.settingsToggleTextActive,
                      ]}
                    >
                      Start
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={st.settingsToggleButton}
                    onPress={onClose}
                  >
                    <Text style={st.settingsToggleText}>Not now</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

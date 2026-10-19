import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../ThemeContext';
import { stopGeneration, useGenerationStore } from '../GenerationEngine';

export default function GenerationBanner({
  excludeSessionId,
  onOpen,
}: {
  excludeSessionId?: string | null;
  onOpen?: (sessionId: string) => void;
}) {
  const st = useTheme();
  const runs = useGenerationStore(s => s.runs);
  const visible = Object.values(runs)
    .filter(run => run.sessionId !== excludeSessionId)
    .sort((a, b) => a.startedAt - b.startedAt);

  if (visible.length === 0) {
    return null;
  }

  return (
    <View style={st.generationBar}>
      {visible.map((run, index) => (
        <View
          key={run.sessionId}
          style={[st.generationRow, index > 0 && st.generationRowDivider]}
        >
          <TouchableOpacity
            style={st.generationInfo}
            activeOpacity={onOpen ? 0.6 : 1}
            disabled={!onOpen}
            onPress={() => onOpen?.(run.sessionId)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator
                size="small"
                color={st.textMuted.color}
                style={{ marginRight: 8 }}
              />
              <Text style={st.generationLabel} numberOfLines={1}>
                {run.label} is replying…
              </Text>
            </View>
            <Text style={st.generationMeta}>
              {run.content.length > 0
                ? `${run.content.length} chars`
                : 'Waiting for response…'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={st.generationStopBtn}
            onPress={() => stopGeneration(run.sessionId)}
          >
            <Text style={st.generationStopText}>Stop</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

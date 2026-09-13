import {useState} from 'react';
import {Alert, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {
  ModelPreset,
  PromptConfig,
  addModelPreset,
  updateModelPreset,
  deleteModelPreset,
  applyModelPreset,
} from '../PromptHandler';
import {useTheme} from '../ThemeContext';
import {AutoGrowTextInput} from './ui';

interface ModelPresetsViewProps {
  promptValues: PromptConfig;
  setPromptValues: React.Dispatch<React.SetStateAction<PromptConfig>>;
  accent: string;
}

export default function ModelPresetsView({
  promptValues,
  setPromptValues,
  accent,
}: ModelPresetsViewProps) {
  const st = useTheme();
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const presets = promptValues.modelPresets ?? [];

  return (
    <View style={st.settingsField}>
      <Text style={st.settingsLabel}>Model Presets</Text>
      <Text style={[st.settingsDefaultText, {marginBottom: 10}]}>
        Each preset stores system instructions and temperature for one exact model name.
        Matching presets apply automatically when you change the model; tap one to switch manually.
      </Text>

      {presets.map((preset, idx) => {
        const isActive = promptValues.activeModelPresetId === preset.id;
        const isEditing = editingIdx === idx;
        return (
          <View key={preset.id} style={{marginBottom: 10}}>
            <TouchableOpacity
              style={[
                st.settingsToggleButton,
                {
                  backgroundColor: isActive ? accent : 'transparent',
                  padding: 14,
                  alignItems: 'flex-start',
                },
              ]}
              onPress={() => setEditingIdx(isEditing ? null : idx)}
            >
              <Text
                style={[
                  st.settingsToggleText,
                  {fontWeight: '600'},
                  isActive && st.settingsToggleTextActive,
                ]}
              >
                {preset.model || '(unnamed model)'}
                {isActive ? ' · active' : ''}
              </Text>
              {!isEditing && (
                <Text
                  style={{color: isActive ? st.settingsToggleTextActive.color : st.textMuted.color, fontSize: 12, marginTop: 2}}
                  numberOfLines={1}
                >
                  {preset.prefix || '(no instructions)'}
                </Text>
              )}
            </TouchableOpacity>

            {isEditing && (
              <View style={[st.card, {marginTop: 4, marginBottom: 0}]}>
                <Text style={st.settingsLabel}>Model (exact name)</Text>
                <TextInput
                  style={[st.settingsInput, {marginBottom: 8}]}
                  value={preset.model}
                  onChangeText={text => {
                    setPromptValues(prev => updateModelPreset(prev, idx, {model: text}));
                  }}
                  placeholder="e.g. gpt-4o"
                  placeholderTextColor={st.textMuted.color}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={st.settingsLabel}>Prefix</Text>
                <AutoGrowTextInput
                  style={[st.settingsInput, {marginBottom: 8}]}
                  value={preset.prefix}
                  onChangeText={text => {
                    setPromptValues(prev => updateModelPreset(prev, idx, {prefix: text}));
                  }}
                  placeholder="System instructions for this model"
                  placeholderTextColor={st.textMuted.color}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={st.settingsLabel}>Suffix</Text>
                <AutoGrowTextInput
                  style={[st.settingsInput, {marginBottom: 8}]}
                  value={preset.suffix}
                  onChangeText={text => {
                    setPromptValues(prev => updateModelPreset(prev, idx, {suffix: text}));
                  }}
                  placeholder="End of system message"
                  placeholderTextColor={st.textMuted.color}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={st.settingsLabel}>Temperature</Text>
                <TextInput
                  style={[st.settingsInput, {marginBottom: 8}]}
                  value={preset.temperature}
                  onChangeText={text => {
                    setPromptValues(prev => updateModelPreset(prev, idx, {temperature: text}));
                  }}
                  placeholder="1"
                  placeholderTextColor={st.textMuted.color}
                  keyboardType="decimal-pad"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    marginTop: 4,
                  }}
                >
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert(
                        'Delete preset',
                        `Delete instructions for "${preset.model}"?`,
                        [
                          {text: 'Cancel', style: 'cancel'},
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => {
                              setPromptValues(prev => deleteModelPreset(prev, idx));
                              setEditingIdx(null);
                            },
                          },
                        ],
                      );
                    }}
                  >
                    <Text style={{color: st.dangerText.color, fontSize: 13}}>Delete</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setPromptValues(prev => applyModelPreset(prev, idx));
                      setEditingIdx(null);
                    }}
                  >
                    <Text style={{color: accent, fontSize: 13, fontWeight: '600'}}>
                      {isActive ? 'Active' : 'Use these instructions'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        );
      })}

      <TouchableOpacity
        onPress={() => {
          const id =
            Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const preset: ModelPreset = {
            id,
            model: promptValues.model,
            prefix: promptValues.prefix,
            suffix: promptValues.suffix,
            temperature: promptValues.temperature,
          };
          setPromptValues(prev => addModelPreset(prev, preset));
          setEditingIdx(presets.length);
        }}
        style={[st.settingsToggleButton, {borderStyle: 'dashed', marginTop: 4}]}
      >
        <Text style={st.settingsToggleText}>+ Add preset from current settings</Text>
      </TouchableOpacity>
    </View>
  );
}

import {Text, TouchableOpacity, View} from 'react-native';
import {PromptConfig, DEFAULT_PROMPT_CONFIG, PLACEHOLDERS} from '../PromptHandler';
import {useTheme} from '../ThemeContext';
import {
  AutoGrowTextInput,
  OptionRow,
  SectionHeader,
  TextField,
} from './ui';

interface PromptViewProps {
  promptValues: PromptConfig;
  setPromptValues: React.Dispatch<React.SetStateAction<PromptConfig>>;
  accent: string;
}

export default function PromptView({
  promptValues,
  setPromptValues,
  accent,
}: PromptViewProps) {
  const st = useTheme();
  return (
    <>
      <SectionHeader title="System Prompt" />
      <View style={st.settingsField}>
        <Text style={st.settingsLabel}>Prefix (start of system message)</Text>
        <AutoGrowTextInput
          style={st.settingsInput}
          value={promptValues.prefix}
          onChangeText={text =>
            setPromptValues(prev => ({...prev, prefix: text}))
          }
          placeholder={DEFAULT_PROMPT_CONFIG.prefix}
          placeholderTextColor={st.textMuted.color}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          onPress={() =>
            setPromptValues(prev => ({
              ...prev,
              prefix: DEFAULT_PROMPT_CONFIG.prefix,
            }))
          }
        >
          <Text style={st.settingsDefaultText}>reset to default</Text>
        </TouchableOpacity>
      </View>

      <View style={st.settingsField}>
        <Text style={st.settingsLabel}>Suffix (end of system message)</Text>
        <AutoGrowTextInput
          style={st.settingsInput}
          value={promptValues.suffix}
          onChangeText={text =>
            setPromptValues(prev => ({...prev, suffix: text}))
          }
          placeholder={DEFAULT_PROMPT_CONFIG.suffix}
          placeholderTextColor={st.textMuted.color}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          onPress={() =>
            setPromptValues(prev => ({
              ...prev,
              suffix: DEFAULT_PROMPT_CONFIG.suffix,
            }))
          }
        >
          <Text style={st.settingsDefaultText}>reset to default</Text>
        </TouchableOpacity>
      </View>

      <View style={st.settingsField}>
        <Text style={st.settingsLabel}>Available Placeholders</Text>
        <View style={st.settingsPlaceholderList}>
          {PLACEHOLDERS.map(p => (
            <View key={p.key} style={st.settingsPlaceholderRow}>
              <Text style={st.settingsPlaceholderKey}>{p.key}</Text>
              <Text style={st.settingsPlaceholderDesc}>{p.description}</Text>
            </View>
          ))}
        </View>
      </View>

      <SectionHeader title="History Cutoff" />

      <OptionRow
        label="Cutoff Mode"
        options={[
          {value: 'messages', label: 'Messages'},
          {value: 'tokens', label: 'Tokens'},
        ]}
        value={promptValues.historyCutoffMode}
        accent={accent}
        onChange={historyCutoffMode =>
          setPromptValues(prev => ({...prev, historyCutoffMode}))
        }
      />

      <TextField
        label={
          promptValues.historyCutoffMode === 'messages'
            ? 'Max Messages'
            : 'Max Estimated Tokens'
        }
        value={promptValues.historyCutoffAmount}
        onChangeText={text =>
          setPromptValues(prev => ({...prev, historyCutoffAmount: text}))
        }
        placeholder={DEFAULT_PROMPT_CONFIG.historyCutoffAmount}
        keyboardType="numeric"
      />

      <SectionHeader title="Chat Summarization" />

      <OptionRow
        label="Enable Summarization"
        options={[
          {value: 'on', label: 'On'},
          {value: 'off', label: 'Off'},
        ]}
        value={promptValues.summarizationEnabled ? 'on' : 'off'}
        accent={accent}
        onChange={v =>
          setPromptValues(prev => ({
            ...prev,
            summarizationEnabled: v === 'on',
          }))
        }
      />

      {promptValues.summarizationEnabled && (
        <>
          <TextField
            label="Token Threshold"
            value={promptValues.summarizationTokenThreshold}
            onChangeText={text =>
              setPromptValues(prev => ({
                ...prev,
                summarizationTokenThreshold: text,
              }))
            }
            placeholder={DEFAULT_PROMPT_CONFIG.summarizationTokenThreshold}
            keyboardType="numeric"
          />

          <TextField
            label="Max Summaries"
            value={promptValues.summarizationMaxSummaries}
            onChangeText={text =>
              setPromptValues(prev => ({
                ...prev,
                summarizationMaxSummaries: text,
              }))
            }
            placeholder={DEFAULT_PROMPT_CONFIG.summarizationMaxSummaries}
            keyboardType="numeric"
          />

          <TextField
            label="Summarization Model"
            value={promptValues.summarizationModel}
            onChangeText={text =>
              setPromptValues(prev => ({
                ...prev,
                summarizationModel: text,
              }))
            }
            placeholder={
              DEFAULT_PROMPT_CONFIG.summarizationModel || 'Uses main model'
            }
          />
        </>
      )}
    </>
  );
}

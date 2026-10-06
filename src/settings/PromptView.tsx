import {Text, TouchableOpacity, View} from 'react-native';
import {PromptConfig, DEFAULT_PROMPT_CONFIG, PLACEHOLDERS, detachModelPreset} from '../PromptHandler';
import {useTheme} from '../ThemeContext';
import {
  AutoGrowTextInput,
  MutedNote,
  OptionRow,
  SectionHeader,
  TextField,
} from './ui';
import ModelPresetsView from './ModelPresetsView';

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
  const activePreset =
    promptValues.modelPresets?.find(p => p.id === promptValues.activeModelPresetId) ?? null;
  return (
    <>
      <SectionHeader title="Model Presets" />
      <ModelPresetsView
        promptValues={promptValues}
        setPromptValues={setPromptValues}
        accent={accent}
      />

      <SectionHeader title="System Prompt" />
      {activePreset ? (
        <View style={st.settingsField}>
          <MutedNote>
            {`Controlled by the "${activePreset.model}" preset. Edit it above to change these instructions.`}
          </MutedNote>
        </View>
      ) : (
      <>
      <View style={st.settingsField}>
        <Text style={st.settingsLabel}>Prefix (start of system message)</Text>
        <MutedNote>
          {'Nothing is added to this unless you ask for it. No character block, no persona, no lorebook unless the placeholders below pull them in.'}
        </MutedNote>
        <AutoGrowTextInput
          style={st.settingsInput}
          value={promptValues.prefix}
          onChangeText={text =>
            setPromptValues(prev => detachModelPreset(prev, {prefix: text}))
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
        <MutedNote>
          {'Always appended after the prefix. Placeholders work here too.'}
        </MutedNote>
        <AutoGrowTextInput
          style={st.settingsInput}
          value={promptValues.suffix}
          onChangeText={text =>
            setPromptValues(prev => detachModelPreset(prev, {suffix: text}))
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
      </>
      )}

      <View style={st.settingsField}>
        <Text style={st.settingsLabel}>Quick Character System Prompt</Text>
        <MutedNote>
          {'Used instead of the prefix when you send a message as a quick character. Nothing is added unless you ask for it: $CHAR… placeholders describe the base character, $QUICKCHAR… placeholders describe the quick character you picked, so the two are never glued together. With no quick character selected the $QUICKCHAR… fields fall back to the character you are chatting with, and $QUICKCHARBLOCK$ is empty.'}
        </MutedNote>
        <AutoGrowTextInput
          style={st.settingsInput}
          value={promptValues.quickCharacterPrompt}
          onChangeText={text =>
            setPromptValues(prev => ({...prev, quickCharacterPrompt: text}))
          }
          placeholder={DEFAULT_PROMPT_CONFIG.quickCharacterPrompt}
          placeholderTextColor={st.textMuted.color}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          onPress={() =>
            setPromptValues(prev => ({
              ...prev,
              quickCharacterPrompt: DEFAULT_PROMPT_CONFIG.quickCharacterPrompt,
            }))
          }
        >
          <Text style={st.settingsDefaultText}>reset to default</Text>
        </TouchableOpacity>
      </View>

      <View style={st.settingsField}>
        <Text style={st.settingsLabel}>Available Placeholders</Text>
        <View style={st.settingsPlaceholderList}>
          {PLACEHOLDERS.map((p, i) => (
            <View key={p.key}>
              {i === 0 || PLACEHOLDERS[i - 1].group !== p.group ? (
                <Text style={st.settingsPlaceholderGroup}>{p.group}</Text>
              ) : null}
              <View style={st.settingsPlaceholderRow}>
                <Text style={st.settingsPlaceholderKey}>{p.key}</Text>
                <Text style={st.settingsPlaceholderDesc}>{p.description}</Text>
              </View>
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

      <SectionHeader title="Word Displacement" />
      <View style={st.settingsField}>
        <MutedNote>
          {'Rewrites replies as they generate, one rule per line: a bare word is deleted · "w =>" becomes a space · "w => new" replaces · "w => a ~ b" picks randomly · "a <=> b" swaps. // starts a comment.'}
        </MutedNote>
        <AutoGrowTextInput
          style={st.settingsInput}
          value={promptValues.wordDisplacements}
          onChangeText={text =>
            setPromptValues(prev => ({...prev, wordDisplacements: text}))
          }
          placeholder={
            'word1\nword2 =>\nword3 => word4\nword5 => word6 ~ word7\nword8 <=> word9'
          }
          placeholderTextColor={st.textMuted.color}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
    </>
  );
}

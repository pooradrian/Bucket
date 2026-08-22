import {useState} from 'react';
import {Alert, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {
  Persona,
  PromptConfig,
  addPersona,
  updatePersona,
  deletePersona,
  activatePersona,
} from '../PromptHandler';
import {useTheme} from '../ThemeContext';
import {Settings} from '../settingsDraft';

interface PersonasViewProps {
  values: Settings;
  promptValues: PromptConfig;
  setPromptValues: React.Dispatch<React.SetStateAction<PromptConfig>>;
  promptLoaded: boolean;
}

export default function PersonasView({
  values,
  promptValues,
  setPromptValues,
  promptLoaded,
}: PersonasViewProps) {
  const st = useTheme();
  const [editingPersonaIdx, setEditingPersonaIdx] = useState<number | null>(
    null,
  );
  const accent = values.accentColor;

  return (
    <View style={st.settingsField}>
      <Text style={st.settingsLabel}>User Personas</Text>
      <Text style={[st.settingsDefaultText, {marginBottom: 10}]}>
        Create persona profiles to quickly switch your user description.
      </Text>

      {(promptValues.personas ?? []).map((persona, idx) => {
        const isActive = promptValues.activePersonaId === persona.id;
        const isEditing = editingPersonaIdx === idx;
        return (
          <View key={persona.id} style={{marginBottom: 10}}>
            <TouchableOpacity
              style={[
                st.settingsToggleButton,
                {
                  backgroundColor: isActive ? accent : 'transparent',
                  padding: 14,
                  alignItems: 'flex-start',
                },
              ]}
              onPress={() => {
                if (isEditing) {
                  setEditingPersonaIdx(null);
                  return;
                }
                setEditingPersonaIdx(idx);
              }}
            >
              <Text
                style={[
                  st.settingsToggleText,
                  {
                    color: isActive ? values.bgPrimary : accent,
                    fontWeight: '600',
                  },
                ]}
              >
                {persona.name}
              </Text>
              {!isEditing && (
                <Text
                  style={{
                    color: isActive ? values.bgSecondary : st.textMuted.color,
                    fontSize: 12,
                    marginTop: 2,
                  }}
                  numberOfLines={1}
                >
                  {persona.description || '(no description)'}
                </Text>
              )}
            </TouchableOpacity>

            {isEditing && (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: accent,
                  borderRadius: Number(values.cardRadius) || 8,
                  padding: 12,
                  marginTop: 4,
                }}
              >
                <TextInput
                  style={[
                    st.settingsInput,
                    {
                      marginBottom: 8,
                      borderColor: 'transparent',
                      padding: 8,
                    },
                  ]}
                  value={persona.name}
                  onChangeText={text => {
                    setPromptValues(prev =>
                      updatePersona(prev, idx, {name: text}),
                    );
                  }}
                  placeholder="Persona name"
                  placeholderTextColor={st.textMuted.color}
                />
                <TextInput
                  style={[
                    st.settingsInput,
                    st.settingsInputMultiline,
                    {
                      borderColor: 'transparent',
                      padding: 8,
                      minHeight: 80,
                    },
                  ]}
                  value={persona.description}
                  onChangeText={text => {
                    setPromptValues(prev =>
                      updatePersona(prev, idx, {description: text}),
                    );
                  }}
                  placeholder="Describe yourself for the AI"
                  placeholderTextColor={st.textMuted.color}
                  multiline
                  blurOnSubmit={false}
                  returnKeyType="default"
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
                        'Delete persona',
                        `Delete "${persona.name}"?`,
                        [
                          {text: 'Cancel', style: 'cancel'},
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => {
                              setPromptValues(prev =>
                                deletePersona(prev, idx),
                              );
                              setEditingPersonaIdx(null);
                            },
                          },
                        ],
                      );
                    }}
                  >
                    <Text style={{color: '#cc3333', fontSize: 13}}>Delete</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setPromptValues(prev => activatePersona(prev, idx));
                      setEditingPersonaIdx(null);
                    }}
                  >
                    <Text
                      style={{
                        color: accent,
                        fontSize: 13,
                        fontWeight: '600',
                      }}
                    >
                      {isActive ? 'Active' : 'Use this persona'}
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
          const newPersona: Persona = {
            id,
            name: 'New Persona',
            description: '',
          };
          setPromptValues(prev => addPersona(prev, newPersona));
          setEditingPersonaIdx((promptValues.personas ?? []).length);
        }}
        disabled={!promptLoaded}
        style={[st.settingsToggleButton, {borderStyle: 'dashed', marginTop: 4}]}
      >
        <Text style={st.settingsToggleText}>
          {promptLoaded ? '+ Add Persona' : 'Loading personas...'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

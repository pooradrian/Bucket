import {
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';
import {useTheme} from '../ThemeContext';
import AutoGrowTextInput from '../components/AutoGrowTextInput';

export {AutoGrowTextInput};

export function SectionHeader({title}: {title: string}) {
  const st = useTheme();
  return (
    <View style={st.settingsSectionHeader}>
      <Text style={st.settingsSectionHeaderText}>{title}</Text>
    </View>
  );
}

export function MutedNote({children}: {children: React.ReactNode}) {
  const st = useTheme();
  return (
    <Text style={{fontSize: 12, color: st.textMuted.color, marginBottom: 8}}>
      {children}
    </Text>
  );
}

export function BoolToggle({
  label,
  note,
  value,
  accent,
  onChange,
}: {
  label: string;
  note?: string;
  value: boolean;
  accent: string;
  onChange: (next: boolean) => void;
}) {
  const st = useTheme();
  return (
    <View style={st.settingsField}>
      <Text style={st.settingsLabel}>{label}</Text>
      {note ? <MutedNote>{note}</MutedNote> : null}
      <View style={st.settingsToggleRow}>
        <TouchableOpacity
          style={[
            st.settingsToggleButton,
            value && {backgroundColor: accent},
          ]}
          onPress={() => onChange(!value)}
        >
          <Text
            style={[st.settingsToggleText, value && st.settingsToggleTextActive]}
          >
            {value ? 'On' : 'Off'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function OptionRow<T extends string>({
  label,
  note,
  options,
  value,
  accent,
  onChange,
}: {
  label?: string;
  note?: string;
  options: {value: T; label: string}[];
  value: T;
  accent: string;
  onChange: (v: T) => void;
}) {
  const st = useTheme();
  return (
    <View style={st.settingsField}>
      {label ? <Text style={st.settingsLabel}>{label}</Text> : null}
      {note ? <MutedNote>{note}</MutedNote> : null}
      <View style={st.settingsToggleRow}>
        {options.map(o => {
          const active = o.value === value;
          return (
            <TouchableOpacity
              key={o.value}
              style={[
                st.settingsToggleButton,
                active && {backgroundColor: accent},
              ]}
              onPress={() => onChange(o.value)}
            >
              <Text
                style={[
                  st.settingsToggleText,
                  active && st.settingsToggleTextActive,
                ]}
              >
                {o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export function TextField({
  label,
  note,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  resetTo,
}: {
  label: string;
  note?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: TextInputProps['keyboardType'];
  resetTo?: string;
}) {
  const st = useTheme();
  return (
    <View style={st.settingsField}>
      <Text style={st.settingsLabel}>{label}</Text>
      {note ? <MutedNote>{note}</MutedNote> : null}
      <TextInput
        style={st.settingsInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={st.textMuted.color}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {resetTo !== undefined && (
        <TouchableOpacity onPress={() => onChangeText(resetTo)}>
          <Text style={st.settingsDefaultText}>default value: {resetTo}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

import {Text, TouchableOpacity} from 'react-native';
import {useAppStore} from '../store';
import {useTheme} from '../ThemeContext';
import {BoolToggle} from './ui';

interface DeveloperViewProps {
  accent: string;
  onOpenDebugger?: () => void;
}

export default function DeveloperView({accent, onOpenDebugger}: DeveloperViewProps) {
  const st = useTheme();
  const appSettings = useAppStore(s => s.appSettings);
  const toggleDebugLogging = useAppStore(s => s.toggleDebugLogging);

  return (
    <>
      <BoolToggle
        label="Activity logging"
        note="Logs user actions (no personal data). View in the debugger with the 'activity' command."
        value={appSettings.debugLogging}
        accent={accent}
        onChange={() => toggleDebugLogging()}
      />

      <TouchableOpacity style={st.card} onPress={onOpenDebugger}>
        <Text style={st.cardTitle}>Open Debugger</Text>
        <Text style={st.cardDescription}>
          CLI for testing prompts, API calls, and storage
        </Text>
      </TouchableOpacity>
    </>
  );
}

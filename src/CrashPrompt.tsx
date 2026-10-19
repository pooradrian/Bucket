import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { CrashReport, crashExport, getCrashLogText } from './CrashExport';
import { useAppStore } from './store';
import { useTheme } from './ThemeContext';

interface CrashPromptProps {
  report: CrashReport | null;
  onDismiss: () => void;
}

export default function CrashPrompt({ report, onDismiss }: CrashPromptProps) {
  const st = useTheme();
  const activityLogging = useAppStore(s => s.appSettings.debugLogging);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!report) setExporting(false);
  }, [report]);

  const handleCopy = async () => {
    if (!report) return;
    try {
      Clipboard.setString(await getCrashLogText(report));
      Alert.alert('Copied', 'Crash log copied to clipboard.');
    } catch {
      Alert.alert('Copy failed', 'Could not copy the crash log.');
    }
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const path = await crashExport();
      if (!path) {
        Alert.alert('Export failed', 'Could not create the backup.');
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      visible={report !== null}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View style={st.crashPromptOverlay}>
        <View style={st.crashPromptCard}>
          <Text style={st.crashPromptTitle}>
            {report?.kind === 'roadblock'
              ? 'Startup problem'
              : 'Bucket crashed'}
          </Text>
          <Text style={st.crashPromptMessage}>
            {report?.kind === 'roadblock'
              ? 'Something went wrong while Bucket was starting. Copy the log or export a full backup of your data.'
              : 'Bucket closed unexpectedly last time. Copy the log or export a full backup of your data.'}
          </Text>
          {activityLogging ? (
            <Text style={st.crashPromptWarning}>
              Activity logging is on: the copied log and full export include
              your recent activity. Review before sharing.
            </Text>
          ) : null}
          <ScrollView style={st.crashPromptLog}>
            <Text style={st.crashPromptLogText} selectable>
              {report
                ? `${report.errorName}: ${report.errorMessage}` +
                  (report.errorStack ? `\n\n${report.errorStack}` : '')
                : ''}
            </Text>
          </ScrollView>
          <TouchableOpacity
            onPress={handleCopy}
            style={st.crashPromptPrimaryBtn}
          >
            <Text style={st.crashPromptPrimaryBtnText}>
              Copy log to clipboard
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleExport}
            disabled={exporting}
            style={[st.crashPromptSecondaryBtn, exporting && { opacity: 0.5 }]}
          >
            <Text style={st.crashPromptSecondaryBtnText}>
              {exporting ? 'Exporting...' : 'Full export'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss} style={st.crashPromptDismiss}>
            <Text style={st.crashPromptDismissText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

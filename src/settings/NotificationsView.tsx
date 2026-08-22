import {useCallback, useMemo} from 'react';
import {Alert, Text, TouchableOpacity, View} from 'react-native';
import {useAppStore} from '../store';
import {playNotificationSound} from '../NotificationModule';
import {pick, types, keepLocalCopy} from '@react-native-documents/picker';
import {LABELS} from '../settingsDraft';
import {useTheme} from '../ThemeContext';
import {MutedNote, OptionRow} from './ui';

export default function NotificationsView({accent}: {accent: string}) {
  const st = useTheme();
  const appSettings = useAppStore(s => s.appSettings);
  const setAppSettings = useAppStore(s => s.setAppSettings);

  const handlePickSound = useCallback(async () => {
    try {
      const result = await pick({
        type: [types.audio],
      });
      if (!result || result.length === 0) return;
      const file = result[0];
      if (file.hasRequestedType === false) {
        Alert.alert('Sound Error', 'Please choose an audio file.');
        return;
      }
      const ext = file.name?.match(/\.(\w+)$/)?.[1]?.toLowerCase() || 'm4a';
      const copies = await keepLocalCopy({
        files: [{uri: file.uri, fileName: `notification_sound.${ext}`}],
        destination: 'documentDirectory',
      });
      const copy = copies[0];
      if (copy.status !== 'success' || !copy.localUri) {
        Alert.alert('Sound Error', 'Could not copy the chosen file.');
        return;
      }
      setAppSettings({...appSettings, notificationSound: copy.localUri});
      playNotificationSound(copy.localUri);
    } catch (e: unknown) {
      if (
        e &&
        typeof e === 'object' &&
        'code' in e &&
        (e as {code: string}).code === 'OPERATION_CANCELED'
      ) {
        return;
      }
      Alert.alert(
        'Sound Error',
        'Could not use that file as a notification sound.',
      );
    }
  }, [appSettings, setAppSettings]);

  const handleResetSound = useCallback(() => {
    setAppSettings({...appSettings, notificationSound: ''});
  }, [appSettings, setAppSettings]);

  const currentSoundName = useMemo(() => {
    if (!appSettings.notificationSound) return 'System default';
    const name = appSettings.notificationSound.split('/').pop() || '';
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  }, [appSettings.notificationSound]);

  return (
    <>
      <OptionRow
        label="Chat completion alert"
        note="Notify when a message finishes generating."
        options={[
          {value: 'off', label: 'Off'},
          {value: 'vibrate', label: 'Vibrate'},
          {value: 'sound', label: 'Sound'},
          {value: 'both', label: 'Both'},
        ]}
        value={appSettings.notificationMode}
        accent={accent}
        onChange={notificationMode =>
          setAppSettings({...appSettings, notificationMode})
        }
      />

      <View style={st.settingsField}>
        <Text style={st.settingsLabel}>{LABELS.notificationSound}</Text>
        <MutedNote>
          Sound played when a message finishes generating.
        </MutedNote>
        <Text style={st.settingsDefaultText}>Current: {currentSoundName}</Text>
        <View style={{flexDirection: 'row', gap: 8, marginTop: 8}}>
          <TouchableOpacity
            style={st.settingsToggleButton}
            onPress={handlePickSound}
          >
            <Text style={st.settingsToggleText}>Choose sound file...</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              st.settingsToggleButton,
              {flex: 0},
              !appSettings.notificationSound && {opacity: 0.4},
            ]}
            onPress={() =>
              playNotificationSound(appSettings.notificationSound || null)
            }
            disabled={!appSettings.notificationSound}
          >
            <Text style={st.settingsToggleText}>Test</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              st.settingsToggleButton,
              {flex: 0},
              !appSettings.notificationSound && {opacity: 0.4},
            ]}
            onPress={handleResetSound}
            disabled={!appSettings.notificationSound}
          >
            <Text style={st.settingsToggleText}>Default</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
}

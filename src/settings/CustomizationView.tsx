import { useAppStore } from '../store';
import { setIcon } from '../IconModule';
import {
  encodeThemeURL,
  decodeThemeURL,
  applyThemeToSettings,
} from '../themeShare';
import Clipboard from '@react-native-clipboard/clipboard';
import { Alert, Share, Text, TouchableOpacity, View } from 'react-native';
import { logEvent } from '../EventLogger';
import {
  Settings,
  LABELS,
  COLOR_KEYS,
  SIZE_KEYS,
  FONT_KEYS,
} from '../settingsDraft';
import { useCallback } from 'react';
import { useTheme } from '../ThemeContext';
import {
  BoolToggle,
  OptionRow,
  SectionHeader,
  TextField,
  MutedNote,
} from './ui';

export type CustomizationSection =
  | 'theme'
  | 'colors'
  | 'sizes'
  | 'fonts'
  | 'display';

interface CustomizationViewProps {
  section: CustomizationSection;
  values: Settings;
  defaults: Settings;
  handleChange: (key: keyof Settings, text: string) => void;
}

export default function CustomizationView({
  section,
  values,
  defaults,
  handleChange,
}: CustomizationViewProps) {
  const st = useTheme();
  const appSettings = useAppStore(s => s.appSettings);
  const setAppSettings = useAppStore(s => s.setAppSettings);
  const applyThemeMode = useAppStore(s => s.applyThemeMode);

  const handleShareTheme = useCallback(async () => {
    const url = encodeThemeURL(appSettings);
    Clipboard.setString(url);
    logEvent('theme_shared', {});
    try {
      await Share.share({ message: url });
    } catch {
      Alert.alert('Theme copied', 'Share URL copied to clipboard.');
    }
  }, [appSettings]);

  const handleImportTheme = useCallback(async () => {
    try {
      const clip = await Clipboard.getString();
      const theme = decodeThemeURL(clip);
      if (!theme) {
        Alert.alert(
          'Import theme',
          'No valid Bucket theme URL found on the clipboard. Copy a shared theme URL first.',
        );
        return;
      }
      const updated = applyThemeToSettings(appSettings, theme);
      setAppSettings(updated);
      if (updated.dynamicIcon) {
        setIcon(updated.themeMode);
      }
      logEvent('theme_imported', { themeName: theme.name || '' });
      Alert.alert(
        'Theme imported',
        theme.name ? `Applied "${theme.name}".` : 'Theme applied.',
      );
    } catch (e) {
      console.warn('Failed to import theme:', e);
      Alert.alert(
        'Import theme',
        'Could not read a valid theme from the clipboard.',
      );
    }
  }, [appSettings, setAppSettings]);

  if (section === 'theme') {
    return (
      <>
        <OptionRow
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
          value={appSettings.themeMode}
          accent={appSettings.accentColor}
          onChange={mode => {
            applyThemeMode(mode);
            if (appSettings.dynamicIcon) {
              setIcon(mode);
            }
          }}
        />

        <BoolToggle
          label="Match icon to theme"
          value={values.dynamicIcon === 'true'}
          accent={values.accentColor}
          onChange={next => {
            handleChange('dynamicIcon', next ? 'true' : 'false');
            if (next) {
              setIcon(values.themeMode);
            }
          }}
        />

        <SectionHeader title="Share" />

        <View style={st.settingsField}>
          <Text style={st.settingsLabel}>Shareable theme</Text>
          <MutedNote>
            Encode the current colors into a URL you can send to someone else.
          </MutedNote>
          <View style={st.settingsToggleRow}>
            <TouchableOpacity
              style={[
                st.settingsToggleButton,
                { backgroundColor: appSettings.accentColor },
              ]}
              onPress={handleShareTheme}
            >
              <Text style={[st.settingsToggleText, st.settingsToggleTextActive]}>
                Share
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={st.settingsToggleButton}
              onPress={handleImportTheme}
            >
              <Text style={st.settingsToggleText}>Import from clipboard</Text>
            </TouchableOpacity>
          </View>
        </View>
      </>
    );
  }

  if (section === 'colors') {
    return (
      <>
        {COLOR_KEYS.map(key => (
          <TextField
            key={key}
            label={LABELS[key]}
            value={values[key]}
            onChangeText={text => handleChange(key, text)}
            placeholder={defaults[key]}
            resetTo={defaults[key]}
          />
        ))}
      </>
    );
  }

  if (section === 'sizes') {
    return (
      <>
        {SIZE_KEYS.map(key => (
          <TextField
            key={key}
            label={LABELS[key]}
            value={values[key]}
            onChangeText={text => handleChange(key, text)}
            placeholder={defaults[key]}
            keyboardType="numeric"
            resetTo={defaults[key]}
          />
        ))}
      </>
    );
  }

  if (section === 'fonts') {
    return (
      <>
        {FONT_KEYS.map(key => (
          <TextField
            key={key}
            label={LABELS[key]}
            value={values[key]}
            onChangeText={text => handleChange(key, text)}
            placeholder={defaults[key]}
            keyboardType="numeric"
            resetTo={defaults[key]}
          />
        ))}
      </>
    );
  }

  return (
    <>
      <BoolToggle
        label="Show character icons"
        value={values.showCharacterIcons === 'true'}
        accent={values.accentColor}
        onChange={next =>
          handleChange('showCharacterIcons', next ? 'true' : 'false')
        }
      />

      <OptionRow
        label={LABELS.showGroupCharNames}
        note="How group members appear in the chat selector bar."
        options={[
          { value: 'avatar', label: 'Avatar' },
          { value: 'both', label: 'Both' },
          { value: 'name', label: 'Name' },
        ]}
        value={appSettings.showGroupCharNames}
        accent={values.accentColor}
        onChange={showGroupCharNames =>
          setAppSettings({ ...appSettings, showGroupCharNames })
        }
      />

      <BoolToggle
        label={LABELS.showThinking}
        note="Shows the model's reasoning above replies. Turn off to display answers only."
        value={values.showThinking === 'true'}
        accent={values.accentColor}
        onChange={next => handleChange('showThinking', next ? 'true' : 'false')}
      />

      <BoolToggle
        label={LABELS.forceItalic}
        note="Skews *italic* text geometrically for fonts without an italic face."
        value={values.forceItalic === 'true'}
        accent={values.accentColor}
        onChange={next => handleChange('forceItalic', next ? 'true' : 'false')}
      />

      <TextField
        label={LABELS.carouselAnimMs}
        note="How long the message studio carousel takes to appear."
        value={values.carouselAnimMs}
        onChangeText={text => handleChange('carouselAnimMs', text)}
        placeholder={defaults.carouselAnimMs}
        keyboardType="numeric"
        resetTo={defaults.carouselAnimMs}
      />
    </>
  );
}

import {Text, View} from 'react-native';
import {useTheme} from './ThemeContext';

export default function WelcomeGuide() {
  const st = useTheme();

  return (
    <View style={st.welcomeContainer}>
      <View style={st.welcomeCenter}>
        <Text style={st.welcomeTitle}>Welcome to Bucket!</Text>
        <Text style={st.welcomeSubtitle}>
          Bucket is a completely free, open source app made for roleplay with LLMs. All of your data is stored locally on your phone, and you have full control over it!{'\n\n'}
          You'll need to bring your own API key (BYOK) to use any provider. We don't provide LLMs ourselves and are not responsible for what third-party providers do with your data.
        </Text>
      </View>

      <View style={st.welcomeArrowGroup}>
        <View style={st.welcomeItemLeft}>
          <Text style={st.welcomeLabel}>Themes,{'\n'}providers & more</Text>
          <Text style={st.welcomeArrow}>↓</Text>
        </View>

        <View style={st.welcomeItemCenter}>
          <Text style={st.welcomeLabel}>Switch views.{'\n'}Double tap Chat{'\n'}to close</Text>
          <Text style={st.welcomeArrow}>↓</Text>
        </View>

        <View style={st.welcomeItemRight}>
          <Text style={st.welcomeLabel}>Create a{'\n'}new character</Text>
          <Text style={st.welcomeArrow}>↓</Text>
        </View>
      </View>
    </View>
  );
}

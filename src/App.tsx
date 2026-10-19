import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import pkg from '../package.json';
import { useAppStore } from './store';
import { ThemeProvider } from './ThemeContext';
import {
  CrashReport,
  clearPendingCrash,
  installCrashExport,
  readPendingCrash,
  reportRoadblock,
} from './CrashExport';
import CrashPrompt from './CrashPrompt';
import { RootNavigator } from './Navigation';
import { initDB } from './Database';
import { setIcon } from './IconModule';
import SysStatsOverlay from './SysStatsOverlay';

const SPLASH_MIN_MS = 1500;
const APP_VERSION = pkg.version;

function SplashScreen({
  bgPrimary,
  textMuted,
  textPrimary,
}: {
  bgPrimary: string;
  textMuted: string;
  textPrimary: string;
}) {
  return (
    <View style={[styles.splash, { backgroundColor: bgPrimary }]}>
      <View style={styles.section}>
        <Text style={[styles.label, { color: textMuted }]}>Developer</Text>
        <Text style={[styles.name, { color: textPrimary }]}>Poor Adrian</Text>
      </View>
      <View style={styles.section}>
        <Text style={[styles.label, { color: textMuted }]}>
          Special Thanks to
        </Text>
        <Text style={[styles.name, { color: textPrimary }]}>Asphodel</Text>
        <Text style={[styles.name, { color: textPrimary }]}>Sabalan</Text>
      </View>
      <Text style={[styles.version, { color: textMuted }]}>v{APP_VERSION}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 40,
  },
  section: {
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
  },
  version: {
    position: 'absolute',
    bottom: 32,
    fontSize: 12,
    fontWeight: '500',
  },
});

export default function App() {
  const appSettings = useAppStore(s => s.appSettings);
  const loadCharacters = useAppStore(s => s.loadCharacters);
  const loadGroupChats = useAppStore(s => s.loadGroupChats);
  const loadFolders = useAppStore(s => s.loadFolders);
  const loadLorebooks = useAppStore(s => s.loadLorebooks);
  const loadSettings = useAppStore(s => s.loadSettings);
  const showSysStats = useAppStore(s => s.showSysStats);
  const toggleSysStats = useAppStore(s => s.toggleSysStats);

  const [loaded, setLoaded] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [crashReport, setCrashReport] = useState<CrashReport | null>(null);
  const splashStart = useRef(Date.now());

  useEffect(() => {
    (async () => {
      installCrashExport();
      let report = await readPendingCrash();
      try {
        initDB();
        await loadSettings();
        loadCharacters();
        loadGroupChats();
        loadFolders();
        loadLorebooks();
        if (useAppStore.getState().appSettings.dynamicIcon)
          setIcon(useAppStore.getState().appSettings.themeMode);
      } catch (e) {
        report = report ?? reportRoadblock(e, 'Startup');
      }
      if (report) setCrashReport(report);
      setLoaded(true);
    })();
  }, [
    loadSettings,
    loadCharacters,
    loadGroupChats,
    loadFolders,
    loadLorebooks,
  ]);

  const dismissCrash = useCallback(() => {
    setCrashReport(null);
    clearPendingCrash();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const elapsed = Date.now() - splashStart.current;
    const remaining = Math.max(0, SPLASH_MIN_MS - elapsed);
    const t = setTimeout(() => setSplashDone(true), remaining);
    return () => clearTimeout(t);
  }, [loaded]);

  if (!splashDone) {
    return (
      <SplashScreen
        bgPrimary={appSettings.bgPrimary}
        textMuted={appSettings.textMuted}
        textPrimary={appSettings.textPrimary}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider settings={appSettings}>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
        <SysStatsOverlay visible={showSysStats} onClose={toggleSysStats} />
        <CrashPrompt report={crashReport} onDismiss={dismissCrash} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

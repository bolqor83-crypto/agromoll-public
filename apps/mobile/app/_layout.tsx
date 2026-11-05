import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '@agromoll/ui';
import { logger } from '@/lib/logger';
import { useThemeStore } from '@/store/theme';

function AppShell() {
  const { mode } = useTheme();

  useEffect(() => {
    logger.info('app', 'приложение запущено', {
      version: Constants.expoConfig?.version ?? 'unknown',
      sdk: String(Constants.expoConfig?.sdkVersion ?? 'unknown'),
    });
  }, []);

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
    </>
  );
}

export default function RootLayout() {
  // Тема живёт в zustand-сторе, а ThemeProvider из @agromoll/ui рисует её по токенам.
  const setting = useThemeStore((s) => s.setting);
  const setSetting = useThemeStore((s) => s.setSetting);

  return (
    <SafeAreaProvider>
      <ThemeProvider setting={setting} onSettingChange={setSetting}>
        <AppShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider, useTheme } from '@agromoll/ui';

import { useSettingsStore } from '../src/store/settings';

/** Стек навигации с фоном из темы — без белых вспышек при переходах. */
function ThemedStack() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}

function ThemedStatusBar() {
  const { mode } = useTheme();
  return <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />;
}

export default function RootLayout() {
  const themeMode = useSettingsStore((state) => state.themeMode);

  return (
    <SafeAreaProvider>
      <ThemeProvider mode={themeMode}>
        <ThemedStatusBar />
        <ThemedStack />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

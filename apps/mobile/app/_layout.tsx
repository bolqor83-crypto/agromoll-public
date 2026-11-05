import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '@agromoll/ui';
import { logger } from '@/lib/logger';
import { useThemeStore } from '@/store/theme';
import { listenForcedSignOut, useAuthStore } from '@/store/auth';
import { initOutboxBridge } from '@/store/outbox';
import { ConflictDialog } from '@/components/ConflictDialog';

function AppShell() {
  const { mode } = useTheme();
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  // При старте: refresh-токен есть → пробуем refresh и профиль;
  // нет → экран входа. Гейт рисует заглушку, пока статус booting.
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Сессия сгорела (refresh не удался в интерцепторе) — на вход.
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/auth');
    }
  }, [status, router]);

  // Интерцептор axios сказал «разлогинь» — слушаем один раз.
  useEffect(() => listenForcedSignOut(), []);

  // Офлайн-ядро: события очереди, сеть (NetInfo), передний план (AppState).
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void initOutboxBridge().then((fn) => {
      cleanup = fn;
    });
    return () => cleanup?.();
  }, []);

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
      {/* Конфликт outbox ↔ сервер: решает человек, не молча (ADR-006) */}
      <ConflictDialog />
    </>
  );
}

/** Заглушка на время проверки сессии (booting): тихий сплэш в цвете темы. */
function BootSplash() {
  const { colors } = useTheme();
  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background }}
      accessibilityLabel="Загрузка приложения"
    />
  );
}

export default function RootLayout() {
  // Тема живёт в zustand-сторе, а ThemeProvider из @agromoll/ui рисует её по токенам.
  const setting = useThemeStore((s) => s.setting);
  const setSetting = useThemeStore((s) => s.setSetting);
  const status = useAuthStore((s) => s.status);

  return (
    <SafeAreaProvider>
      <ThemeProvider setting={setting} onSettingChange={setSetting}>
        {status === 'booting' ? <BootSplash /> : <AppShell />}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

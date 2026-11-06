import '@/lib/gesture-handler-boot';
import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '@agromoll/ui';
import { logger } from '@/lib/logger';
import { IS_API_CONFIGURED } from '@/lib/api-config';
import { useThemeStore } from '@/store/theme';
import { listenForcedSignOut, useAuthStore } from '@/store/auth';
import { initOutboxBridge } from '@/store/outbox';
import { ApiNotConfiguredScreen } from '@/components/ApiNotConfiguredScreen';
import { ConflictDialog } from '@/components/ConflictDialog';

/**
 * v0.6.1-B: защита от дубля «приложение запущено» — React 18 в dev
 * монтирует эффекты дважды (StrictMode-поведение), в проде — один раз.
 * Модульный флаг гарантирует одну запись за жизнь js-контекста.
 */
let bootLogged = false;

function AppShell() {
  const { mode } = useTheme();
  const router = useRouter();
  const status = useAuthStore((s) => s.status);

  // Сессия сгорела (refresh не удался в интерцепторе) — на вход.
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/auth');
    }
  }, [status, router]);

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
  const bootstrap = useAuthStore((s) => s.bootstrap);

  // Инициализация живёт ЗДЕСЬ, а не в AppShell: пока статус booting,
  // рендерится BootSplash и эффекты AppShell не выполнялись бы — дедлок.
  // При старте: refresh-токен есть → пробуем refresh и профиль; нет → вход.
  // Адрес API не настроен (prod без EXPO_PUBLIC_API_URL, ADR-022) —
  // bootstrap не запускаем: экран «Сервер не настроен» вместо входа.
  useEffect(() => {
    if (IS_API_CONFIGURED) {
      void bootstrap();
    }
  }, [bootstrap]);

  // Интерцептор axios сказал «разлогинь» — слушаем один раз.
  useEffect(() => listenForcedSignOut(), []);

  // Офлайн-ядро: события очереди, сеть (NetInfo), передний план (AppState).
  // Без адреса API очереди нечего отправлять — не инициализируем.
  useEffect(() => {
    if (!IS_API_CONFIGURED) {
      return;
    }
    let cleanup: (() => void) | undefined;
    void initOutboxBridge().then((fn) => {
      cleanup = fn;
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    if (!bootLogged) {
      bootLogged = true;
      logger.info('app', 'приложение запущено', {
        version: Constants.expoConfig?.version ?? 'unknown',
        sdk: String(Constants.expoConfig?.sdkVersion ?? 'unknown'),
      });
    }
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider setting={setting} onSettingChange={setSetting}>
        {/* Адрес API не настроен (prod, ADR-022) — честный экран вместо молчаливого localhost. */}
        {!IS_API_CONFIGURED ? (
          <ApiNotConfiguredScreen />
        ) : status === 'booting' ? (
          <BootSplash />
        ) : (
          <AppShell />
        )}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * Индикатор соединения в шапке (v0.3.0, ADR-006).
 *
 * Три состояния, БЕЗ красного (ADR-002):
 *  - зелёная точка «Онлайн»;
 *  - янтарная точка «Офлайн — сохраним»;
 *  - зелёная пульсирующая «Синхронизация…» — очередь не пуста и есть сеть.
 * Тап открывает экран «Очередь» (прозрачность для пользователя).
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { radius, spacing, SuccessCheck, Text, useTheme } from '@agromoll/ui';
import { useOutboxStore } from '@/store/outbox';

export function ConnectionBadge() {
  const { colors } = useTheme();
  const router = useRouter();
  const isOnline = useOutboxStore((s) => s.isOnline);
  const pendingCount = useOutboxStore((s) => s.pendingCount);
  const syncing = useOutboxStore((s) => s.syncing);

  // v0.6.1-E2 (ADR-027): очередь опустела при живой сети — синхронизация
  // удалась. Тихая галочка на ~1 с: всё отправлено.
  const [justSynced, setJustSynced] = useState(false);
  const prevPending = useRef(pendingCount);
  useEffect(() => {
    if (prevPending.current > 0 && pendingCount === 0 && isOnline) {
      setJustSynced(true);
    }
    prevPending.current = pendingCount;
  }, [pendingCount, isOnline]);

  const isSyncing = syncing || (pendingCount > 0 && isOnline);
  const isOffline = !isOnline;

  const dotColor = isOffline ? colors.warning : colors.primary;
  const label = isSyncing ? 'Синхронизация…' : isOffline ? 'Офлайн — сохраним' : 'Онлайн';

  // Пульс точки в режиме синхронизации: 1 → 0.6 → 1, полный цикл 2 с
  // (ADR-009). «Онлайн» и «Офлайн» — статичные точки.
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (isSyncing) {
      opacity.value = withRepeat(
        withTiming(0.6, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      opacity.value = withTiming(1, { duration: 200 });
    }
  }, [isSyncing, opacity]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Сеть: ${label}. Открыть очередь операций`}
      onPress={() => router.push('/queue')}
      // v0.6.2-B: зона нажатия ≥48px (высота визуала 36 + hitSlop 6)
      hitSlop={6}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        height: 36,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: isOffline ? colors.warning : colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Animated.View
        style={[
          dotStyle,
          {
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: dotColor,
          },
        ]}
      />
      <Text variant="caption" weight="600" color={isOffline ? 'onWarning' : 'secondary'}>
        {label}
        {isSyncing && pendingCount > 0 ? ` (${pendingCount})` : ''}
      </Text>
      {justSynced ? <SuccessCheck size="sm" onDone={() => setJustSynced(false)} /> : null}
    </Pressable>
  );
}

/**
 * RoleCoachMark — подсказка при первом входе в роль (v0.6.2-C, ADR-029).
 *
 * 1–2 подсказки на роль: «Здесь ваши брони», «Нажмите + чтобы создать
 * лот». Показывается ОДИН раз (флаг в AsyncStorage/localStorage,
 * lib/first-run), НЕ блокирует интерфейс:
 *  - появляется снизу над таб-баром, вход — slide-up + fade 300 мс;
 *  - тап — скрыть; авто-скрытие через 7 с;
 *  - scrim нет, pointerEvents только на самой плашке.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  Icon,
  motion,
  radius,
  spacing,
  tap,
  Text,
  useTheme,
} from '@agromoll/ui';
import type { IconName } from '@agromoll/ui';
import { isCoachMarkSeen, markCoachMarkSeen } from '@/lib/first-run';
import { logger } from '@/lib/logger';

/** Авто-скрытие: 7 с — достаточно прочесть, не мешает. */
const AUTO_HIDE_MS = 7000;

/** Подсказки по ролям (ADR-029: 1–2 строки, конкретное место приложения). */
/** Подсказки короткие (1–2 строки): длинное читаюшие в 4 утра не будут. */
const ROLE_HINTS: Record<string, { icon: IconName; text: string }[]> = {
  buyer: [
    { icon: 'bookmark-outline', text: 'Ваши брони — здесь. Товар держат 2 часа.' },
    { icon: 'navigate-outline', text: 'Кнопка «Рядом» — продавцы в 2 км от вас.' },
  ],
  seller: [
    { icon: 'add-circle-outline', text: 'Нажмите + чтобы создать лот.' },
    { icon: 'mail-outline', text: 'Брони покупателей — во «Входящих».' },
  ],
  driver: [
    { icon: 'locate-outline', text: 'Радар находит заказы вдоль маршрута.' },
    { icon: 'car-outline', text: 'Активный рейс — в «Мои доставки».' },
  ],
};

export interface RoleCoachMarkProps {
  role: string;
  /** Переопределение авто-скрытия и storage-флага — для тестов. */
  autoHideMs?: number;
  storage?: {
    isSeen: (role: string) => Promise<boolean>;
    markSeen: (role: string) => Promise<void>;
  };
}

export function RoleCoachMark({
  role,
  autoHideMs = AUTO_HIDE_MS,
  storage = { isSeen: isCoachMarkSeen, markSeen: markCoachMarkSeen },
}: RoleCoachMarkProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [hintIndex, setHintIndex] = useState<number | null>(null);
  const hints = ROLE_HINTS[role] ?? [];

  // Появление снизу: translateY 24 → 0 spring + fade (ADR-029).
  const appear = useSharedValue(0);

  const dismiss = useCallback(() => {
    tap();
    appear.value = withTiming(0, { duration: 250 }, () => {
      runOnJS(setHintIndex)(null);
    });
    storage.markSeen(role).catch((error) => {
      logger.warn('coach', 'не удалось записать флаг подсказки', { error: String(error) });
    });
  }, [appear, role, storage]);

  // Один раз на монтирование: если роль ещё не видела подсказки — показать.
  const effectRan = useRef(false);
  useEffect(() => {
    if (effectRan.current) {
      return;
    }
    effectRan.current = true;
    if (hints.length === 0) {
      return;
    }
    storage
      .isSeen(role)
      .then((seen) => {
        if (!seen) {
          setHintIndex(0);
        }
      })
      .catch((error) => {
        logger.warn('coach', 'не удалось прочитать флаг подсказки', { error: String(error) });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Анимация входа при показе + авто-скрытие; смена подсказки — мягкий свап.
  useEffect(() => {
    if (hintIndex === null) {
      return;
    }
    appear.value = withSequence(
      withTiming(0, { duration: 120 }),
      withSpring(1, motion.pressSpring),
    );
    const timer = setTimeout(() => {
      // Последняя подсказка — скрыть; иначе показать следующую.
      if (hintIndex >= hints.length - 1) {
        dismiss();
      } else {
        setHintIndex(hintIndex + 1);
      }
    }, autoHideMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintIndex]);

  const appearStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: (1 - appear.value) * 24 }],
  }));

  if (hintIndex === null || hints.length === 0) {
    return null;
  }
  const hint = hints[hintIndex];

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 72 + Math.max(insets.bottom, spacing.xs),
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
      }}
    >
      <Animated.View exiting={FadeOut.duration(200)} style={appearStyle}>
        <Pressable
          testID={`coach-mark-${role}`}
          accessibilityRole="button"
          accessibilityLabel={`Подсказка: ${hint.text}. Нажмите, чтобы скрыть`}
          onPress={dismiss}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            maxWidth: 420,
            backgroundColor: colors.surfaceElevated,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            paddingHorizontal: spacing.lg,
            minHeight: 48,
            // лёгкое покачивание при появлении — «посмотри сюда»
            paddingVertical: spacing.sm,
          }}
        >
          <Icon name={hint.icon} size={22} color="primary" />
          <Text variant="body" color="text" style={{ flex: 1 }}>
            {hint.text}
          </Text>
          <Icon name="close-outline" size={18} color="muted" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** Экспорт для тестов: сколько подсказок у роли. */
export function coachHintsForRole(role: string): { icon: IconName; text: string }[] {
  return ROLE_HINTS[role] ?? [];
}

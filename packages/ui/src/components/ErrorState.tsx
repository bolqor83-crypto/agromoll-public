/**
 * ErrorState — унифицированное состояние ошибки (v0.6.1-D, ADR-026).
 *
 * Философия (ADR-002/ADR-005): ошибка — не повод для тревоги и не красный
 * экран. Мягкая янтарная иллюстрация «нет связи», человеческий заголовок,
 * объяснение и кнопка «Повторить». Ошибка НИКОГДА не молчит: ни вечный
 * skeleton, ни тихий console.warn, ни пустой экран.
 *
 * Два варианта:
 *  - full — первая загрузка не удалась, показывать нечего: иллюстрация,
 *    заголовок, описание, повтор. Занимает экран.
 *  - inline — данные есть, но они устарели (рефреш не удался): компактный
 *    янтарный блок над списком без иллюстрации.
 *
 * Так же, как EmptyState (пустое состояние ≠ ошибка), ErrorState отделён
 * от него: пустая корзина и упавший сервер — разные сообщения.
 *
 * v0.6.1-E2 (ADR-027): появление — scale 0.95→1 + fade (300 мс spring),
 * иллюстрация с задержкой 100 мс (staggered); reduced motion — мгновенно.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';
import { radius, spacing } from '../tokens';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

/** Пружина появления блока/иллюстрации (ADR-027: 300 мс spring). */
const APPEAR_SPRING = { damping: 16, mass: 0.75, stiffness: 240 };
/** Задержка иллюстрации — staggered entrance (ADR-027: 100 мс). */
const STAGGER_MS = 100;

/** Прозрачность янтарной подложки (~18%, как у attention-бейджа). */
const WARNING_BG_ALPHA = '2E';

export interface ErrorStateProps {
  /** Заголовок по умолчанию — «Не удалось загрузить». */
  title?: string;
  /** Человеческое объяснение, что случилось и что делать. */
  description: string;
  /** Повторить запрос. Для full-варианта обязательна. */
  onRetry?: () => void;
  /** Текст кнопки повтора. */
  retryLabel?: string;
  /** full — весь экран; inline — компактный блок над устаревшими данными. */
  variant?: 'full' | 'inline';
  testID?: string;
}

export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = 'Повторить',
  variant = 'full',
  testID = 'error-state',
}: ErrorStateProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();

  // Появление блока: scale 0.95→1 пружиной + fade 300 мс (ADR-027).
  const contentScale = useSharedValue(reduced ? 1 : 0.95);
  const contentOpacity = useSharedValue(reduced ? 1 : 0);
  // Иллюстрация — на 100 мс позже блока: глаз ведёт от общего к деталям.
  const scale = useSharedValue(reduced ? 1 : 0.9);
  const opacity = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      return;
    }
    contentScale.value = withSpring(1, APPEAR_SPRING);
    contentOpacity.value = withTiming(1, { duration: 300 });
    scale.value = withDelay(STAGGER_MS, withSpring(1, APPEAR_SPRING));
    opacity.value = withDelay(STAGGER_MS, withTiming(1, { duration: 300 }));
    // появление — один раз на монтирование
  }, []);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ scale: contentScale.value }],
    opacity: contentOpacity.value,
  }));

  const illustrationStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  if (variant === 'inline') {
    return (
      <View
        testID={testID}
        accessibilityRole="alert"
        accessibilityLabel={title ?? 'Не удалось загрузить'}
        style={{
          gap: spacing.xs,
          padding: spacing.md,
          borderRadius: radius.md,
          backgroundColor: colors.warning + WARNING_BG_ALPHA,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Icon name="cloud-offline-outline" size={18} color="onWarning" />
          <Text variant="caption" weight="600" color="onWarning">
            {title ?? 'Не удалось загрузить'}
          </Text>
        </View>
        <Text variant="caption" color="onWarning">
          {description}
        </Text>
        {onRetry ? (
          <Button title={retryLabel} variant="ghost" size="md" onPress={onRetry} />
        ) : null}
      </View>
    );
  }

  return (
    <Animated.View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLabel={title ?? 'Не удалось загрузить'}
      style={[
        contentStyle,
        {
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: spacing.xxl,
          paddingHorizontal: spacing.xl,
        },
      ]}
    >
      <Animated.View
        style={[
          {
            width: 88,
            height: 88,
            borderRadius: 44,
            backgroundColor: colors.warning + WARNING_BG_ALPHA,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.sm,
          },
          illustrationStyle,
        ]}
      >
        <Icon name="cloud-offline-outline" size={40} color="onWarning" />
      </Animated.View>
      <Text variant="title" align="center">
        {title ?? 'Не удалось загрузить'}
      </Text>
      <Text variant="body" color="secondary" align="center">
        {description}
      </Text>
      {onRetry ? (
        <Button
          title={retryLabel}
          variant="secondary"
          onPress={onRetry}
          style={{ marginTop: spacing.sm }}
        />
      ) : null}
    </Animated.View>
  );
}

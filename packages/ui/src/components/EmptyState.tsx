/**
 * EmptyState — пустое состояние списка.
 *
 * Философия (ADR-002 / ADR-005): пустой экран — это не ошибка и не повод
 * для тревоги. Мягкая геометрическая иллюстрация из форм дизайн-системы
 * (никаких стоковых картинок), 1–2 строки текста и опциональное действие.
 *
 * v0.3.1: иллюстрация «появляется» — scale 0.9 → 1 + проявление,
 * 400 мс spring (ADR-009). Пустое состояние — часть живого интерфейса,
 * а не простыня текста.
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';
import { radius, spacing } from '../tokens';
import { Button } from './Button';
import { Text } from './Text';

/** Пружина появления иллюстрации (400 мс, мягкая). */
const ILLUSTRATION_SPRING = { damping: 15, mass: 0.8, stiffness: 200 };

/** Иллюстрации — простые геометрические композиции в токенах темы. */
export type EmptyStateIllustration = 'basket' | 'box' | 'radar' | 'calendar';

export interface EmptyStateProps {
  illustration?: EmptyStateIllustration;
  title: string;
  description?: string;
  /** Кнопка действия, например «Обновить» или «Выставить лот». */
  action?: { label: string; onPress: () => void };
  children?: ReactNode;
}

export function EmptyState({
  illustration = 'box',
  title,
  description,
  action,
  children,
}: EmptyStateProps) {
  const { colors } = useTheme();

  // Появление иллюстрации: масштаб 0.9 → 1 пружиной + fade 400 мс.
  const scale = useSharedValue(0.9);
  const opacity = useSharedValue(0);

  useEffect(() => {
    scale.value = withSpring(1, ILLUSTRATION_SPRING);
    opacity.value = withTiming(1, { duration: 400 });
  }, [scale, opacity]);

  const illustrationStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View
      accessibilityLabel={title}
      style={{
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.xxl,
        paddingHorizontal: spacing.xl,
      }}
    >
      <Animated.View style={[{ marginBottom: spacing.sm }, illustrationStyle]}>
        {renderIllustration(illustration, colors)}
      </Animated.View>
      <Text variant="title" align="center">
        {title}
      </Text>
      {description ? (
        <Text variant="body" color="secondary" align="center">
          {description}
        </Text>
      ) : null}
      {action ? (
        <Button
          title={action.label}
          variant="secondary"
          onPress={action.onPress}
          style={{ marginTop: spacing.sm }}
        />
      ) : null}
      {children}
    </View>
  );
}

type Palette = ReturnType<typeof useTheme>['colors'];

function renderIllustration(kind: EmptyStateIllustration, colors: Palette): ReactNode {
  switch (kind) {
    case 'basket':
      return <BasketIllustration colors={colors} />;
    case 'box':
      return <BoxIllustration colors={colors} />;
    case 'radar':
      return <RadarIllustration colors={colors} />;
    case 'calendar':
      return <CalendarIllustration colors={colors} />;
  }
}

/** Пустая корзина: два мягких скруглённых прямоугольника (тело + ручка). */
function BasketIllustration({ colors }: { colors: Palette }) {
  return (
    <View style={{ alignItems: 'center' }}>
      {/* Ручка */}
      <View
        style={{
          width: 44,
          height: 26,
          borderWidth: 6,
          borderColor: colors.primaryMuted,
          borderBottomWidth: 0,
          borderTopLeftRadius: radius.pill,
          borderTopRightRadius: radius.pill,
          marginBottom: -3,
        }}
      />
      {/* Тело корзины */}
      <View
        style={{
          width: 96,
          height: 56,
          backgroundColor: colors.primaryMuted,
          borderRadius: radius.md,
          borderTopLeftRadius: radius.sm,
          borderTopRightRadius: radius.sm,
          justifyContent: 'flex-end',
          alignItems: 'center',
          paddingBottom: 0,
        }}
      >
        <View
          style={{
            width: 96,
            height: 10,
            backgroundColor: colors.primary,
            borderBottomLeftRadius: radius.md,
            borderBottomRightRadius: radius.md,
            opacity: 0.85,
          }}
        />
      </View>
    </View>
  );
}

/** Пустой ящик: скруглённый квадрат с «крышкой» и щелью. */
function BoxIllustration({ colors }: { colors: Palette }) {
  return (
    <View style={{ alignItems: 'center', width: 96 }}>
      <View
        style={{
          width: 60,
          height: 14,
          backgroundColor: colors.primaryMuted,
          borderTopLeftRadius: radius.sm,
          borderTopRightRadius: radius.sm,
        }}
      />
      <View
        style={{
          width: 84,
          height: 62,
          borderWidth: 6,
          borderColor: colors.primaryMuted,
          borderRadius: radius.md,
          borderTopWidth: 0,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <View
          style={{
            width: 28,
            height: 6,
            borderRadius: radius.pill,
            backgroundColor: colors.primaryMuted,
          }}
        />
      </View>
    </View>
  );
}

/** Радар попутных заказов: концентрические кольца и точка-заказ. */
function RadarIllustration({ colors }: { colors: Palette }) {
  const ring = (size: number, borderWidth: number, opacity: number): ReactNode => (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth,
        borderColor: colors.primaryMuted,
        opacity,
        position: 'absolute',
      }}
    />
  );
  return (
    <View style={{ width: 96, height: 96, justifyContent: 'center', alignItems: 'center' }}>
      {ring(96, 5, 0.4)}
      {ring(64, 5, 0.7)}
      {ring(32, 5, 1)}
      <View
        style={{
          position: 'absolute',
          top: 14,
          right: 18,
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: colors.warning,
        }}
      />
    </View>
  );
}

/** Пустой календарь броней: скруглённый прямоугольник с точками дней. */
function CalendarIllustration({ colors }: { colors: Palette }) {
  return (
    <View
      style={{
        width: 84,
        height: 76,
        borderRadius: radius.md,
        backgroundColor: colors.primaryMuted,
        overflow: 'hidden',
        alignItems: 'center',
      }}
    >
      <View
        style={{
          width: 84,
          height: 16,
          backgroundColor: colors.primary,
          opacity: 0.85,
          borderTopLeftRadius: radius.md,
          borderTopRightRadius: radius.md,
        }}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md + 2 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border }} />
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border }} />
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border }} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border }} />
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border }} />
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border }} />
      </View>
    </View>
  );
}

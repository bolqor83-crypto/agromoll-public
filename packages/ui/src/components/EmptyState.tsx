/**
 * EmptyState — пустое состояние списка.
 *
 * Философия (ADR-002 / ADR-005): пустой экран — это не ошибка и не повод
 * для тревоги. Мягкая геометрическая иллюстрация из форм дизайн-системы
 * (никаких стоковых картинок), 1–2 строки текста и опциональное действие.
 *
 * v0.3.1: иллюстрация «появляется» — scale 0.9 → 1 + проявление,
 * spring (ADR-009). Пустое состояние — часть живого интерфейса,
 * а не простыня текста.
 *
 * v0.6.1-E2 (ADR-027): блок целиком — scale 0.95→1 + fade 300 мс,
 * иллюстрация на 100 мс позже (staggered); reduced motion — мгновенно.
 *
 * v0.6.2-C (ADR-029): иллюстрации «живые» — после появления у каждой
 * своя тихая idle-анимация: корзина покачивается, ящик «дышит»,
 * точка радара пульсирует, календарь плывёт, грузовик катится.
 * 2–3 с, repeat reverse, амплитуда ±2–3 px/градуса — заметно периферийным
 * зрением, не отвлекает. Reduced motion — статично.
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';
import { radius, spacing } from '../tokens';
import { Button } from './Button';
import { Text } from './Text';

/** Пружина появления блока/иллюстрации (ADR-027: 300 мс spring). */
const APPEAR_SPRING = { damping: 16, mass: 0.75, stiffness: 240 };
/** Задержка иллюстрации — staggered entrance (ADR-027: 100 мс). */
const STAGGER_MS = 100;
/** Период idle-анимаций (ADR-029): 2.4–3.2 с, тихий маятник. */
const IDLE_MS = 2800;

/**
 * Чистая функция idle-трансформации (экспорт для тестов): по типу
 * иллюстрации и фазе маятника 0..1 отдаёт стиль transform.
 * Амплитуды тихие: ±2–3 px / градуса — заметно периферией, не отвлекает.
 * Типы не аннотируем: TS выводит узкие литеральные ветки — они
 * присваиваются к transform-стилю Reanimated.
 */
export function idleTransformFor(kind: EmptyStateIllustration, t: number) {
  switch (kind) {
    case 'basket':
      // покачивание ±2°
      return { transform: [{ rotate: `${(t - 0.5) * 4}deg` }] };
    case 'box':
      // дыхание 1 → 1.04
      return { transform: [{ scale: 1 + t * 0.04 }] };
    case 'radar':
      // лёгкий подъём точки-заказа: до 3px
      return { transform: [{ translateY: -t * 3 }] };
    case 'calendar':
      // плавное вертикальное покачивание ±2px
      return { transform: [{ translateY: (t - 0.5) * 4 }] };
    case 'truck':
      // катится: смещение ±5px с лёгким наклоном
      return { transform: [{ translateX: (t - 0.5) * 10 }, { rotate: `${(t - 0.5) * 1.6}deg` }] };
    default:
      return { transform: [] };
  }
}

/** Иллюстрации — простые геометрические композиции в токенах темы. */
export type EmptyStateIllustration = 'basket' | 'box' | 'radar' | 'calendar' | 'truck';

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
  const reduced = useReducedMotion();

  // Блок целиком: scale 0.95→1 + fade; иллюстрация — на 100 мс позже.
  const contentScale = useSharedValue(reduced ? 1 : 0.95);
  const contentOpacity = useSharedValue(reduced ? 1 : 0);
  const scale = useSharedValue(reduced ? 1 : 0.9);
  const opacity = useSharedValue(reduced ? 1 : 0);
  // v0.6.2-C: тихий idle-драйвер — амплитуда 0→1→0 маятником.
  const idle = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      return;
    }
    contentScale.value = withSpring(1, APPEAR_SPRING);
    contentOpacity.value = withTiming(1, { duration: 300 });
    scale.value = withDelay(STAGGER_MS, withSpring(1, APPEAR_SPRING));
    opacity.value = withDelay(STAGGER_MS, withTiming(1, { duration: 300 }));
    // Idle запускается после появления — не спорит с entrance.
    idle.value = withDelay(
      STAGGER_MS + 400,
      withRepeat(
        withSequence(
          withTiming(1, { duration: IDLE_MS / 2 }),
          withTiming(0, { duration: IDLE_MS / 2 }),
        ),
        -1,
        false,
      ),
    );
    return () => {
      cancelAnimation(idle);
    };
    // появление и idle — один раз на монтирование
  }, []);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ scale: contentScale.value }],
    opacity: contentOpacity.value,
  }));

  // Idle-трансформации по kind: покачивание/дыхание/пульс/качение.
  const idleStyle = useAnimatedStyle(() => idleTransformFor(illustration, idle.value));

  const illustrationStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      accessibilityLabel={title}
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
      <Animated.View style={[{ marginBottom: spacing.sm }, illustrationStyle]}>
        <Animated.View style={reduced ? undefined : idleStyle}>
          {renderIllustration(illustration, colors)}
        </Animated.View>
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
    </Animated.View>
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
    case 'truck':
      return <TruckIllustration colors={colors} />;
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

/**
 * Грузовик-попутчик (v0.6.2-C): кабина + кузов + колёса + дорога.
 * Геометрия токенов: кузов primaryMuted, кабина primary, колёса text,
 * дорога — штрихи border. Катится в idle-анимации.
 */
function TruckIllustration({ colors }: { colors: Palette }) {
  return (
    <View style={{ alignItems: 'center', width: 116 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        {/* Кузов */}
        <View
          style={{
            width: 62,
            height: 40,
            backgroundColor: colors.primaryMuted,
            borderTopLeftRadius: radius.sm,
            borderTopRightRadius: radius.sm,
            borderBottomLeftRadius: 4,
          }}
        />
        {/* Кабина */}
        <View
          style={{
            width: 30,
            height: 30,
            backgroundColor: colors.primary,
            borderTopLeftRadius: 4,
            borderTopRightRadius: radius.sm,
            borderBottomRightRadius: radius.sm,
            marginLeft: 4,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          {/* Окно */}
          <View
            style={{
              width: 12,
              height: 10,
              borderRadius: 3,
              backgroundColor: colors.surface,
              opacity: 0.9,
            }}
          />
        </View>
      </View>
      {/* Колёса */}
      <View
        style={{
          flexDirection: 'row',
          gap: spacing.xl + 8,
          marginTop: -6,
          alignItems: 'center',
        }}
      >
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.text }} />
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.text }} />
      </View>
      {/* Дорога */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <View style={{ width: 18, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
        <View style={{ width: 18, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
        <View style={{ width: 18, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
      </View>
    </View>
  );
}

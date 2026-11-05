/**
 * Skeleton — плейсхолдер загрузки с shimmer (v0.3.1).
 *
 * Философия (ADR-002 / ADR-005 / ADR-009): в 4 утра никакого
 * «вращающегося колеса» — оно создаёт ощущение спешки. Вместо пульсации
 * прозрачности (v0.2.0) по карточке слева направо плывёт мягкий блик:
 * то же спокойствие, но понятная направленность «данные загружаются».
 *
 * База — surfaceElevated, блик — на 8% светлее базы (lighten).
 * Полный проход — 1.5 с, бесшовный loop, мягкие края (градиент).
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';
import { radius, spacing } from '../tokens';
import { lighten } from '../color';
import { Card } from './Card';

/** Полный проход блика слева направо. */
const SHIMMER_PERIOD_MS = 1500;
/** Ширина блика — 45% блока: мягкая полоса, а не вспышка. */
const SHIMMER_WIDTH_RATIO = 0.45;
/**
 * Конечная точка в долях ШИРИНЫ БЛИКА: чтобы блик полностью ушёл
 * за правый край, его левый край должен пройти 100% родителя,
 * то есть 1/0.45 ≈ 2.22 собственной ширины. Старт (-1) и финиш
 * полностью вне блока — loop без видимого скачка.
 */
const SHIMMER_END = 1 / SHIMMER_WIDTH_RATIO;

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number | `${number}%`;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

/** Один блок с бегущим бликом. */
export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = radius.sm,
  style,
}: SkeletonProps) {
  const { colors } = useTheme();
  const translateX = useSharedValue(-1);

  useEffect(() => {
    // -1 (скрыт слева) → 2.22 (скрыт справа): полный проход за период,
    // loop без стыка.
    translateX.value = withRepeat(
      withTiming(SHIMMER_END, { duration: SHIMMER_PERIOD_MS, easing: Easing.inOut(Easing.quad) }),
      -1,
      false,
    );
    return () => cancelAnimation(translateX);
  }, [translateX]);

  const base = colors.surfaceElevated;
  const highlight = lighten(base, 8);

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: `${translateX.value * 100}%` }],
  }));

  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: base,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {/* Блик: полоса шириной 45% с градиентными краями. */}
      <Animated.View
        pointerEvents="none"
        style={[
          shimmerStyle,
          {
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: `${SHIMMER_WIDTH_RATIO * 100}%`,
          },
        ]}
      >
        <LinearGradient
          colors={['transparent', highlight, 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

/** Скелет карточки товара: квадрат «фото» + строки текста, в поверхности карточки. */
export function SkeletonCard() {
  return (
    <Card padding={0} style={{ overflow: 'hidden' }}>
      <View
        style={{
          flexDirection: 'row',
          gap: spacing.md,
          padding: spacing.lg,
        }}
      >
        <View style={{ width: 72, height: 72, borderRadius: radius.md, overflow: 'hidden' }}>
          <Skeleton width="100%" height="100%" borderRadius={radius.md} />
        </View>
        <View style={{ flex: 1, gap: spacing.sm, justifyContent: 'center' }}>
          <Skeleton width="70%" height={20} />
          <Skeleton width="45%" height={14} />
          <Skeleton width="55%" height={14} />
        </View>
      </View>
    </Card>
  );
}

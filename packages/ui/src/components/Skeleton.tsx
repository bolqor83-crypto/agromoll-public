/**
 * Skeleton — мерцающий плейсхолдер загрузки.
 *
 * Философия (ADR-002 / ADR-005): в 4 утра никакого «вращающегося колеса» —
 * оно создаёт ощущение спешки. Карточки проявляются плавным пульсом
 * прозрачности (Reanimated, ~1 сек), форма повторяет будущий контент.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
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
import { Card } from './Card';

/** Период пульса: 500 мс нарастание + 500 мс затухание. */
const PULSE_PERIOD_MS = 1000;

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number | `${number}%`;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

/** Один мерцающий блок. */
export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = radius.sm,
  style,
}: SkeletonProps) {
  const { colors } = useTheme();
  const opacity = useSharedValue(0.45);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.9, { duration: PULSE_PERIOD_MS / 2, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        animatedStyle,
        {
          width,
          height,
          borderRadius,
          backgroundColor: colors.border,
        },
        style,
      ]}
    />
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

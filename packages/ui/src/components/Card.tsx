/**
 * Card — карточка дизайн-системы: скругление 20, мягкая тень, тёплая рамка.
 * Фото, название, цена, бейдж — минимум текста (ADR-002).
 */
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { motion, radius, shadow, spacing } from '../tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface CardProps {
  children: ReactNode;
  /** Карточка-кнопка получает тактильный spring-отклик. */
  onPress?: () => void;
  padding?: number;
  /** Повышенная поверхность (шапка, важные блоки). */
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Card({
  children,
  onPress,
  padding = spacing.lg,
  elevated = false,
  style,
}: CardProps) {
  const { colors, mode } = useTheme();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const baseStyle: StyleProp<ViewStyle> = [
    {
      backgroundColor: elevated ? colors.surfaceElevated : colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding,
    },
    shadow[mode],
    style,
  ];

  if (!onPress) {
    return <View style={baseStyle}>{children}</View>;
  }

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.98, motion.pressSpring);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, motion.pressSpring);
      }}
      accessibilityRole="button"
      style={[animatedStyle, baseStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}

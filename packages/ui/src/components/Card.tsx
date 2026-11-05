import React from 'react';
import { Pressable, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../tokens';

const CARD_SPRING = { damping: 20, stiffness: 340, mass: 0.9 } as const;

export interface CardProps {
  children: React.ReactNode;
  /** Если передан — карточка нажимаемая (spring-отклик 0.98, зона ≥ 48 px). */
  onPress?: () => void;
  /** Отступы: none — 0, sm — 12, md — 16 (по умолчанию). */
  padding?: 'none' | 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Карточка: мягкое скругление 20 px, едва заметная тень и граница. */
export function Card({
  children,
  onPress,
  padding = 'md',
  style,
  testID,
}: CardProps) {
  const { colors, radius, shadows } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const paddingValue = { none: 0, sm: spacing.md, md: spacing.lg }[padding];

  const flattened: ViewStyle = {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: paddingValue,
    ...shadows,
  };

  if (!onPress) {
    return (
      <View testID={testID} style={[flattened, style]}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.98, CARD_SPRING);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, CARD_SPRING);
      }}
    >
      <Animated.View style={[flattened, animatedStyle, style]}>{children}</Animated.View>
    </Pressable>
  );
}

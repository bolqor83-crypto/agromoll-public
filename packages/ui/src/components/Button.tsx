import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { DimensionValue } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../tokens';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'lg' | 'md';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Занять всю ширину контейнера. По умолчанию true — очевидное действие на экране. */
  block?: boolean;
  testID?: string;
}

/** Spring-конфигурация нажатия: короткая (~200 мс) и «упругая», без отскока. */
const PRESS_SPRING = { damping: 18, stiffness: 380, mass: 0.9 } as const;

/**
 * Кнопка. Зоны нажатия: lg — 56 px, md — 48 px (минимум по дизайн-системе,
 * чтобы попадать пальцем в перчатке на бегу).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  disabled = false,
  loading = false,
  block = true,
  testID,
}: ButtonProps) {
  const { colors, radius } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const height = size === 'lg' ? 56 : 48;

  const variantStyles = {
    primary: { backgroundColor: colors.primary },
    secondary: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
    ghost: { backgroundColor: 'transparent' },
  }[variant];

  const labelColor =
    variant === 'primary' ? colors.onPrimary : variant === 'ghost' ? colors.primary : colors.text;

  const handlePressIn = () => {
    scale.value = withSpring(0.97, PRESS_SPRING);
  };
  const handlePressOut = () => {
    scale.value = withSpring(1, PRESS_SPRING);
  };

  return (
    <View style={{ width: (block ? '100%' : 'auto') as DimensionValue }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled || loading}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        <Animated.View
          style={[
            styles.base,
            {
              height,
              borderRadius: radius.md,
              opacity: disabled ? 0.45 : 1,
            },
            variantStyles,
            animatedStyle,
          ]}
        >
          {loading ? (
            <ActivityIndicator color={labelColor} />
          ) : (
            <Text variant="button" style={{ color: labelColor }}>
              {label}
            </Text>
          )}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
});

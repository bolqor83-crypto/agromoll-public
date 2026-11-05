/**
 * Button — главная кнопка дизайн-системы.
 *
 * iOS-like: pill-форма, мягкая заливка, тактильный spring-отклик
 * (scale 0.97 при нажатии, 200–300 мс). Минимальная высота — 48 px
 * (размер md), основная — 56 px (lg). v0.3.1: каждый успешный нажим
 * даёт лёгкий haptic-отклик из тактильной карты (tap, ADR-009).
 */
import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { motion, radius, spacing, touchTarget } from '../tokens';
import { tap } from '../haptics';
import { Text } from './Text';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  /** primary — зелёная заливка; secondary — мягкая зелёная; ghost — прозрачная с рамкой. */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** lg — 56 px (основное действие), md — 48 px (минимальная зона нажатия). */
  size?: 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  iconLeft?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  disabled = false,
  loading = false,
  iconLeft,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.97, motion.pressSpring);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, motion.pressSpring);
  }, [scale]);

  const handlePress = useCallback(() => {
    if (!disabled && !loading) {
      tap();
    }
    onPress?.();
  }, [disabled, loading, onPress]);

  const height = size === 'lg' ? 56 : touchTarget.min;
  const backgroundColor =
    variant === 'primary'
      ? colors.primary
      : variant === 'secondary'
        ? colors.primaryMuted
        : 'transparent';
  const labelColor: 'onPrimary' | 'primary' | 'text' =
    variant === 'primary' ? 'onPrimary' : variant === 'secondary' ? 'primary' : 'text';
  const indicatorColor =
    variant === 'primary'
      ? colors.onPrimary
      : variant === 'secondary'
        ? colors.primary
        : colors.text;

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, busy: loading }}
      style={[
        animatedStyle,
        {
          height,
          borderRadius: radius.pill,
          backgroundColor: disabled ? colors.border : backgroundColor,
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
          paddingHorizontal: spacing.xl,
          opacity: disabled ? 0.6 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={indicatorColor} />
      ) : (
        <>
          {iconLeft}
          <Text variant="button" color={labelColor}>
            {title}
          </Text>
        </>
      )}
    </AnimatedPressable>
  );
}

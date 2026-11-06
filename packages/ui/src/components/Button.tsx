/**
 * Button — главная кнопка дизайн-системы.
 *
 * v0.6.2-B (ADR-028): скругление 16 (было pill — единый «радиус-язык»
 * с карточками), варианты:
 * - primary — зелёная заливка, мягкая тень (светлая тема), min-height 56/48;
 * - secondary — outline: прозрачный фон, зелёная обводка 1.5px, зелёный текст;
 * - danger — деструктивное действие: янтарная обводка + лёгкая янтарная
 *   подложка (срочность без тревоги, красный запрещён — ADR-002);
 * - ghost — прозрачная с нейтральной рамкой.
 *
 * Тактильный spring-отклик (scale 0.97) и haptic при нажатии — как раньше.
 */
import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { motion, radius, shadow, spacing, touchTarget } from '../tokens';
import { tap } from '../haptics';
import { Text } from './Text';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  /** primary — зелёная заливка; secondary — зелёная обводка (outline); danger — янтарная обводка (деструктивное); ghost — прозрачная с рамкой. */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
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
  const { colors, mode } = useTheme();
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
  // v0.6.2-B: minHeight + вертикальные паддинги вместо фикс. height —
  // двухстрочная подпись растягивает кнопку, а не обрезается; соседние
  // кнопки в ряду выравниваются stretch'ем (Flexbox по умолчанию).
  const paddingVertical = size === 'lg' ? 14 : 12;
  // v0.6.2-B: secondary — outline (прозрачный фон + зелёная обводка),
  // danger — янтарная обводка с лёгкой янтарной подложкой (~10%).
  const backgroundColor =
    variant === 'primary'
      ? colors.primary
      : variant === 'secondary'
        ? 'transparent'
        : variant === 'danger'
          ? colors.warning + '1A'
          : 'transparent';
  const borderWidth = variant === 'secondary' || variant === 'danger' ? 1.5 : 0;
  const borderColor =
    variant === 'secondary'
      ? colors.primary
      : variant === 'danger'
        ? colors.warning
        : colors.border;
  const labelColor: 'onPrimary' | 'primary' | 'onWarning' | 'text' =
    variant === 'primary'
      ? 'onPrimary'
      : variant === 'secondary'
        ? 'primary'
        : variant === 'danger'
          ? 'onWarning'
          : 'text';
  const indicatorColor =
    variant === 'primary'
      ? colors.onPrimary
      : variant === 'secondary'
        ? colors.primary
        : variant === 'danger'
          ? colors.onWarning
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
          minHeight: height,
          paddingVertical,
          borderRadius: radius.md,
          backgroundColor: disabled ? colors.border : backgroundColor,
          borderWidth: variant === 'ghost' ? 1 : borderWidth,
          borderColor: variant === 'ghost' ? colors.border : borderColor,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
          paddingHorizontal: spacing.xl,
          opacity: disabled ? 0.6 : 1,
        },
        // primary — с мягкой тенью (в тёмной не видно — глубина не нужна,
        // заливка сама контрастна); остальные варианты — плоские.
        variant === 'primary' && !disabled ? shadow[mode] : null,
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

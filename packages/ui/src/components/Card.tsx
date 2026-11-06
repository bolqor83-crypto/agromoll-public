/**
 * Card — карточка дизайн-системы: скругление 16, мягкая тень, тёплая рамка.
 * Фото, название, цена, бейдж — минимум текста (ADR-002).
 *
 * v0.6.2-B (ADR-028):
 * - скругление radius.md (16) — единый «радиус-язык»: карточки 16,
 *   модалки 20, бейджи pill;
 * - глубина: в светлой теме — заметнее тень + на web многослойная
 *   (boxShadowWeb: контакт + рассеяние); в тёмной — тень не работает,
 *   глубину даёт усиленная рамка borderStrong (elevation через цвет);
 * - состояния: нажатие — spring scale 0.98 (как раньше), фокус —
 *   обводка 2px primary (клавиатура/web), disabled — opacity 0.5.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Platform, Pressable, View } from 'react-native';
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
  /** Недоступная карточка: полупрозрачность, без нажатия. */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Card({
  children,
  onPress,
  padding = spacing.lg,
  elevated = false,
  disabled = false,
  style,
}: CardProps) {
  const { colors, mode } = useTheme();
  const scale = useSharedValue(1);
  // Фокус с клавиатуры (web/Bluetooh-клавиатуры): обводка 2px primary.
  const [focused, setFocused] = useState(false);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Тёмная тема: тени не видны — глубина через усиленную рамку (ADR-030).
  const isDark = mode === 'dark';
  const borderColor = focused ? colors.primary : isDark ? colors.borderStrong : colors.border;
  const borderWidth = focused ? 2 : 1;

  const baseStyle: StyleProp<ViewStyle> = [
    {
      backgroundColor: elevated ? colors.surfaceElevated : colors.surface,
      borderRadius: radius.md,
      borderWidth,
      borderColor,
      padding,
    },
    !isDark ? shadow.light : null,
    // web: многослойная тень из токена (в тёмной — 'none', рамка берёт своё)
    Platform.OS === 'web' && !isDark ? { boxShadow: shadow.light.boxShadowWeb } : null,
    disabled ? { opacity: 0.5 } : null,
    style,
  ];

  if (!onPress || disabled) {
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
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      style={[animatedStyle, baseStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}

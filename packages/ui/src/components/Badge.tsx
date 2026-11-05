/**
 * Badge — мягкий бейдж-«пилюля»: зелёный (успех), янтарный (срочность),
 * нейтральный. Без резких цветов: срочность не должна тревожить в 4 утра.
 *
 * v0.3.1: смена статуса (варианта или текста) — плавный переход:
 * цвет заливки морфится 300 мс, текст перекрёстно проявляется
 * (старый гаснет, новый проявляется). Статус брони «живёт», а не
 * телепортируется — глаз замечает изменение, не пугаясь вспышки.
 */
import { useEffect } from 'react';
import Animated, {
  FadeIn,
  FadeOut,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';
import { motion, radius, spacing } from '../tokens';

export interface BadgeProps {
  label: string;
  /** success — зелёный, attention — мягкий янтарный, neutral — серо-тёплый. */
  variant?: 'success' | 'attention' | 'neutral';
}

/** Прозрачность заливки янтарного бейджа (~18%), чтобы он оставался мягким. */
const ATTENTION_BG_ALPHA = '2E';

/** Длительность морфа цвета при смене статуса (токен motion.normal). */
const COLOR_MORPH_MS = motion.normal;

/** Номер варианта на шкале интерполяции цвета: 0 / 1 / 2. */
function variantScale(variant: BadgeProps['variant']): number {
  return variant === 'success' ? 1 : variant === 'attention' ? 2 : 0;
}

export function Badge({ label, variant = 'neutral' }: BadgeProps) {
  const { colors } = useTheme();

  // Цвет анимируем числом по шкале вариантов (0/1/2), а сам цвет достаёт
  // interpolateColor в worklet — непрерывный морф без ступенек.
  const variantValue = useSharedValue(variantScale(variant));

  useEffect(() => {
    variantValue.value = withTiming(variantScale(variant), { duration: COLOR_MORPH_MS });
  }, [variant, variantValue]);

  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      variantValue.value,
      [0, 1, 2],
      [colors.background, colors.primaryMuted, colors.warning + ATTENTION_BG_ALPHA],
    ),
  }));

  const fgColor =
    variant === 'success'
      ? colors.primary
      : variant === 'attention'
        ? colors.onWarning
        : colors.textSecondary;

  return (
    <Animated.View
      accessibilityLabel={label}
      style={[
        bgStyle,
        {
          borderRadius: radius.pill,
          paddingHorizontal: spacing.md,
          paddingVertical: 3,
          borderWidth: variant === 'neutral' ? 1 : 0,
          borderColor: colors.border,
          alignSelf: 'flex-start',
        },
      ]}
    >
      {/* Текст — перекрёстный fade при смене: ключ меняется вместе с label. */}
      <Animated.Text
        key={label}
        entering={FadeIn.duration(COLOR_MORPH_MS)}
        exiting={FadeOut.duration(COLOR_MORPH_MS)}
        style={{
          fontSize: 13,
          lineHeight: 18,
          fontWeight: '600',
          color: fgColor,
        }}
      >
        {label}
      </Animated.Text>
    </Animated.View>
  );
}

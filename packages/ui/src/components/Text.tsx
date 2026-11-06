/** Text — типографика дизайн-системы. Один компонент на все тексты приложения. */
import type { ReactNode } from 'react';
import { Text as RNText } from 'react-native';
import type { TextProps as RNTextProps, StyleProp, TextStyle } from 'react-native';
import { useTheme } from '../theme';
import { fontFamilyForWeight, typography } from '../tokens';
import type { ThemeColors, TextVariant } from '../tokens';

export type TextColor =
  | 'text'
  | 'secondary'
  | 'muted'
  | 'primary'
  | 'accent'
  | 'warning'
  | 'onWarning'
  | 'onPrimary'
  | 'inverse';

const COLOR_ACCESSORS: Record<TextColor, (colors: ThemeColors) => string> = {
  text: (c) => c.text,
  secondary: (c) => c.textSecondary,
  muted: (c) => c.textMuted,
  primary: (c) => c.primary,
  accent: (c) => c.accent,
  warning: (c) => c.warning,
  onWarning: (c) => c.onWarning,
  onPrimary: (c) => c.onPrimary,
  inverse: (c) => c.surface,
};

export interface TextProps extends RNTextProps {
  /** Вариант типографики: display / title / body / caption / button. */
  variant?: TextVariant;
  color?: TextColor;
  align?: 'left' | 'center' | 'right';
  /** Переопределение насыщенности (по умолчанию — из варианта). */
  weight?: TextStyle['fontWeight'];
  /**
   * Табличные цифры (v0.6.2-B, ADR-028): ширина каждой цифры одинакова —
   * суммы, часы и рейтинги не «прыгают» при смене значения. Inter
   * поддерживает tnum (font-variant-numeric: tabular-nums).
   */
  numeric?: boolean;
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}

export function Text({
  variant = 'body',
  color = 'text',
  align,
  weight,
  numeric = false,
  style,
  children,
  ...rest
}: TextProps) {
  const { colors } = useTheme();
  const t = typography[variant];

  return (
    <RNText
      style={[
        {
          fontFamily: fontFamilyForWeight(weight ?? t.fontWeight),
          fontSize: t.fontSize,
          lineHeight: t.lineHeight,
          fontWeight: weight ?? t.fontWeight,
          color: COLOR_ACCESSORS[color](colors),
          ...(t.letterSpacing ? { letterSpacing: t.letterSpacing } : null),
          ...(numeric ? { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] } : null),
        },
        align ? { textAlign: align } : null,
        style,
      ]}
      {...rest}
    >
      {children}
    </RNText>
  );
}

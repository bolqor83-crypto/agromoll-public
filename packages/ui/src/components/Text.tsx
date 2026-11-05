/** Text — типографика дизайн-системы. Один компонент на все тексты приложения. */
import type { ReactNode } from 'react';
import { Text as RNText } from 'react-native';
import type { TextProps as RNTextProps, StyleProp, TextStyle } from 'react-native';
import { useTheme } from '../theme';
import { typography } from '../tokens';
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
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}

export function Text({
  variant = 'body',
  color = 'text',
  align,
  weight,
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
          fontSize: t.fontSize,
          lineHeight: t.lineHeight,
          fontWeight: weight ?? t.fontWeight,
          color: COLOR_ACCESSORS[color](colors),
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

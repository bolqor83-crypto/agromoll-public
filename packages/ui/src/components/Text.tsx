import React from 'react';
import { Text as RNText } from 'react-native';
import type { StyleProp, TextProps as RNTextProps, TextStyle } from 'react-native';

import { useTheme } from '../theme/ThemeContext';
import type { TypographyVariant } from '../tokens';

export type TextColor =
  | 'default'
  | 'secondary'
  | 'muted'
  | 'primary'
  | 'onPrimary'
  | 'warning'
  | 'inverse';

export interface TextProps extends RNTextProps {
  /** Вариант типографики из токенов. */
  variant?: TypographyVariant;
  /** Семантический цвет из палитры темы. */
  color?: TextColor;
  align?: 'auto' | 'left' | 'center' | 'right';
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
}

export function Text({
  variant = 'body',
  color = 'default',
  align,
  style,
  ...rest
}: TextProps) {
  const { colors, typography } = useTheme();

  const colorValue = {
    default: colors.text,
    secondary: colors.textSecondary,
    muted: colors.textMuted,
    primary: colors.primary,
    onPrimary: colors.onPrimary,
    warning: colors.warning,
    inverse: colors.background,
  }[color];

  return (
    <RNText
      style={[
        typography[variant],
        { color: colorValue },
        align ? { textAlign: align } : null,
        style,
      ]}
      {...rest}
    />
  );
}

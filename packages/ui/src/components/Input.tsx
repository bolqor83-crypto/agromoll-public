/**
 * Input — поле ввода: крупное (52 px), скруглённое, с мягкой рамкой.
 * Ошибки — янтарным (красный запрещён, ADR-002).
 */
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { useTheme } from '../theme';
import { radius, spacing, typography } from '../tokens';
import { Text } from './Text';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
  hint?: string | null;
}

export function Input({ label, error, hint, style, ...rest }: InputProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error ? colors.warning : focused ? colors.primary : colors.border;

  return (
    <View style={{ gap: spacing.sm }}>
      {label ? (
        <Text variant="caption" color="secondary">
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={colors.textMuted}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        accessibilityLabel={label ?? rest.accessibilityLabel ?? rest.placeholder}
        style={[
          {
            minHeight: 52,
            borderRadius: radius.md,
            borderWidth: 1.5,
            borderColor,
            backgroundColor: colors.surface,
            paddingHorizontal: spacing.lg,
            fontSize: typography.body.fontSize,
            lineHeight: typography.body.lineHeight,
            color: colors.text,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text variant="caption" color="onWarning" weight="600">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

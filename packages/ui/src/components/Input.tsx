import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import type { StyleProp, TextInputProps, ViewStyle } from 'react-native';

import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../tokens';
import { Text } from './Text';

export interface InputProps extends TextInputProps {
  /** Подпись поля сверху (например, «Что нужно найти?»). */
  label?: string;
  /** Подсказка снизу (ошибки/подсказки). */
  helperText?: string;
  /** helperText в янтарном тоне — внимание без тревоги. */
  helperTone?: 'default' | 'warning';
  containerStyle?: StyleProp<ViewStyle>;
}

/** Крупное поле ввода: высота 56 px — удобно попасть пальцем в перчатке. */
export function Input({
  label,
  helperText,
  helperTone = 'default',
  containerStyle,
  style,
  onFocus,
  onBlur,
  ...rest
}: InputProps) {
  const { colors, radius } = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = focused ? colors.primary : colors.border;

  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="caption" color="secondary" style={styles.label}>
          {label}
        </Text>
      ) : null}

      <TextInput
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.primary}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            borderColor,
            borderRadius: radius.md,
            color: colors.text,
          },
          style,
        ]}
        {...rest}
      />

      {helperText ? (
        <Text
          variant="caption"
          color={helperTone === 'warning' ? 'warning' : 'muted'}
          style={styles.helper}
        >
          {helperText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: spacing.sm,
  },
  input: {
    minHeight: 56,
    borderWidth: 1.5,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 17,
    lineHeight: 24,
  },
  helper: {
    marginTop: spacing.xs + 2,
  },
});

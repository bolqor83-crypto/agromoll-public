import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '../theme/ThemeContext';
import { spacing } from '../tokens';
import { Text } from './Text';

export type BadgeVariant = 'neutral' | 'primary' | 'warning';

export interface BadgeProps {
  /** Текст бейджа — короткий, на языке рынка («Мало», «Свежая», «Предоплата»). */
  label: string;
  variant?: BadgeVariant;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Компактный бейдж-статус. Вариант warning — мягкий янтарный, не тревожный. */
export function Badge({ label, variant = 'neutral', style, testID }: BadgeProps) {
  const { colors, radius } = useTheme();

  const palette: Record<BadgeVariant, { bg: string; fg: string; border?: string }> = {
    neutral: {
      bg: colors.surfaceElevated,
      fg: colors.textSecondary,
      border: colors.border,
    },
    primary: { bg: colors.primaryMuted, fg: colors.primary },
    warning: { bg: colors.warningSoft, fg: colors.warning },
  };

  const { bg, fg, border } = palette[variant];

  return (
    <View
      testID={testID}
      style={[
        styles.container,
        {
          backgroundColor: bg,
          borderRadius: radius.pill,
          borderColor: border,
        },
        style,
      ]}
    >
      <Text variant="caption" style={{ color: fg, fontWeight: '600', letterSpacing: 0.1 }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 28,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderWidth: 1,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
});

import { View } from 'react-native';
import type { ReactNode } from 'react';
import { spacing, Text } from '@agromoll/ui';
import { ThemeToggle } from './ThemeToggle';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
}

/** Шапка экрана: крупный заголовок, подзаголовок, бейдж статуса и переключатель темы. */
export function ScreenHeader({ title, subtitle, badge }: ScreenHeaderProps) {
  return (
    <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="display">{title}</Text>
        <ThemeToggle />
      </View>
      {subtitle ? (
        <Text variant="body" color="secondary">
          {subtitle}
        </Text>
      ) : null}
      {badge ? <View style={{ marginTop: spacing.xs }}>{badge}</View> : null}
    </View>
  );
}

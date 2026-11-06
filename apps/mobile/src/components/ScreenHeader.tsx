import { Pressable, View } from 'react-native';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Icon, radius, selection, spacing, Text, useTheme } from '@agromoll/ui';
import { ThemeToggle } from './ThemeToggle';
import { ConnectionBadge } from './ConnectionBadge';
import { useAuthStore } from '@/store/auth';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
}

/** Шапка экрана: крупный заголовок, подзаголовок, бейдж, смена роли и темы. */
export function ScreenHeader({ title, subtitle, badge }: ScreenHeaderProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const role = useAuthStore((s) => s.user?.role ?? null);

  return (
    <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.sm,
        }}
      >
        <Text variant="display" style={{ flexShrink: 1 }}>
          {title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <ConnectionBadge />
          <ThemeToggle />
        </View>
      </View>
      {subtitle ? (
        <Text variant="body" color="secondary">
          {subtitle}
        </Text>
      ) : null}
      {badge ? <View style={{ marginTop: spacing.xs }}>{badge}</View> : null}
      {role ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Сменить роль"
          onPress={() => {
            selection();
            router.push('/');
          }}
          style={{
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            marginTop: spacing.xs,
            paddingHorizontal: spacing.md,
            // v0.6.2-B: 48 px — минимальная зона нажатия (было 40)
            height: 48,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Icon name="swap-horizontal-outline" size={18} color="secondary" />
          <Text variant="caption" weight="600" color="secondary">
            Сменить роль
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

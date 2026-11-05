import { Pressable, View } from 'react-native';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Icon, radius, spacing, Text, useTheme } from '@agromoll/ui';
import { ThemeToggle } from './ThemeToggle';
import { useRoleStore } from '@/store/role';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
}

/** Шапка экрана: крупный заголовок, подзаголовок, бейдж, смена роли и темы. */
export function ScreenHeader({ title, subtitle, badge }: ScreenHeaderProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const role = useRoleStore((s) => s.role);

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
      {role ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Сменить роль"
          onPress={() => {
            void Haptics.selectionAsync().catch(() => undefined);
            router.push('/');
          }}
          style={{
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            marginTop: spacing.xs,
            paddingHorizontal: spacing.md,
            height: 40,
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

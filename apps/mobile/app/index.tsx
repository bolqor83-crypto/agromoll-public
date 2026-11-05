import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Card, Icon, Screen, spacing, Text } from '@agromoll/ui';
import type { IconName } from '@agromoll/ui';
import { ROLE_LABELS } from '@agromoll/types';
import type { UserRole } from '@agromoll/types';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components';
import { useRoleStore } from '@/store/role';

interface RoleOption {
  role: UserRole;
  icon: IconName;
  description: string;
  route: string;
}

const OPTIONS: RoleOption[] = [
  {
    role: 'buyer',
    icon: 'basket-outline',
    description: 'Лента товаров и мои брони',
    route: '/(buyer)/feed',
  },
  {
    role: 'seller',
    icon: 'storefront-outline',
    description: 'Витрина лотов и входящие брони',
    route: '/(seller)/showcase',
  },
  {
    role: 'driver',
    icon: 'car-outline',
    description: 'Попутные заказы по пути',
    route: '/(driver)/radar',
  },
];

/**
 * Выбор роли — вход в приложение (v0.2.0).
 * На следующем этапе роль придёт с сервера после входа по телефону.
 */
export default function RolePickerScreen() {
  const router = useRouter();
  const setRole = useRoleStore((s) => s.setRole);

  return (
    <Screen>
      <ScreenHeader title="АгроМолл" subtitle="Оптовый рынок Ростова-на-Дону · утренняя смена" />
      <Text variant="body" color="secondary" style={{ marginBottom: spacing.lg }}>
        Выберите роль для работы:
      </Text>
      <View style={{ gap: spacing.md }}>
        {OPTIONS.map((option) => (
          <Card
            key={option.role}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              setRole(option.role);
              router.replace(option.route);
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          >
            <Icon name={option.icon} size={28} color="primary" />
            <View style={{ flex: 1 }}>
              <Text variant="title">{ROLE_LABELS[option.role]}</Text>
              <Text variant="caption" color="secondary">
                {option.description}
              </Text>
            </View>
            <Icon name="chevron-forward-outline" size={20} color="muted" />
          </Card>
        ))}
      </View>
      <Text variant="caption" color="muted" align="center" style={{ marginTop: spacing.lg }}>
        Роль можно сменить в любой момент — кнопка «Сменить роль» на экранах.
      </Text>
    </Screen>
  );
}

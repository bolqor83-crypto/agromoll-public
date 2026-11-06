import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Card, Icon, Screen, selection, spacing, Text } from '@agromoll/ui';
import type { IconName } from '@agromoll/ui';
import { ROLE_LABELS } from '@agromoll/types';
import type { UserRole } from '@agromoll/types';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAuthStore } from '@/store/auth';
import { logger } from '@/lib/logger';

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
 * Выбор роли (v0.3.0): роль сохраняется на сервере через PATCH
 * /users/me/role, поэтому доступна с любого устройства пользователя.
 * Экран показывается только аутентифицированным (гейт в root layout).
 */
export default function RolePickerScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const changeRole = useAuthStore((s) => s.changeRole);

  const handleSelect = (option: RoleOption): void => {
    selection();
    changeRole(option.role)
      .then(() => {
        router.replace(option.route);
      })
      .catch((error) => {
        logger.warn('role', 'не удалось сменить роль', { error: String(error) });
        // даже при ошибке открываем экран роли — оффлайн-ядро догонит
        router.replace(option.route);
      });
  };

  return (
    <Screen>
      <ScreenHeader
        title="АгроМолл"
        subtitle={
          user ? `${user.displayName} · выберите роль для работы` : 'Оптовый рынок Ростова-на-Дону'
        }
      />
      <Text variant="body" color="secondary" style={{ marginBottom: spacing.lg }}>
        Роль сохраняется в профиле и действует сразу после выбора:
      </Text>
      <View style={{ gap: spacing.md }}>
        {OPTIONS.map((option) => (
          <Card
            key={option.role}
            onPress={() => handleSelect(option)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          >
            <Icon name={option.icon} size={28} color="primary" />
            <View style={{ flex: 1 }}>
              <Text variant="title">{ROLE_LABELS[option.role]}</Text>
              <Text variant="caption" color="secondary">
                {option.description}
              </Text>
            </View>
            {user?.role === option.role ? (
              <Icon name="checkmark-circle-outline" size={22} color="primary" />
            ) : (
              <Icon name="chevron-forward-outline" size={20} color="muted" />
            )}
          </Card>
        ))}
      </View>

      {/* Мой рейтинг — вход с любой роли (v0.5.0, ADR-013). */}
      <Card
        onPress={() => {
          selection();
          router.push('/reputation');
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm }}
      >
        <Icon name="star-outline" size={28} color="primary" />
        <View style={{ flex: 1 }}>
          <Text variant="title">Мой рейтинг</Text>
          <Text variant="caption" color="secondary">
            Скор по сделкам, история событий
          </Text>
        </View>
        <Icon name="chevron-forward-outline" size={20} color="muted" />
      </Card>

      {/* Карта рынка — геозоны (v0.5.0, ADR-014). */}
      <Card
        onPress={() => {
          selection();
          router.push('/map');
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm }}
      >
        <Icon name="map-outline" size={28} color="primary" />
        <View style={{ flex: 1 }}>
          <Text variant="title">Карта рынка</Text>
          <Text variant="caption" color="secondary">
            Кто рядом, линии продавцов, маршруты
          </Text>
        </View>
        <Icon name="chevron-forward-outline" size={20} color="muted" />
      </Card>

      <Text variant="caption" color="muted" align="center" style={{ marginTop: spacing.lg }}>
        Роль можно сменить в любой момент — кнопка «Сменить роль» на экранах.
      </Text>
    </Screen>
  );
}

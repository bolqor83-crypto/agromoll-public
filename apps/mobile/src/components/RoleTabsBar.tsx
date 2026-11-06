import { useCallback } from 'react';
import type { ReactNode } from 'react';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabBar, spacing } from '@agromoll/ui';
import type { TabBarItem } from '@agromoll/ui';

/**
 * Адаптер expo-router Tabs → TabBar дизайн-системы.
 *
 * expo-router отдаёт свои пропсы в tabBar, а мы рисуем панель
 * с pill-индикатором (ADR-005). Подписи и иконки вкладок каждой роли
 * задаются в routeNameToLabel/routeNameToIcon. v0.3.1: тактильный отклик
 * и анимация иконок живут внутри TabBar (ADR-009) — здесь только навигация.
 */
export function RoleTabsBar({ state, navigation }: BottomTabBarProps): ReactNode {
  const insets = useSafeAreaInsets();

  const items: TabBarItem[] = state.routes.map((route) => ({
    key: route.key,
    label: routeNameToLabel(route.name),
    icon: routeNameToIcon(route.name),
  }));

  const handleChange = useCallback(
    (key: string) => {
      const route = state.routes.find((r) => r.key === key);
      if (!route || route.key === state.routes[state.index]?.key) {
        return; // повторное нажатие активной вкладки — ничего не делаем
      }
      navigation.navigate(route.name, route.params);
    },
    [state, navigation],
  );

  const activeKey = state.routes[state.index]?.key ?? items[0]?.key ?? '';

  return (
    <TabBar
      items={items}
      activeKey={activeKey}
      onChange={handleChange}
      style={{ paddingBottom: Math.max(spacing.xs, insets.bottom) }}
    />
  );
}

function routeNameToLabel(name: string): string {
  const labels: Record<string, string> = {
    feed: 'Лента',
    bookings: 'Мои брони',
    debts: 'Долги',
    hours: 'Часы',
    showcase: 'Витрина',
    inbox: 'Входящие',
    radar: 'Радар',
    deliveries: 'Мои доставки',
    delivery: 'Доставка',
  };
  return labels[name] ?? name;
}

function routeNameToIcon(name: string): TabBarItem['icon'] {
  const icons: Record<string, TabBarItem['icon']> = {
    feed: 'basket-outline',
    bookings: 'bookmark-outline',
    debts: 'wallet-outline',
    hours: 'time-outline',
    showcase: 'storefront-outline',
    inbox: 'mail-outline',
    radar: 'locate-outline',
    deliveries: 'car-outline',
    delivery: 'cube-outline',
  };
  return icons[name] ?? 'ellipse-outline';
}

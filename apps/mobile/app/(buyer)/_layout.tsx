import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { RoleTabsBar } from '@/components/RoleTabsBar';
import { prefetchBuyerTabs } from '@/lib/prefetch';

/**
 * Покупатель: «Лента» / «Мои брони» / «Доставка» / «Долги» (v0.5.0).
 * Панель вкладок — дизайн-система (ADR-005).
 *
 * v0.6.1-A: при входе в роль прогреваем чанки вкладок (ADR-023) —
 * первый переход по любой вкладке происходит без сетевой паузы.
 */
export default function BuyerTabsLayout() {
  useEffect(() => {
    void prefetchBuyerTabs();
  }, []);

  return (
    <Tabs tabBar={(props) => <RoleTabsBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="feed" />
      <Tabs.Screen name="bookings" />
      <Tabs.Screen name="delivery" />
      <Tabs.Screen name="debts" />
    </Tabs>
  );
}

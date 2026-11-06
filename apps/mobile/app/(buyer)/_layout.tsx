import { Tabs } from 'expo-router';
import { RoleTabsBar } from '@/components/RoleTabsBar';

/**
 * Покупатель: «Лента» / «Мои брони» / «Доставка» / «Долги» (v0.5.0).
 * Панель вкладок — дизайн-система (ADR-005).
 */
export default function BuyerTabsLayout() {
  return (
    <Tabs tabBar={(props) => <RoleTabsBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="feed" />
      <Tabs.Screen name="bookings" />
      <Tabs.Screen name="delivery" />
      <Tabs.Screen name="debts" />
    </Tabs>
  );
}

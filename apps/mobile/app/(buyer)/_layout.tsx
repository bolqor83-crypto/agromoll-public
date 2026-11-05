import { Tabs } from 'expo-router';
import { RoleTabsBar } from '@/components/RoleTabsBar';

/** Покупатель: «Лента» / «Мои брони». Панель вкладок — дизайн-система (ADR-005). */
export default function BuyerTabsLayout() {
  return (
    <Tabs tabBar={(props) => <RoleTabsBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="feed" />
      <Tabs.Screen name="bookings" />
    </Tabs>
  );
}

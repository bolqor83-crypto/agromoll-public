import { Tabs } from 'expo-router';
import { RoleTabsBar } from '@/components/RoleTabsBar';

/** Доставщик: «Радар» / «Мои доставки» (вторая — заглушка этапа). */
export default function DriverTabsLayout() {
  return (
    <Tabs tabBar={(props) => <RoleTabsBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="radar" />
      <Tabs.Screen name="deliveries" />
    </Tabs>
  );
}

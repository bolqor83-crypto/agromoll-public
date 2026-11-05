import { Tabs } from 'expo-router';
import { RoleTabsBar } from '@/components/RoleTabsBar';

/** Продавец: «Витрина» / «Входящие». Панель вкладок — дизайн-система (ADR-005). */
export default function SellerTabsLayout() {
  return (
    <Tabs tabBar={(props) => <RoleTabsBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="showcase" />
      <Tabs.Screen name="inbox" />
    </Tabs>
  );
}

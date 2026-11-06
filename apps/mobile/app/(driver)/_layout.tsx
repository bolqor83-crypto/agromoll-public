import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { RoleTabsBar } from '@/components/RoleTabsBar';
import { prefetchDriverTabs } from '@/lib/prefetch';

/** Доставщик: «Радар» / «Мои доставки» / «Часы» (v0.5.0). */
export default function DriverTabsLayout() {
  // v0.6.1-A: прогрев чанков вкладок роли (ADR-023).
  useEffect(() => {
    void prefetchDriverTabs();
  }, []);

  return (
    <Tabs tabBar={(props) => <RoleTabsBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="radar" />
      <Tabs.Screen name="deliveries" />
      <Tabs.Screen name="hours" />
    </Tabs>
  );
}

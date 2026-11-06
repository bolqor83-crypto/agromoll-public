import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { RoleTabsBar } from '@/components/RoleTabsBar';
import { RoleCoachMark } from '@/components/RoleCoachMark';
import { prefetchDriverTabs } from '@/lib/prefetch';

/** Доставщик: «Радар» / «Мои доставки» / «Часы» (v0.5.0). */
export default function DriverTabsLayout() {
  // v0.6.1-A: прогрев чанков вкладок роли (ADR-023).
  useEffect(() => {
    void prefetchDriverTabs();
  }, []);

  return (
    <>
      <Tabs tabBar={(props) => <RoleTabsBar {...props} />} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="radar" />
        <Tabs.Screen name="deliveries" />
        <Tabs.Screen name="hours" />
      </Tabs>
      {/* v0.6.2-C: подсказки первого входа в роль (ADR-029), не блокируют */}
      <RoleCoachMark role="driver" />
    </>
  );
}

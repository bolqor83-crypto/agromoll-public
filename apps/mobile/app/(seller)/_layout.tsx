import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { RoleTabsBar } from '@/components/RoleTabsBar';
import { RoleCoachMark } from '@/components/RoleCoachMark';
import { prefetchSellerTabs } from '@/lib/prefetch';

/** Продавец: «Витрина» / «Входящие» / «Долги» / «Часы» (v0.4.0). */
export default function SellerTabsLayout() {
  // v0.6.1-A: прогрев чанков вкладок роли (ADR-023).
  useEffect(() => {
    void prefetchSellerTabs();
  }, []);

  return (
    <>
      <Tabs tabBar={(props) => <RoleTabsBar {...props} />} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="showcase" />
        <Tabs.Screen name="inbox" />
        <Tabs.Screen name="debts" />
        <Tabs.Screen name="hours" />
      </Tabs>
      {/* v0.6.2-C: подсказки первого входа в роль (ADR-029), не блокируют */}
      <RoleCoachMark role="seller" />
    </>
  );
}

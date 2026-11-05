import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  Badge,
  EmptyState,
  PullToRefreshScrollView,
  Screen,
  SkeletonCard,
  spacing,
} from '@agromoll/ui';
import type { BookingDto } from '@agromoll/types';
import { ScreenHeader } from '@/components';
import { IncomingBookingCard } from '@/components/IncomingBookingCard';
import { api } from '@/lib/api';
import { logger } from '@/lib/logger';
import { DEMO_BUYER_BOOKINGS } from '@/lib/demo-data';
import { demoUserId } from '@/store/role';

type InboxState = { phase: 'loading' } | { phase: 'ready'; bookings: BookingDto[]; demo: boolean };

/**
 * Входящие брони продавца: подтверждить / предложить корректировку / отклонить.
 */
export default function InboxScreen() {
  const [state, setState] = useState<InboxState>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const bookings = await api.bookings(demoUserId('seller'));
      setState({ phase: 'ready', bookings, demo: false });
    } catch (error) {
      logger.warn('inbox', 'API недоступен, показываем демо-входящие', { error: String(error) });
      setState({ phase: 'ready', bookings: DEMO_BUYER_BOOKINGS, demo: true });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback((): void => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const pendingCount =
    state.phase === 'ready'
      ? state.bookings.filter((b) => b.status === 'requested' || b.status === 'counter_offered')
          .length
      : 0;

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Входящие"
        subtitle="Брони покупателей по вашим лотам"
        badge={
          state.phase === 'ready' && state.demo ? (
            <Badge label="Демо-данные · API недоступен" variant="attention" />
          ) : pendingCount > 0 ? (
            <Badge label={`Ждут решения: ${pendingCount}`} variant="attention" />
          ) : undefined
        }
      />
      {state.phase === 'loading' ? (
        <View style={{ gap: spacing.md }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : state.bookings.length === 0 ? (
        <EmptyState
          illustration="calendar"
          title="Новых броней нет"
          description="Как только покупатель забронирует ваш лот, заявка появится здесь."
          action={{ label: 'Обновить', onPress: handleRefresh }}
        />
      ) : (
        <PullToRefreshScrollView
          refreshing={refreshing}
          onRefresh={handleRefresh}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            padding: spacing.lg,
            gap: spacing.md,
            paddingBottom: spacing.xxl,
          }}
        >
          {state.bookings.map((booking) => (
            <IncomingBookingCard
              key={booking.id}
              booking={booking}
              userId={demoUserId('seller')}
              onChanged={() => void load()}
              demo={state.demo}
            />
          ))}
        </PullToRefreshScrollView>
      )}
    </Screen>
  );
}

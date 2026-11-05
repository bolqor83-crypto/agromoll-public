import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
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
import { BookingCard } from '@/components/BookingCard';
import { api } from '@/lib/api';
import { logger } from '@/lib/logger';
import { DEMO_BUYER_BOOKINGS, DEMO_COUNTER_OFFERS } from '@/lib/demo-data';
import { demoUserId } from '@/store/role';

type BookingsState =
  { phase: 'loading' } | { phase: 'ready'; bookings: BookingDto[]; demo: boolean };

/**
 * «Мои брони» покупателя: статусы пилюлями (запрошено/уточняется/подтверждено),
 * кнопки «Принять предложение» и «Отменить», pull-to-refresh.
 */
export default function MyBookingsScreen() {
  const router = useRouter();
  const [state, setState] = useState<BookingsState>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const bookings = await api.bookings(demoUserId('buyer'));
      setState({ phase: 'ready', bookings, demo: false });
    } catch (error) {
      logger.warn('bookings', 'API недоступен, показываем демо-брони', { error: String(error) });
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

  const activeCount =
    state.phase === 'ready'
      ? state.bookings.filter(
          (b) =>
            b.status === 'requested' || b.status === 'counter_offered' || b.status === 'confirmed',
        ).length
      : 0;

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Мои брони"
        subtitle="Запросы, корректировки и подтверждения"
        badge={
          state.phase === 'ready' && state.demo ? (
            <Badge label="Демо-данные · API недоступен" variant="attention" />
          ) : activeCount > 0 ? (
            <Badge label={`Активных: ${activeCount}`} variant="success" />
          ) : undefined
        }
      />
      {state.phase === 'loading' ? (
        <SkeletonCard />
      ) : state.bookings.length === 0 ? (
        <EmptyState
          illustration="calendar"
          title="Заявок пока нет"
          description="Найдите товар в ленте и забронируйте — продавец подтвердит за полчаса."
          action={{ label: 'К ленте', onPress: () => router.push('/(buyer)/feed') }}
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
            <BookingCard
              key={booking.id}
              booking={booking}
              userId={demoUserId('buyer')}
              counterOffer={DEMO_COUNTER_OFFERS[booking.id]}
              onChanged={() => void load()}
              demo={state.demo}
            />
          ))}
        </PullToRefreshScrollView>
      )}
    </Screen>
  );
}

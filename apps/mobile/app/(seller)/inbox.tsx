import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { api, isInvalidResponseError } from '@/lib/api';
import { logger } from '@/lib/logger';
import { DEMO_BUYER_BOOKINGS } from '@/lib/demo-data';
import { useOutboxStore } from '@/store/outbox';

type InboxState =
  | { phase: 'loading' }
  | { phase: 'invalid' }
  | { phase: 'ready'; bookings: BookingDto[]; demo: boolean };

/**
 * Входящие брони продавца: подтверждить / скорректировать / отклонить.
 * v0.3.0: действия идут через outbox (работают офлайн), статусы
 * оптимистично переопределяются локально, список перечитывается
 * по событиям очереди (version).
 */
export default function InboxScreen() {
  const [state, setState] = useState<InboxState>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const version = useOutboxStore((s) => s.version);
  const runSync = useOutboxStore((s) => s.runSync);
  const overrides = useOutboxStore((s) => s.overrides);

  const load = useCallback(async (): Promise<void> => {
    try {
      const bookings = await api.bookings();
      setState({ phase: 'ready', bookings, demo: false });
    } catch (error) {
      if (isInvalidResponseError(error)) {
        setState({ phase: 'invalid' });
        return;
      }
      logger.warn('inbox', 'API недоступен, показываем демо-входящие', { error: String(error) });
      setState({ phase: 'ready', bookings: DEMO_BUYER_BOOKINGS, demo: true });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  const handleRefresh = useCallback((): void => {
    setRefreshing(true);
    void runSync();
    void load().finally(() => setRefreshing(false));
  }, [load, runSync]);

  const merged = useMemo(() => {
    if (state.phase !== 'ready') {
      return [];
    }
    return state.bookings.map((booking) => {
      const override = overrides[booking.id];
      return override ? { ...booking, status: override.status } : booking;
    });
  }, [state, overrides]);

  const pendingCount = merged.filter(
    (b) => b.status === 'requested' || b.status === 'counter_offered',
  ).length;

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
      ) : state.phase === 'invalid' ? (
        <EmptyState
          illustration="calendar"
          title="Не удалось загрузить"
          description="Данные пришли в неожиданном формате. Попробуем ещё раз — просто потяните вниз."
          action={{ label: 'Попробовать ещё раз', onPress: handleRefresh }}
        />
      ) : merged.length === 0 ? (
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
          {merged.map((booking) => (
            <IncomingBookingCard
              key={booking.id}
              booking={booking}
              pendingLabel={overrides[booking.id] ? 'Ждёт сети' : undefined}
              demo={state.phase === 'ready' ? state.demo : false}
            />
          ))}
        </PullToRefreshScrollView>
      )}
    </Screen>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  Badge,
  EmptyState,
  ErrorState,
  PullToRefreshScrollView,
  Screen,
  SkeletonCard,
  spacing,
} from '@agromoll/ui';
import type { BookingDto } from '@agromoll/types';
import { ScreenHeader } from '@/components/ScreenHeader';
import { IncomingBookingCard } from '@/components/IncomingBookingCard';
import { api } from '@/lib/api';
import { errorContentFor } from '@/lib/error-content';
import { logger } from '@/lib/logger';
import { useOutboxStore } from '@/store/outbox';

/**
 * Конечный автомат «Входящих» (v0.6.1-D, ADR-026, вариант A — без фейков):
 *  - loading → skeleton;
 *  - error → ErrorState с «Повторить» (демо-входящие больше не показываем:
 *    продавец, глядя на выдуманные брони, может «подтвердить» то, чего нет);
 *  - ready → брони + локальные переопределения статусов.
 */
type InboxState =
  | { phase: 'loading' }
  | { phase: 'error'; error: unknown }
  | { phase: 'ready'; bookings: BookingDto[]; staleError?: unknown };

/**
 * Входящие брони продавца: подтвердить / скорректировать / отклонить.
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
      setState({ phase: 'ready', bookings });
    } catch (error) {
      logger.warn('inbox', 'входящие брони не загрузились', { error: String(error) });
      setState((prev) =>
        prev.phase === 'ready'
          ? { ...prev, staleError: error }
          : { phase: 'error', error },
      );
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

  // Тексты ошибок — из единого маппинга (ADR-026).
  const stale =
    state.phase === 'ready' && state.staleError !== undefined
      ? errorContentFor(state.staleError)
      : null;

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Входящие"
        subtitle="Брони покупателей по вашим лотам"
        badge={pendingCount > 0 ? <Badge label={`Ждут решения: ${pendingCount}`} variant="attention" /> : undefined}
      />
      {state.phase === 'loading' ? (
        <View style={{ gap: spacing.md }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : state.phase === 'error' ? (
        <ErrorState {...errorContentFor(state.error)} onRetry={handleRefresh} />
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
          {/* Рефреш не удался, но брони на экране — честно помечаем устаревание. */}
          {stale !== null ? (
            <ErrorState
              variant="inline"
              title="Данные могли устареть"
              description={stale.description}
              onRetry={handleRefresh}
            />
          ) : null}
          {merged.map((booking) => (
            <IncomingBookingCard
              key={booking.id}
              booking={booking}
              pendingLabel={overrides[booking.id] ? 'Ждёт сети' : undefined}
            />
          ))}
        </PullToRefreshScrollView>
      )}
    </Screen>
  );
}

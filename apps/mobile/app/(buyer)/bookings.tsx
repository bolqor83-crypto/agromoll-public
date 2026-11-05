import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  Badge,
  EmptyState,
  PullToRefreshScrollView,
  Screen,
  SkeletonCard,
  spacing,
  warning,
} from '@agromoll/ui';
import type { BookingDto, BookingStatus, ListingUnit } from '@agromoll/types';
import { ScreenHeader } from '@/components';
import { BookingCard } from '@/components/BookingCard';
import { api, isInvalidResponseError } from '@/lib/api';
import { logger } from '@/lib/logger';
import { DEMO_BUYER_BOOKINGS, DEMO_COUNTER_OFFERS } from '@/lib/demo-data';
import { useOutboxStore } from '@/store/outbox';

/** Задержка каскадного входа карточек броней (первая отрисовка, ADR-009). */
const STAGGER_MS = 40;
const STAGGER_CAP = 8;

type BookingsState =
  | { phase: 'loading' }
  | { phase: 'invalid' }
  | { phase: 'ready'; bookings: BookingDto[]; demo: boolean };

/** Подпись «Ждёт сети»: бронь создана офлайн или её статус переопределён локально. */
function pendingLabelFor(
  bookingId: string,
  overrides: Record<string, { status: BookingStatus; clientUuid: string }>,
): string | undefined {
  if (bookingId.startsWith('local-')) {
    return 'Ждёт сети';
  }
  return overrides[bookingId] ? 'Ждёт сети' : undefined;
}

/**
 * «Мои брони» покупателя (v0.3.0): оптимистичные состояния из офлайн-ядра —
 * локальные переопределения статусов и псевдо-карточки офлайн-броней —
 * мерджатся с серверными данными. Список перечитывается сам, когда
 * очередь outbox подтверждает операции (version).
 */
export default function MyBookingsScreen() {
  const router = useRouter();
  const [state, setState] = useState<BookingsState>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  // Каскадный вход — только первая отрисовка списка (ADR-009).
  const [firstEntrance, setFirstEntrance] = useState(true);
  // Предыдущие статусы: живая бронь стала «истекла» → мягкий warning-тактильный
  // сигнал один раз (не на каждый рендер).
  const prevStatuses = useRef<Map<string, BookingStatus>>(new Map());
  const ttlWarned = useRef(false);

  const version = useOutboxStore((s) => s.version);
  const runSync = useOutboxStore((s) => s.runSync);
  const overrides = useOutboxStore((s) => s.overrides);
  const pendingCreates = useOutboxStore((s) => s.pendingCreates);
  const pendingCount = useOutboxStore((s) => s.pendingCount);

  const load = useCallback(async (): Promise<void> => {
    try {
      const bookings = await api.bookings();
      setState({ phase: 'ready', bookings, demo: false });
    } catch (error) {
      if (isInvalidResponseError(error)) {
        setState({ phase: 'invalid' });
        return;
      }
      logger.warn('bookings', 'API недоступен, показываем демо-брони', { error: String(error) });
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

  /** Серверные брони + локальные override-статусы. */
  const merged = useMemo(() => {
    if (state.phase !== 'ready') {
      return [];
    }
    return state.bookings.map((booking) => {
      const override = overrides[booking.id];
      return override ? { ...booking, status: override.status } : booking;
    });
  }, [state, overrides]);

  /** Псевдо-карточки броней, созданных офлайн (ждут сервер). */
  const optimisticPending = useMemo<BookingDto[]>(() => {
    if (state.phase !== 'ready' || state.demo) {
      return [];
    }
    return Object.entries(pendingCreates).map(([clientUuid, create]) => ({
      id: `local-${clientUuid}`,
      listingId: create.listingId,
      listingTitle: create.listingTitle ?? 'Лот',
      listingUnit: create.listingUnit as ListingUnit | undefined,
      buyerId: 'me',
      requestedQuantity: create.requestedQuantity,
      confirmedQuantity: null,
      status: 'requested' as BookingStatus,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      createdAt: create.createdAt,
      updatedAt: create.createdAt,
    }));
  }, [state, pendingCreates]);

  const allBookings = useMemo(() => [...optimisticPending, ...merged], [optimisticPending, merged]);

  // Первая отрисовка карточек: после завершения каскада флаг гаснет.
  useEffect(() => {
    if (allBookings.length > 0) {
      const timer = setTimeout(() => setFirstEntrance(false), 700);
      return () => clearTimeout(timer);
    }
  }, [allBookings]);

  // Истечение TTL: живая бронь стала expired — мягкий сигнал один раз.
  useEffect(() => {
    if (state.phase !== 'ready') {
      return;
    }
    let expiredNow = false;
    for (const booking of merged) {
      const prev = prevStatuses.current.get(booking.id);
      const wasAlive = prev === 'requested' || prev === 'counter_offered' || prev === 'confirmed';
      if (wasAlive && booking.status === 'expired') {
        expiredNow = true;
      }
      prevStatuses.current.set(booking.id, booking.status);
    }
    if (expiredNow && !ttlWarned.current) {
      ttlWarned.current = true;
      warning();
    }
  }, [merged, state.phase]);

  const activeCount = allBookings.filter(
    (b) => b.status === 'requested' || b.status === 'counter_offered' || b.status === 'confirmed',
  ).length;

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
      ) : state.phase === 'invalid' ? (
        <EmptyState
          illustration="calendar"
          title="Не удалось загрузить"
          description="Данные пришли в неожиданном формате. Попробуем ещё раз — просто потяните вниз."
          action={{ label: 'Попробовать ещё раз', onPress: handleRefresh }}
        />
      ) : allBookings.length === 0 ? (
        <EmptyState
          illustration="calendar"
          title="Здесь появятся ваши заказы"
          description="Начните с ленты."
          action={{ label: 'В ленту', onPress: () => router.push('/(buyer)/feed') }}
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
          {allBookings.map((booking, index) => {
            const stagger = firstEntrance ? Math.min(index, STAGGER_CAP) * STAGGER_MS : 0;
            return (
              <Animated.View
                key={booking.id}
                entering={
                  stagger > 0
                    ? FadeInDown.delay(stagger).duration(300).springify().damping(16)
                    : undefined
                }
              >
                <BookingCard
                  booking={booking}
                  counterOffer={DEMO_COUNTER_OFFERS[booking.id]}
                  pendingLabel={pendingLabelFor(booking.id, overrides)}
                  demo={state.phase === 'ready' ? state.demo : false}
                />
              </Animated.View>
            );
          })}
          {pendingCount > 0 ? (
            <Badge label={`В очереди: ${pendingCount} · отправим при сети`} variant="attention" />
          ) : null}
        </PullToRefreshScrollView>
      )}
    </Screen>
  );
}

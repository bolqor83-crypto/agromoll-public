import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  Badge,
  EmptyState,
  ErrorState,
  PullToRefreshScrollView,
  Screen,
  SkeletonCard,
  spacing,
  warning,
} from '@agromoll/ui';
import type { BookingDto, BookingStatus, ListingUnit } from '@agromoll/types';
import { ScreenHeader } from '@/components/ScreenHeader';
import { BookingCard } from '@/components/BookingCard';
import { ConfirmDeliveryModal } from '@/components/ConfirmDeliveryModal';
import { OpenDisputeSheet } from '@/components/OpenDisputeSheet';
import { api, isInvalidResponseError } from '@/lib/api';
import { errorContentFor } from '@/lib/error-content';
import { logger } from '@/lib/logger';
import { useOutboxStore } from '@/store/outbox';
import { useNotificationStore } from '@/store/notifications';

/** Задержка каскадного входа карточек броней (первая отрисовка, ADR-009). */
const STAGGER_MS = 40;
const STAGGER_CAP = 8;

/**
 * Конечный автомат «Моих броней» (v0.6.1-D, ADR-026, вариант A — без фейков):
 *  - loading → skeleton;
 *  - error → ErrorState с «Повторить»; если на телефоне есть локальные
 *    офлайн-брони (outbox), они настоящие — показываем их вместе с ошибкой;
 *  - ready → серверные брони + локальные переопределения статусов.
 * Демо-карточки больше не показываем: брони — это деньги и обязательства,
 * выдуманные «успешные» брони обманывают покупателя.
 */
type BookingsState =
  | { phase: 'loading' }
  | { phase: 'error'; error: unknown }
  | { phase: 'ready'; bookings: BookingDto[]; staleError?: unknown };

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
  // Приёмка (v0.4.0-C): бронь, для которой открыта модалка подтверждения.
  const [confirming, setConfirming] = useState<BookingDto | null>(null);
  // Арбитраж (v0.6.0-C, ADR-033): бронь, по которой открывают спор.
  const [disputing, setDisputing] = useState<BookingDto | null>(null);
  // Предыдущие статусы: живая бронь стала «истекла» → мягкий warning-тактильный
  // сигнал один раз (не на каждый рендер).
  const prevStatuses = useRef<Map<string, BookingStatus>>(new Map());
  const ttlWarned = useRef(false);

  const version = useOutboxStore((s) => s.version);
  // v0.6.0-A (ADR-031): push-сигнал — экран перечитывает данные.
  const pushVersion = useNotificationStore((s) => s.version);
  const runSync = useOutboxStore((s) => s.runSync);
  const overrides = useOutboxStore((s) => s.overrides);
  const pendingCreates = useOutboxStore((s) => s.pendingCreates);
  const pendingCount = useOutboxStore((s) => s.pendingCount);

  const load = useCallback(async (): Promise<void> => {
    try {
      const bookings = await api.bookings();
      setState({ phase: 'ready', bookings });
    } catch (error) {
      // Одинаковая честность для любой ошибки (ADR-026): Network, 500,
      // INVALID_RESPONSE — всё это ErrorState с повтором, без фейков.
      logger.warn('bookings', 'брони не загрузились', {
        code: isInvalidResponseError(error) ? 'INVALID_RESPONSE' : String(error),
      });
      setState((prev) =>
        prev.phase === 'ready' ? { ...prev, staleError: error } : { phase: 'error', error },
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version, pushVersion]);

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
      confirmedAt: null,
      deliveryConfirmedAt: null,
      receivedQuantity: null,
      qualityNotes: null,
      qualityFlag: 'ok',
      createdAt: create.createdAt,
      updatedAt: create.createdAt,
    }));
  }, [pendingCreates]);

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

  // Тексты ошибок — из единого маппинга (ADR-026).
  const stale =
    state.phase === 'ready' && state.staleError !== undefined
      ? errorContentFor(state.staleError)
      : null;

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Мои брони"
        subtitle="Запросы, корректировки и подтверждения"
        badge={
          activeCount > 0 ? (
            <Badge label={`Активных: ${activeCount}`} variant="success" />
          ) : undefined
        }
      />
      {state.phase === 'loading' ? (
        <SkeletonCard />
      ) : state.phase === 'error' ? (
        optimisticPending.length > 0 ? (
          // Офлайн-брони настоящие: не прячем их за ошибкой.
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
            <ErrorState
              variant="inline"
              {...errorContentFor(state.error)}
              onRetry={handleRefresh}
            />
            {optimisticPending.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                pendingLabel="Ждёт сети"
                onConfirmDelivery={setConfirming}
                onOpenDispute={setDisputing}
              />
            ))}
          </PullToRefreshScrollView>
        ) : (
          <ErrorState {...errorContentFor(state.error)} onRetry={handleRefresh} />
        )
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
          {/* Рефреш не удался, но брони уже на экране — помечаем устаревание. */}
          {stale !== null ? (
            <ErrorState
              variant="inline"
              title="Данные могли устареть"
              description={stale.description}
              onRetry={handleRefresh}
            />
          ) : null}
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
                  pendingLabel={pendingLabelFor(booking.id, overrides)}
                  onConfirmDelivery={setConfirming}
                  onOpenDispute={setDisputing}
                />
              </Animated.View>
            );
          })}
          {pendingCount > 0 ? (
            <Badge label={`В очереди: ${pendingCount} · отправим при сети`} variant="attention" />
          ) : null}
        </PullToRefreshScrollView>
      )}

      {/* Приёмка (v0.4.0-C, ADR-012): confirmed → completed/disputed. */}
      <ConfirmDeliveryModal
        visible={confirming !== null}
        booking={confirming}
        onClose={() => setConfirming(null)}
      />

      {/* Арбитраж (v0.6.0-C, ADR-033): эскалация сделки нейтральному арбитру. */}
      <OpenDisputeSheet
        visible={disputing !== null}
        type="booking"
        referenceId={disputing?.id ?? ''}
        subject={disputing?.listingTitle ?? 'Бронь'}
        onClose={() => setDisputing(null)}
        onOpened={() => router.push('/disputes')}
      />
    </Screen>
  );
}

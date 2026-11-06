/**
 * Лента покупателя (v0.2.0 → v0.6.1-A): GET /listings со skeleton-загрузкой,
 * пустым состоянием и pull-to-refresh. v0.5.0-B: фильтр «Рядом со мной» — только продавцы,
 * чьи линии в радиусе (PostGIS, ADR-014), и кнопка «Моя точка».
 *
 * v0.6.1-A: экран переехал из app/(buyer)/feed.tsx в src/screens —
 * маршрут грузит его динамическим import() отдельным чанком (ADR-023).
 *
 * v0.6.1-D (ADR-026, вариант B): если API недоступен — демо-данные,
 * но честно: полноширинный янтарный DemoBanner «Демо-режим. API
 * недоступен. Данные не настоящие» + кнопки, которым нужен сервер,
 * отключены. Лента — «витрина продукта», демо здесь уместно;
 * INVALID_RESPONSE — не демо, а ErrorState с повтором.
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PullToRefreshScrollView,
  Screen,
  SkeletonCard,
  spacing,
  tap,
  useResponsive,
} from '@agromoll/ui';
import type { ListingDto } from '@agromoll/types';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { DebtSummaryWidget } from '@/components/DebtSummaryWidget';
import { DemoBanner } from '@/components/DemoBanner';
import { ListingCard } from '@/components/ListingCard';
import { MyPointSheet, MARKET_CENTER } from '@/components/MyPointSheet';
import { useAuthStore } from '@/store/auth';
import { api, isInvalidResponseError, toApiError } from '@/lib/api';
import { errorContentFor } from '@/lib/error-content';
import { logger } from '@/lib/logger';
import { DEMO_LISTINGS } from '@/lib/demo-data';

/** Задержка между появлением карточек (staggered entrance, ADR-009). */
const STAGGER_MS = 40;

/** Верхний предел задержки: даже у длинной ленты вход не затягивается. */
const STAGGER_CAP = 8;

/** Радиус фильтра «Рядом со мной» (DEFAULT_GEO_RADIUS_METERS, ADR-014). */
const NEARBY_RADIUS_M = 2000;

type FeedState =
  | { phase: 'loading' }
  | { phase: 'error'; error: unknown }
  | { phase: 'ready'; listings: ListingDto[]; demo: boolean; staleError?: unknown };

export function FeedScreen() {
  const router = useRouter();
  const role = useAuthStore((s) => s.user?.role ?? 'buyer');
  // v0.6.2-D: планшет ≥768 — лента в 2 колонки (ADR-030, аудит №15)
  const { isTablet } = useResponsive();
  const [state, setState] = useState<FeedState>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  // Каскадный вход — только на ПЕРВУЮ отрисовку карточек (ADR-009):
  // пока true, карточки входят с задержкой index×40 мс; после завершения
  // входа флаг гаснет — рефреш и новые данные приходят без «перескакивания».
  const [firstEntrance, setFirstEntrance] = useState(true);

  // Гео-фильтр (v0.5.0-B): null — выключен, Set — id продавцов рядом.
  const [nearbySellers, setNearbySellers] = useState<Set<string> | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [pointSheetOpen, setPointSheetOpen] = useState(false);

  useEffect(() => {
    if (state.phase === 'ready' && state.listings.length > 0) {
      const timer = setTimeout(() => setFirstEntrance(false), 700);
      return () => clearTimeout(timer);
    }
  }, [state]);

  const load = useCallback(async (): Promise<void> => {
    try {
      const listings = await api.listings();
      setState({ phase: 'ready', listings, demo: false });
    } catch (error) {
      if (isInvalidResponseError(error)) {
        // сервер ответил неожиданным форматом — демо-данные не показываем,
        // честный ErrorState с повтором (v0.6.1-D, ADR-026)
        setState((prev) =>
          prev.phase === 'ready' ? { ...prev, staleError: error } : { phase: 'error', error },
        );
        return;
      }
      logger.warn('feed', 'API недоступен, показываем демо-данные', { error: String(error) });
      // Вариант B (ADR-026): демо-лента + честный баннер + отключённые кнопки.
      setState({ phase: 'ready', listings: DEMO_LISTINGS, demo: true });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback((): void => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  /** Включить/выключить гео-фильтр: линии продавцов в радиусе (ADR-014). */
  const toggleNearby = useCallback(async (): Promise<void> => {
    tap();
    if (nearbySellers !== null) {
      setNearbySellers(null);
      return;
    }
    setGeoBusy(true);
    try {
      // Позиция: геолокация → моя сохранённая точка → центр рынка.
      let center: { lat: number; lng: number } = MARKET_CENTER;
      try {
        // v0.6.1-A: динамический импорт — expo-location общий для трёх чанков
        // (лента/доставка/карта), иначе Metro поднимает его в entry (ADR-023).
        const { default: Location } = await import('expo-location');
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status === 'granted') {
          const position = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          center = { lat: position.coords.latitude, lng: position.coords.longitude };
        }
      } catch (err) {
        logger.info('feed', 'геолокация недоступна — центр рынка', { error: String(err) });
      }
      if (center === MARKET_CENTER) {
        const mine = await api.geoPointsMine();
        const myPoint = mine.find((p) => p.kind === 'buyer_point');
        if (myPoint) {
          center = { lat: myPoint.latitude, lng: myPoint.longitude };
        }
      }
      const sellers = await api.geoPointsNearby({
        lat: center.lat,
        lng: center.lng,
        radiusMeters: NEARBY_RADIUS_M,
        kind: 'seller_line',
      });
      setNearbySellers(new Set(sellers.map((p) => p.ownerId)));
    } catch (error) {
      logger.warn('feed', 'гео-фильтр не удался', { error: toApiError(error).message });
      setNearbySellers(null);
    } finally {
      setGeoBusy(false);
    }
  }, [nearbySellers]);

  const demo = state.phase === 'ready' && state.demo;

  // Тексты ошибок — из единого маппинга (ADR-026).
  const stale =
    state.phase === 'ready' && state.staleError !== undefined
      ? errorContentFor(state.staleError)
      : null;

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Лента"
        subtitle="Рынок «Агро Молл» · утренний опт"
        badge={demo ? undefined : <Badge label="Рынок открыт · до 14:00" variant="success" />}
      />

      {/* v0.6.1-D (ADR-026, вариант B): честный баннер вместо маленького
          бейджа — демо-режим видно с первого взгляда, кнопки с сервером
          отключены. */}
      {demo ? (
        <View style={{ paddingBottom: spacing.sm }}>
          <DemoBanner hint="«Рядом» и «Моя точка» отключены." />
        </View>
      ) : null}

      {/* Виджет долгов (v0.4.0): «Вам должны / Вы должны», янтарный при просрочке. */}
      <View style={{ paddingHorizontal: spacing.lg }}>
        <DebtSummaryWidget />
      </View>

      {/* Гео-панель (v0.5.0-B): «Рядом со мной» + «Моя точка» (ADR-014).
          v0.6.2-B: кнопки — прямые дети ряда с flex:1 — при переносе
          при длинной подписи («Рядом: 12») обе кнопки стретчатся до одной высоты. */}
      <View
        style={{
          flexDirection: 'row',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.sm,
        }}
      >
        <Button
          style={{ flex: 1 }}
          // v0.6.2-B: «Рядом» вместо «Рядом со мной» — одна строка в полкнопки
          title={nearbySellers === null ? 'Рядом' : `Рядом: ${nearbySellers.size}`}
          variant={nearbySellers !== null ? 'primary' : 'secondary'}
          size="md"
          loading={geoBusy}
          disabled={demo}
          onPress={() => void toggleNearby()}
        />
        <Button
          style={{ flex: 1 }}
          title="Моя точка"
          variant="secondary"
          size="md"
          disabled={demo}
          onPress={() => {
            tap();
            setPointSheetOpen(true);
          }}
        />
      </View>
      {state.phase === 'loading' ? (
        <View style={{ gap: spacing.md }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : state.phase === 'error' ? (
        <ErrorState {...errorContentFor(state.error)} onRetry={handleRefresh} />
      ) : state.listings.length === 0 ? (
        <EmptyState
          illustration="basket"
          title="Пока тихо"
          description={
            nearbySellers !== null
              ? `В ${NEARBY_RADIUS_M / 1000} км от вас нет линий продавцов. Расширьте поиск — выключите фильтр «Рядом».`
              : 'Обновите или загляните позже.'
          }
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
          {/* Рефреш не удался, но лента уже на экране — помечаем устаревание. */}
          {stale !== null ? (
            <ErrorState
              variant="inline"
              title="Данные могли устареть"
              description={stale.description}
              onRetry={handleRefresh}
            />
          ) : null}
          {/* v0.6.2-D: планшет — 2 колонки: карточки по ~48.5%, межколонный
              gap из сетки отступов; телефон — одна колонка как раньше. */}
          <View
            testID="listings-grid"
            style={
              isTablet
                ? { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: spacing.md }
                : undefined
            }
          >
            {state.listings.map((listing, index) => {
              // Гео-фильтр: показываем только продавцов рядом (ADR-014).
              if (nearbySellers !== null && !nearbySellers.has(listing.sellerId)) {
                return null;
              }
              // Первая отрисовка: карточки входят каскадом — translateY 12→0
              // + проявление, 40 мс между карточками (ADR-009).
              const stagger = firstEntrance ? Math.min(index, STAGGER_CAP) * STAGGER_MS : 0;
              return (
                <Animated.View
                  key={listing.id}
                  entering={
                    stagger > 0
                      ? FadeInDown.delay(stagger).duration(300).springify().damping(16)
                      : undefined
                  }
                  style={isTablet ? { width: '48.5%' } : undefined}
                >
                  <ListingCard
                    listing={listing}
                    onPress={() => router.push(`/listing/${listing.id}`)}
                  />
                </Animated.View>
              );
            })}
          </View>
          <View style={{ height: spacing.md }} />
        </PullToRefreshScrollView>
      )}

      <MyPointSheet visible={pointSheetOpen} onClose={() => setPointSheetOpen(false)} role={role} />
    </Screen>
  );
}

export default FeedScreen;

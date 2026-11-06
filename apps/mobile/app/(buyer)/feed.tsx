import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Location from 'expo-location';
import {
  Badge,
  Button,
  EmptyState,
  PullToRefreshScrollView,
  Screen,
  SkeletonCard,
  spacing,
  tap,
} from '@agromoll/ui';
import type { ListingDto } from '@agromoll/types';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components';
import { DebtSummaryWidget } from '@/components/DebtSummaryWidget';
import { ListingCard } from '@/components/ListingCard';
import { MyPointSheet, MARKET_CENTER } from '@/components/MyPointSheet';
import { useAuthStore } from '@/store/auth';
import { api, isInvalidResponseError, toApiError } from '@/lib/api';
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
  | { phase: 'invalid' }
  | { phase: 'ready'; listings: ListingDto[]; demo: boolean };

/**
 * Лента покупателя: GET /listings со skeleton-загрузкой,
 * пустым состоянием и pull-to-refresh (зелёный вращающийся круг).
 * Если API недоступен — показываем демо-данные с честным бейджем.
 * v0.5.0-B: фильтр «Рядом со мной» — только продавцы, чьи линии
 * в радиусе (PostGIS, ADR-014), и кнопка «Моя точка».
 */
export default function FeedScreen() {
  const router = useRouter();
  const role = useAuthStore((s) => s.user?.role ?? 'buyer');
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
        // честный EmptyState с повтором (подэтап C)
        setState({ phase: 'invalid' });
        return;
      }
      logger.warn('feed', 'API недоступен, показываем демо-данные', { error: String(error) });
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

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Лента"
        subtitle="Рынок «Агро Молл» · утренний опт"
        badge={
          state.phase === 'ready' && state.demo ? (
            <Badge label="Демо-данные · API недоступен" variant="attention" />
          ) : (
            <Badge label="Рынок открыт · до 14:00" variant="success" />
          )
        }
      />
      {/* Виджет долгов (v0.4.0): «Вам должны / Вы должны», янтарный при просрочке. */}
      <View style={{ paddingHorizontal: spacing.lg }}>
        <DebtSummaryWidget />
      </View>

      {/* Гео-панель (v0.5.0-B): «Рядом со мной» + «Моя точка» (ADR-014). */}
      <View
        style={{
          flexDirection: 'row',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.sm,
        }}
      >
        <View style={{ flex: 1 }}>
          <Button
            title={nearbySellers === null ? 'Рядом со мной' : `Рядом: ${nearbySellers.size}`}
            variant={nearbySellers !== null ? 'primary' : 'secondary'}
            size="md"
            loading={geoBusy}
            onPress={() => void toggleNearby()}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title="Моя точка"
            variant="secondary"
            size="md"
            onPress={() => {
              tap();
              setPointSheetOpen(true);
            }}
          />
        </View>
      </View>
      {state.phase === 'loading' ? (
        <View style={{ gap: spacing.md }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : state.phase === 'invalid' ? (
        <EmptyState
          illustration="basket"
          title="Не удалось загрузить"
          description="Данные пришли в неожиданном формате. Попробуем ещё раз — просто потяните вниз."
          action={{ label: 'Попробовать ещё раз', onPress: handleRefresh }}
        />
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
              >
                <ListingCard
                  listing={listing}
                  onPress={() => router.push(`/listing/${listing.id}`)}
                />
              </Animated.View>
            );
          })}
          <View style={{ height: spacing.md }} />
        </PullToRefreshScrollView>
      )}

      <MyPointSheet
        visible={pointSheetOpen}
        onClose={() => setPointSheetOpen(false)}
        role={role}
      />
    </Screen>
  );
}

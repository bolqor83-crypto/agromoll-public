import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  Badge,
  EmptyState,
  PullToRefreshScrollView,
  Screen,
  SkeletonCard,
  spacing,
} from '@agromoll/ui';
import type { ListingDto } from '@agromoll/types';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components';
import { ListingCard } from '@/components/ListingCard';
import { api, isInvalidResponseError } from '@/lib/api';
import { logger } from '@/lib/logger';
import { DEMO_LISTINGS } from '@/lib/demo-data';

/** Задержка между появлением карточек (staggered entrance, ADR-009). */
const STAGGER_MS = 40;

/** Верхний предел задержки: даже у длинной ленты вход не затягивается. */
const STAGGER_CAP = 8;

type FeedState =
  | { phase: 'loading' }
  | { phase: 'invalid' }
  | { phase: 'ready'; listings: ListingDto[]; demo: boolean };

/**
 * Лента покупателя: GET /listings со skeleton-загрузкой,
 * пустым состоянием и pull-to-refresh (зелёный вращающийся круг).
 * Если API недоступен — показываем демо-данные с честным бейджем.
 */
export default function FeedScreen() {
  const router = useRouter();
  const [state, setState] = useState<FeedState>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  // Каскадный вход — только на ПЕРВУЮ отрисовку карточек (ADR-009):
  // пока true, карточки входят с задержкой index×40 мс; после завершения
  // входа флаг гаснет — рефреш и новые данные приходят без «перескакивания».
  const [firstEntrance, setFirstEntrance] = useState(true);

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
          description="Обновите или загляните позже."
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
    </Screen>
  );
}

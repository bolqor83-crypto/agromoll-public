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
import type { ListingDto } from '@agromoll/types';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components';
import { ListingCard } from '@/components/ListingCard';
import { api, isInvalidResponseError } from '@/lib/api';
import { logger } from '@/lib/logger';
import { DEMO_LISTINGS } from '@/lib/demo-data';

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
          title="Лента пока пуста"
          description="Продавцы ещё не выставили лоты. Потяните вниз, чтобы обновить."
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
          {state.listings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              onPress={() => router.push(`/listing/${listing.id}`)}
            />
          ))}
          <View style={{ height: spacing.md }} />
        </PullToRefreshScrollView>
      )}
    </Screen>
  );
}

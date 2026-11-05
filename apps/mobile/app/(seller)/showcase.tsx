import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Badge,
  EmptyState,
  Icon,
  PullToRefreshScrollView,
  Screen,
  SkeletonCard,
  spacing,
  useTheme,
} from '@agromoll/ui';
import type { ListingDto } from '@agromoll/types';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components';
import { ListingCard } from '@/components/ListingCard';
import { CreateListingModal } from '@/components/CreateListingModal';
import { api } from '@/lib/api';
import { logger } from '@/lib/logger';
import { DEMO_LISTINGS } from '@/lib/demo-data';
import { useAuthStore } from '@/store/auth';

type ShowcaseState =
  { phase: 'loading' } | { phase: 'ready'; listings: ListingDto[]; demo: boolean };

/**
 * Витрина продавца: свои лоты, остатки и резервы, FAB «+ Выставить лот».
 */
export default function ShowcaseScreen() {
  const userName = useAuthStore((s) => s.user?.displayName ?? 'Витрина');
  const insets = useSafeAreaInsets();
  const { colors, mode } = useTheme();
  const [state, setState] = useState<ShowcaseState>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const listings = await api.myListings();
      setState({ phase: 'ready', listings, demo: false });
    } catch (error) {
      logger.warn('showcase', 'API недоступен, показываем демо-витрину', { error: String(error) });
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

  const activeCount =
    state.phase === 'ready' ? state.listings.filter((l) => l.status === 'active').length : 0;

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Витрина"
        subtitle={`${userName} · ваши лоты`}
        badge={
          state.phase === 'ready' && state.demo ? (
            <Badge label="Демо-данные · API недоступен" variant="attention" />
          ) : (
            <Badge label={`Активных лотов: ${activeCount}`} variant="success" />
          )
        }
      />
      {state.phase === 'loading' ? (
        <View style={{ gap: spacing.md }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : state.listings.length === 0 ? (
        <EmptyState
          illustration="box"
          title="Вы ещё ничего не выставили"
          description="Выставите первый лот — покупатели увидят его в ленте."
          action={{ label: 'Выставить лот', onPress: () => setModalOpen(true) }}
        />
      ) : (
        <PullToRefreshScrollView
          refreshing={refreshing}
          onRefresh={handleRefresh}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            padding: spacing.lg,
            gap: spacing.md,
            paddingBottom: spacing.xxl + 72,
          }}
        >
          {state.listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} sellerView />
          ))}
        </PullToRefreshScrollView>
      )}

      {/* FAB «+ Выставить лот» — 56 px, над панелью вкладок */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Выставить лот"
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
          setModalOpen(true);
        }}
        style={{
          position: 'absolute',
          right: spacing.lg,
          bottom: insets.bottom + 76,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: mode === 'dark' ? '#000000' : '#1F2A24',
          shadowOpacity: 0.25,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        <Icon name="add-outline" size={28} color="onPrimary" />
      </Pressable>

      <CreateListingModal
        visible={modalOpen}
        demo={state.phase === 'ready' && state.demo}
        onClose={() => setModalOpen(false)}
        onCreated={() => {
          setModalOpen(false);
          void load();
        }}
      />
    </Screen>
  );
}

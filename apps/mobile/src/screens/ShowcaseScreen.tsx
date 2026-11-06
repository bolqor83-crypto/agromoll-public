import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  PullToRefreshScrollView,
  Screen,
  shadow,
  SkeletonCard,
  spacing,
  tap,
  useTheme,
} from '@agromoll/ui';
import type { ListingDto } from '@agromoll/types';
import { ScreenHeader } from '@/components/ScreenHeader';
import { DebtSummaryWidget } from '@/components/DebtSummaryWidget';
import { DemoBanner } from '@/components/DemoBanner';
import { ListingCard } from '@/components/ListingCard';
import { CreateListingModal } from '@/components/CreateListingModal';
import { MyPointSheet } from '@/components/MyPointSheet';
import { api, isInvalidResponseError } from '@/lib/api';
import { errorContentFor } from '@/lib/error-content';
import { logger } from '@/lib/logger';
import { DEMO_LISTINGS } from '@/lib/demo-data';
import { useAuthStore } from '@/store/auth';

/**
 * Конечный автомат витрины (v0.6.1-D, ADR-026): вариант B — демо-данные
 * с честным баннером и отключёнными серверными действиями (FAB «Выставить
 * лот», «Моя линия на карте»); INVALID_RESPONSE — ErrorState без демо.
 */
type ShowcaseState =
  | { phase: 'loading' }
  | { phase: 'error'; error: unknown }
  | { phase: 'ready'; listings: ListingDto[]; demo: boolean; staleError?: unknown };

/**
 * Витрина продавца: свои лоты, остатки и резервы, FAB «+ Выставить лот».
 */
export default function ShowcaseScreen() {
  const userName = useAuthStore((s) => s.user?.displayName ?? 'Витрина');
  const totalConfirmations = useAuthStore((s) => s.user?.totalConfirmations ?? 0);
  const insets = useSafeAreaInsets();
  const { colors, mode } = useTheme();
  const [state, setState] = useState<ShowcaseState>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [pointSheetOpen, setPointSheetOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const listings = await api.myListings();
      setState({ phase: 'ready', listings, demo: false });
    } catch (error) {
      if (isInvalidResponseError(error)) {
        logger.warn('showcase', 'невалидный ответ API', { error: String(error) });
        setState((prev) =>
          prev.phase === 'ready'
            ? { ...prev, staleError: error }
            : { phase: 'error', error },
        );
        return;
      }
      logger.warn('showcase', 'API недоступен, показываем демо-витрину', { error: String(error) });
      // Вариант B (ADR-026): демо-витрина + честный баннер.
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

  const demo = state.phase === 'ready' && state.demo;

  // Тексты ошибок — из единого маппинга (ADR-026).
  const stale =
    state.phase === 'ready' && state.staleError !== undefined
      ? errorContentFor(state.staleError)
      : null;

  const activeCount =
    state.phase === 'ready' ? state.listings.filter((l) => l.status === 'active').length : 0;

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Витрина"
        subtitle={`${userName} · подтверждено сделок: ${totalConfirmations}`}
        badge={demo ? undefined : <Badge label={`Активных лотов: ${activeCount}`} variant="success" />}
      />

      {/* v0.6.1-D (ADR-026, вариант B): демо-витрина честно помечена
          баннером, серверные действия отключены. */}
      {demo ? (
        <View style={{ paddingBottom: spacing.sm }}>
          <DemoBanner hint="Выставить лот и Моя линия отключены." />
        </View>
      ) : null}

      {/* Виджет долгов (v0.4.0): «Вам должны / Вы должны», янтарный при просрочке. */}
      <View style={{ paddingHorizontal: spacing.lg }}>
        <DebtSummaryWidget />
      </View>
      {state.phase === 'loading' ? (
        <View style={{ gap: spacing.md }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : state.phase === 'error' ? (
        <ErrorState {...errorContentFor(state.error)} onRetry={handleRefresh} />
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
          {/* Рефреш не удался, но витрина на экране — помечаем устаревание. */}
          {stale !== null ? (
            <ErrorState
              variant="inline"
              title="Данные могли устареть"
              description={stale.description}
              onRetry={handleRefresh}
            />
          ) : null}
          {state.listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} sellerView />
          ))}
        </PullToRefreshScrollView>
      )}

      {/* Моя линия на рынке (v0.5.0-B, ADR-014): где вас искать покупателям.
          В демо-режиме отключена — сохранение уходит на сервер (ADR-026). */}
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <Button
          title="Моя линия на карте"
          variant="secondary"
          size="md"
          disabled={demo}
          onPress={() => {
            tap();
            setPointSheetOpen(true);
          }}
        />
      </View>

      {/* FAB «+ Выставить лот» — 56 px у нижней кромки контент-зоны
          (v0.6.1-C: thumb zone, ADR-025 — раньше висел на 76 px выше).
          В демо-режиме отключён (ADR-026): лот нельзя сохранить без сервера. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Выставить лот"
        accessibilityState={{ disabled: demo }}
        disabled={demo}
        onPress={() => {
          tap();
          setModalOpen(true);
        }}
        style={{
          position: 'absolute',
          right: spacing.lg,
          bottom: spacing.md + insets.bottom,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: colors.primary,
          // Демо-режим: кнопка выключена — приглушаем, но не прячем:
          // пользователь видит, что действие есть, но сейчас недоступно.
          opacity: demo ? 0.4 : 1,
          alignItems: 'center',
          justifyContent: 'center',
          // Тень — из токенов (shadow по теме), не литералом (B8, ADR-009)
          shadowColor: shadow[mode].shadowColor,
          shadowOpacity: 0.25,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: shadow[mode].elevation + 2,
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

      <MyPointSheet
        visible={pointSheetOpen}
        onClose={() => setPointSheetOpen(false)}
        role="seller"
      />
    </Screen>
  );
}

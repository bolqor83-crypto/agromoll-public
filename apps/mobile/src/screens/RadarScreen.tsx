/**
 * Радар доставщика (v0.5.0, подэтап C, ADR-015).
 *
 * Лента открытых заказов «кто едет куда»: карточка «откуда → куда»,
 * вес, таймер TTL (янтарный), попутность маршруту. Кнопка «Беру» —
 * крупная, в нижней трети карточки. Блокировка 289-ФЗ — мягкий
 * экран-пауза, без «вы нарушили закон» (ADR-011/015).
 *
 * v0.6.1-D (ADR-026): конечный автомат loading → ready/error. Ошибка
 * первой загрузки — ErrorState с «Повторить» (никаких вечных skeleton
 * и молчаливых console.warn); ошибка рефреша при готовых данных —
 * устаревший список + inline-ErrorState, данные не прячем.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  PullToRefreshScrollView,
  Screen,
  Skeleton,
  spacing,
  success,
  tap,
  Text,
  warning,
} from '@agromoll/ui';
import type { DeliveryDto } from '@agromoll/types';
import { ScreenHeader } from '@/components/ScreenHeader';
import { api, toApiError } from '@/lib/api';
import { errorContentFor } from '@/lib/error-content';
import { logger } from '@/lib/logger';

/** Сколько минут осталось жить открытому заказу (TTL, ADR-015). */
function minutesLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000));
}

/** «Через 12 мин» / «истекает» — мягкий янтарный таймер. */
function ttlBadge(expiresAt: string): { label: string; urgent: boolean } {
  const left = minutesLeft(expiresAt);
  if (left <= 5) {
    return { label: `Истекает · ${left} мин`, urgent: true };
  }
  return { label: `Ещё ${left} мин`, urgent: false };
}

/**
 * Конечный автомат радара (ADR-026): loading → ready | error.
 *  - ready + staleError: данные есть, но последний рефреш не удался —
 *    показываем их вместе с inline-ErrorState (данные не прячем).
 *  - error: данных нет вообще — полноэкранный ErrorState с повтором.
 */
type RadarState =
  | { phase: 'loading' }
  | { phase: 'error'; error: unknown }
  | { phase: 'ready'; deliveries: DeliveryDto[]; staleError?: unknown };

export default function RadarScreen() {
  const [state, setState] = useState<RadarState>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [taking, setTaking] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const open = await api.deliveriesOpen();
      setState({ phase: 'ready', deliveries: open });
    } catch (err) {
      logger.warn('radar', 'радар не загрузился', { error: toApiError(err).message });
      setState((prev) =>
        prev.phase === 'ready'
          ? { ...prev, staleError: err }
          : { phase: 'error', error: err },
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Тексты ошибок — из единого маппинга (ADR-026): заголовок и пояснение.
  const stale =
    state.phase === 'ready' && state.staleError !== undefined
      ? errorContentFor(state.staleError)
      : null;

  const handleRefresh = useCallback((): void => {
    setRefreshing(true);
    void load();
  }, [load]);

  /** «Беру»: assign; 409 DELIVERY_PAIR_BLOCKED — мягкий экран паузы. */
  const handleTake = useCallback(
    async (delivery: DeliveryDto): Promise<void> => {
      tap();
      setTaking(delivery.id);
      try {
        await api.assignDelivery(delivery.id);
        success();
        // Заказ ушёл в «Мои доставки» — перечитываем радар.
        await load();
        Alert.alert(
          'Заказ ваш',
          'Заберите товар на линии продавца и подтвердите QR-код. Детали — во вкладке «Мои доставки».',
        );
      } catch (err) {
        const apiError = toApiError(err);
        const bodyCode =
          apiError.body && typeof apiError.body === 'object'
            ? (apiError.body as { code?: string }).code
            : undefined;
        if (bodyCode === 'DELIVERY_PAIR_BLOCKED') {
          warning();
          Alert.alert('Нужна пауза', apiError.hint ?? apiError.message);
        } else {
          warning();
          Alert.alert('Не получилось', apiError.hint ?? apiError.message);
        }
      } finally {
        setTaking(null);
      }
    },
    [load],
  );

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Радар"
        subtitle="Попутные заказы по вашему маршруту"
        badge={
          state.phase === 'ready' && state.deliveries.length > 0 ? (
            <Badge label={`${state.deliveries.length} попутных`} variant="success" />
          ) : undefined
        }
      />

      {state.phase === 'loading' ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton height={150} />
          <Skeleton height={150} />
        </View>
      ) : state.phase === 'error' ? (
        <ErrorState {...errorContentFor(state.error)} onRetry={() => void load()} />
      ) : state.deliveries.length === 0 ? (
        <EmptyState
          illustration="radar"
          title="Попутных заказов нет"
          description="Опубликуйте маршрут на «Карте рынка» — радар покажет заказы вдоль вашей дороги."
        />
      ) : (
        <PullToRefreshScrollView refreshing={refreshing} onRefresh={handleRefresh} style={{ flex: 1 }}>
          {/* Рефреш не удался, но данные есть: честно помечаем их устаревшими. */}
          {stale !== null ? (
            <View style={{ marginBottom: spacing.md }}>
              <ErrorState
                variant="inline"
                title="Данные могли устареть"
                description={stale.description}
                onRetry={() => void load()}
              />
            </View>
          ) : null}
          <View style={{ gap: spacing.md, paddingBottom: spacing.xxl }}>
            {state.deliveries.map((delivery, index) => {
              const ttl = ttlBadge(delivery.expiresAt);
              return (
                <Animated.View
                  key={delivery.id}
                  entering={FadeInDown.springify().damping(18).delay(Math.min(index * 50, 300))}
                >
                  <Card style={{ gap: spacing.sm }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: spacing.sm,
                      }}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="body" weight="600">
                          {delivery.pickup.label ?? delivery.pickup.ownerName}
                          {'  →  '}
                          {delivery.dropoff.label ?? delivery.buyerName}
                        </Text>
                        <Text variant="caption" color="secondary">
                          {delivery.weightKg} кг
                          {delivery.description ? ` · ${delivery.description}` : ''}
                        </Text>
                      </View>
                      <Badge
                        label={ttl.label}
                        variant={ttl.urgent ? 'attention' : 'neutral'}
                      />
                    </View>

                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.xs,
                      }}
                    >
                      <Icon
                        name={delivery.corridorDistanceMeters !== null ? 'navigate-outline' : 'location-outline'}
                        size={16}
                        color="secondary"
                      />
                      <Text variant="caption" color="secondary" style={{ flex: 1 }}>
                        {delivery.corridorDistanceMeters !== null
                          ? `${delivery.corridorDistanceMeters} м от вашего маршрута`
                          : 'Опубликуйте маршрут — покажем попутность'}
                      </Text>
                    </View>

                    {/* Кнопка «Беру» — контекстное действие карточки (не экранное):
                        остаётся внутри карточки. Дублирующая кнопка для одной руки —
                        внизу экрана (v0.6.1-C, ADR-025). */}
                    <Button
                      title="Беру"
                      size="lg"
                      loading={taking === delivery.id}
                      onPress={() => void handleTake(delivery)}
                    />
                  </Card>
                </Animated.View>
              );
            })}
          </View>
        </PullToRefreshScrollView>
      )}

      {/* v0.6.1-C (ADR-025): дублирующая primary-кнопка в thumb zone —
          «Беру» ближайший заказ одной рукой, не дотягиваясь до карточки. */}
      {state.phase === 'ready' && state.deliveries.length > 0 ? (
        <View style={{ paddingTop: spacing.sm }}>
          <Button
            title={`Беру · ${state.deliveries[0].pickup.label ?? state.deliveries[0].pickup.ownerName} → ${
              state.deliveries[0].dropoff.label ?? state.deliveries[0].buyerName
            }`}
            size="lg"
            loading={taking === state.deliveries[0].id}
            onPress={() => void handleTake(state.deliveries[0])}
          />
        </View>
      ) : null}
    </Screen>
  );
}

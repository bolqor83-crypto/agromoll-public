/**
 * Радар доставщика (v0.5.0, подэтап C, ADR-015).
 *
 * Лента открытых заказов «кто едет куда»: карточка «откуда → куда»,
 * вес, таймер TTL (янтарный), попутность маршруту. Кнопка «Беру» —
 * крупная, в нижней трети карточки. Блокировка 289-ФЗ — мягкий
 * экран-пауза, без «вы нарушили закон» (ADR-011/015).
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  Badge,
  Button,
  Card,
  EmptyState,
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
import { ScreenHeader } from '@/components';
import { api, toApiError } from '@/lib/api';
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

export default function RadarScreen() {
  const [deliveries, setDeliveries] = useState<DeliveryDto[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taking, setTaking] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const open = await api.deliveriesOpen();
      setDeliveries(open);
      setError(null);
    } catch (err) {
      setError(toApiError(err).message);
      logger.warn('radar', 'радар не загрузился', { error: toApiError(err).message });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
          deliveries !== null && deliveries.length > 0 ? (
            <Badge label={`${deliveries.length} попутных`} variant="success" />
          ) : undefined
        }
      />

      {deliveries === null ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton height={150} />
          <Skeleton height={150} />
        </View>
      ) : error !== null && deliveries.length === 0 ? (
        <EmptyState
          illustration="radar"
          title="Радар недоступен"
          description={error}
          action={{ label: 'Повторить', onPress: () => void load() }}
        />
      ) : deliveries.length === 0 ? (
        <EmptyState
          illustration="radar"
          title="Попутных заказов нет"
          description="Опубликуйте маршрут на «Карте рынка» — радар покажет заказы вдоль вашей дороги."
        />
      ) : (
        <PullToRefreshScrollView refreshing={refreshing} onRefresh={handleRefresh} style={{ flex: 1 }}>
          <View style={{ gap: spacing.md, paddingBottom: spacing.xxl }}>
            {deliveries.map((delivery, index) => {
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

                    {/* Кнопка «Беру» — крупная, в нижней трети карточки (спецификация C). */}
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
    </Screen>
  );
}

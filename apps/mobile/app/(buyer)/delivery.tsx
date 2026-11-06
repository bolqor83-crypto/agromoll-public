/**
 * «Доставка» покупателя (v0.5.0, подэтап C, ADR-015).
 *
 * Мои запросы доставки: маршрут, вес, статус, водитель (когда взял),
 * TTL открытых. Создание — через CreateDeliverySheet (outbox, офлайн).
 * Отмена доступна покупателю до выезда водителя.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  Badge,
  Button,
  Card,
  EmptyState,
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
import { DELIVERY_STATUS_LABELS } from '@agromoll/types';
import { ScreenHeader } from '@/components';
import { CreateDeliverySheet } from '@/components/CreateDeliverySheet';
import { QrScanner } from '@/qr';
import { api, toApiError } from '@/lib/api';
import { logger } from '@/lib/logger';
import { formatClock } from '@/lib/format';

/** Пилюля статуса доставки. */
function statusVariant(status: DeliveryDto['status']): 'success' | 'attention' | 'neutral' {
  if (status === 'delivered') {
    return 'success';
  }
  if (status === 'cancelled' || status === 'expired') {
    return 'neutral';
  }
  return 'attention';
}

/** Минут до истечения TTL открытого запроса. */
function minutesLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000));
}

/** Карточка запроса покупателя со сверкой QR водителя (ADR-015). */
function BuyerDeliveryCard({
  delivery,
  cancelling,
  onCancel,
  index,
}: {
  delivery: DeliveryDto;
  cancelling: boolean;
  onCancel: (delivery: DeliveryDto) => void;
  index: number;
}) {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<'ok' | 'mismatch' | null>(null);
  const canCancel = delivery.status === 'open' || delivery.status === 'assigned';
  const canVerify = delivery.status === 'assigned' || delivery.status === 'in_transit';
  const ttlLeft = delivery.status === 'open' ? minutesLeft(delivery.expiresAt) : null;

  return (
    <Animated.View entering={FadeInDown.springify().damping(18).delay(Math.min(index * 50, 300))}>
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
              {delivery.dropoff.label ?? 'моя точка'}
            </Text>
            <Text variant="caption" color="secondary">
              {delivery.weightKg} кг · {formatClock(delivery.createdAt)}
              {delivery.assignedDriverName ? ` · везёт ${delivery.assignedDriverName}` : ''}
            </Text>
          </View>
          <Badge label={DELIVERY_STATUS_LABELS[delivery.status]} variant={statusVariant(delivery.status)} />
        </View>

        {ttlLeft !== null ? (
          <Text variant="caption" color="onWarning">
            Запрос живёт ещё {ttlLeft} мин — потом уйдёт из радара.
          </Text>
        ) : null}

        {canVerify && delivery.dropoffCode ? (
          <View style={{ gap: spacing.sm }}>
            <Button
              title={scanning ? 'Скрыть сверку кода' : 'Сверить код водителя (QR)'}
              variant="secondary"
              size="md"
              onPress={() => {
                tap();
                setScanning((v) => !v);
                setScanResult(null);
              }}
            />
            {scanning ? (
              <QrScanner
                expectedCode={delivery.dropoffCode}
                hint="Водитель показывает QR передачи при вручении товара"
                onResult={(matches) => setScanResult(matches ? 'ok' : 'mismatch')}
              />
            ) : null}
            {scanResult === 'ok' ? (
              <Badge label="Код совпал — можно принимать" variant="success" />
            ) : null}
            {scanResult === 'mismatch' ? (
              <Badge label="Код не совпал — проверьте заказ" variant="attention" />
            ) : null}
          </View>
        ) : null}

        {canCancel ? (
          <Button
            title="Отменить"
            variant="ghost"
            size="md"
            loading={cancelling}
            onPress={() => onCancel(delivery)}
          />
        ) : null}
      </Card>
    </Animated.View>
  );
}

export default function BuyerDeliveryScreen() {
  const [deliveries, setDeliveries] = useState<DeliveryDto[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const mine = await api.deliveriesMine();
      setDeliveries(mine);
      setError(null);
    } catch (err) {
      setError(toApiError(err).message);
      logger.warn('buyer-delivery', 'запросы не загрузились', { error: toApiError(err).message });
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

  /** Отмена покупателем (до выезда водителя — свободно). */
  const handleCancel = useCallback(
    async (delivery: DeliveryDto): Promise<void> => {
      tap();
      setCancelling(delivery.id);
      try {
        await api.cancelDelivery(delivery.id);
        success();
        await load();
      } catch (err) {
        const apiError = toApiError(err);
        warning();
        Alert.alert('Не получилось', apiError.hint ?? apiError.message);
      } finally {
        setCancelling(null);
      }
    },
    [load],
  );

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Доставка"
        subtitle="Попутчики подвезут от линии к вашей точке"
        badge={
          deliveries !== null && deliveries.length > 0 ? (
            <Badge label={`${deliveries.length} запросов`} variant="neutral" />
          ) : undefined
        }
      />

      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <Button
          title="Заказать доставку"
          size="lg"
          onPress={() => {
            tap();
            setSheetOpen(true);
          }}
        />
      </View>

      {deliveries === null ? (
        <View style={{ gap: spacing.md, padding: spacing.lg }}>
          <Skeleton height={110} />
          <Skeleton height={110} />
        </View>
      ) : error !== null && deliveries.length === 0 ? (
        <EmptyState
          illustration="box"
          title="Доставка недоступна"
          description={error}
          action={{ label: 'Повторить', onPress: () => void load() }}
        />
      ) : deliveries.length === 0 ? (
        <EmptyState
          illustration="box"
          title="Запросов пока нет"
          description="Создайте запрос: попутчик по пути подвезёт товар от линии продавца к вашей точке."
        />
      ) : (
        <PullToRefreshScrollView refreshing={refreshing} onRefresh={handleRefresh} style={{ flex: 1 }}>
          <View style={{ gap: spacing.md, paddingBottom: spacing.xxl }}>
            {deliveries.map((delivery, index) => (
              <BuyerDeliveryCard
                key={delivery.id}
                delivery={delivery}
                cancelling={cancelling === delivery.id}
                onCancel={(d) => void handleCancel(d)}
                index={index}
              />
            ))}
          </View>
        </PullToRefreshScrollView>
      )}

      <CreateDeliverySheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCreated={() => void load()}
      />
    </Screen>
  );
}

/**
 * «Доставка» покупателя (v0.5.0, подэтап C, ADR-015).
 *
 * Мои запросы доставки: маршрут, вес, статус, водитель (когда взял),
 * TTL открытых. Создание — через CreateDeliverySheet (outbox, офлайн).
 * Отмена доступна покупателю до выезда водителя.
 *
 * v0.6.1-D (ADR-026, вариант A): конечный автомат loading → ready/error.
 * Ошибка первой загрузки — ErrorState с «Повторить», а не вечный skeleton.
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
import { ScreenHeader } from '@/components/ScreenHeader';
import { CreateDeliverySheet } from '@/components/CreateDeliverySheet';
import { QrScanner } from '@/qr';
import { api, toApiError } from '@/lib/api';
import { errorContentFor } from '@/lib/error-content';
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
    <Animated.View
      entering={FadeInDown.springify()
        .damping(18)
        .delay(Math.min(index * 50, 300))}
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
              {delivery.dropoff.label ?? 'моя точка'}
            </Text>
            <Text variant="caption" color="secondary">
              {delivery.weightKg} кг · {formatClock(delivery.createdAt)}
              {delivery.assignedDriverName ? ` · везёт ${delivery.assignedDriverName}` : ''}
            </Text>
          </View>
          <Badge
            label={DELIVERY_STATUS_LABELS[delivery.status]}
            variant={statusVariant(delivery.status)}
          />
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

/** Конечный автомат (ADR-026): loading → ready | error. */
type DeliveryState =
  | { phase: 'loading' }
  | { phase: 'error'; error: unknown }
  | { phase: 'ready'; deliveries: DeliveryDto[]; staleError?: unknown };

export default function BuyerDeliveryScreen() {
  const [state, setState] = useState<DeliveryState>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const mine = await api.deliveriesMine();
      setState({ phase: 'ready', deliveries: mine });
    } catch (err) {
      logger.warn('buyer-delivery', 'запросы не загрузились', { error: toApiError(err).message });
      setState((prev) =>
        prev.phase === 'ready' ? { ...prev, staleError: err } : { phase: 'error', error: err },
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Тексты ошибок — из единого маппинга (ADR-026).
  const stale =
    state.phase === 'ready' && state.staleError !== undefined
      ? errorContentFor(state.staleError)
      : null;

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
          state.phase === 'ready' && state.deliveries.length > 0 ? (
            <Badge label={`${state.deliveries.length} запросов`} variant="neutral" />
          ) : undefined
        }
      />

      {/* v0.6.1-C (ADR-025): primary-действие — в нижней трети (thumb zone),
          раньше кнопка висела под шапкой и не доставалась большим пальцем. */}
      <View style={{ flex: 1 }}>
        {state.phase === 'loading' ? (
          <View style={{ gap: spacing.md, padding: spacing.lg }}>
            <Skeleton height={110} />
            <Skeleton height={110} />
          </View>
        ) : state.phase === 'error' ? (
          <View style={{ padding: spacing.lg }}>
            <ErrorState {...errorContentFor(state.error)} onRetry={() => void load()} />
          </View>
        ) : state.deliveries.length === 0 ? (
          <EmptyState
            illustration="truck"
            title="Запросов пока нет"
            description="Создайте запрос: попутчик по пути подвезёт товар от линии продавца к вашей точке."
            // v0.6.2-C: грузовик-иллюстрация + конкретное действие (ADR-029)
            action={{ label: 'Создать запрос', onPress: () => setSheetOpen(true) }}
          />
        ) : (
          <PullToRefreshScrollView
            refreshing={refreshing}
            onRefresh={handleRefresh}
            style={{ flex: 1 }}
          >
            <View style={{ gap: spacing.md, paddingBottom: spacing.xxl }}>
              {stale !== null ? (
                <ErrorState
                  variant="inline"
                  title="Данные могли устареть"
                  description={stale.description}
                  onRetry={() => void load()}
                />
              ) : null}
              {state.deliveries.map((delivery, index) => (
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
      </View>

      {/* Primary action — внизу экрана, одна рука (ADR-025) */}
      <View style={{ paddingTop: spacing.sm }}>
        <Button
          title="Заказать доставку"
          size="lg"
          onPress={() => {
            tap();
            setSheetOpen(true);
          }}
        />
      </View>

      <CreateDeliverySheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCreated={() => void load()}
      />
    </Screen>
  );
}

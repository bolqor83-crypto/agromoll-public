/**
 * «Мои доставки» водителя (v0.5.0, подэтап C, ADR-015).
 *
 * Активные рейсы — пошаговый экран (спецификация C):
 * «Заберите на линии → Подтвердите QR → Везите → Передайте QR».
 * QR-коды передачи (UUID) показываются контрагенту, подтверждение —
 * совпадение кода (скан камерой на native / ввод на web, ADR-015).
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Input,
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
import { QrCode } from '@/qr';
import { api, toApiError } from '@/lib/api';
import { errorContentFor } from '@/lib/error-content';
import { logger } from '@/lib/logger';
import { formatClock } from '@/lib/format';
import { useNotificationStore } from '@/store/notifications';

/** Статусная пилюля доставки. */
function statusVariant(status: DeliveryDto['status']): 'success' | 'attention' | 'neutral' {
  if (status === 'delivered') {
    return 'success';
  }
  if (status === 'cancelled' || status === 'expired') {
    return 'neutral';
  }
  return 'attention';
}

/** Пошаговый экран активного рейса (assigned / in_transit). */
function ActiveDeliveryCard({
  delivery,
  onFinished,
}: {
  delivery: DeliveryDto;
  onFinished: () => void;
}) {
  const [busy, setBusy] = useState<'start' | 'deliver' | 'cancel' | null>(null);
  const [showQr, setShowQr] = useState<'pickup' | 'dropoff' | null>(null);
  // Причина отмены после выезда (обязательна, ADR-015) — inline-инпут:
  // работает на всех платформах (Alert.prompt — только iOS).
  const [cancelReason, setCancelReason] = useState('');
  const [cancelArmed, setCancelArmed] = useState(false);

  const run = useCallback(
    async (action: 'start' | 'deliver' | 'cancel'): Promise<void> => {
      tap();
      setBusy(action);
      try {
        if (action === 'start') {
          await api.startDelivery(delivery.id);
        } else if (action === 'deliver') {
          await api.deliverDelivery(delivery.id);
        } else {
          await api.cancelDelivery(delivery.id, cancelReason.trim() || undefined);
        }
        success();
        setCancelArmed(false);
        setCancelReason('');
        onFinished();
      } catch (err) {
        const apiError = toApiError(err);
        warning();
        Alert.alert('Не получилось', apiError.hint ?? apiError.message);
      } finally {
        setBusy(null);
      }
    },
    [delivery.id, cancelReason, onFinished],
  );

  const step = delivery.status === 'assigned' ? 1 : delivery.status === 'in_transit' ? 3 : 0;

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <Text variant="title">
          {delivery.pickup.label ?? delivery.pickup.ownerName}
          {'  →  '}
          {delivery.dropoff.label ?? delivery.buyerName}
        </Text>
        <Text variant="caption" color="secondary">
          {delivery.weightKg} кг · {delivery.buyerName} · взят{' '}
          {formatClock(delivery.assignedAt ?? delivery.createdAt)}
        </Text>
        <Badge
          label={DELIVERY_STATUS_LABELS[delivery.status]}
          variant={statusVariant(delivery.status)}
        />
      </View>

      {/* Пошаговый сценарий (спецификация C). */}
      <View style={{ gap: spacing.xs }}>
        <StepRow
          done={step > 1}
          active={step === 1}
          label={`Заберите на линии: ${delivery.pickup.label ?? delivery.pickup.ownerName}`}
        />
        <StepRow
          done={step > 1}
          active={step === 1}
          label="Покажите QR продавцу — подтвердите забор"
        />
        <StepRow
          done={step > 3}
          active={step === 3}
          label={`Везите: ${delivery.dropoff.label ?? delivery.dropoff.address ?? delivery.buyerName}`}
        />
        <StepRow
          done={step > 3}
          active={step === 3}
          label="Передайте товар, покажите QR покупателю"
        />
      </View>

      {/* QR-кнопки: показать код забора/передачи. */}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            title={showQr === 'pickup' ? 'Скрыть QR забора' : 'QR забора'}
            variant="secondary"
            size="md"
            onPress={() => {
              tap();
              setShowQr(showQr === 'pickup' ? null : 'pickup');
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title={showQr === 'dropoff' ? 'Скрыть QR передачи' : 'QR передачи'}
            variant="secondary"
            size="md"
            onPress={() => {
              tap();
              setShowQr(showQr === 'dropoff' ? null : 'dropoff');
            }}
          />
        </View>
      </View>
      {showQr === 'pickup' && delivery.pickupCode ? (
        <QrCode
          value={delivery.pickupCode}
          caption="Покажите продавцу на линии — код подтверждает забор"
        />
      ) : null}
      {showQr === 'dropoff' && delivery.dropoffCode ? (
        <QrCode value={delivery.dropoffCode} caption="Покажите покупателю при передаче товара" />
      ) : null}

      {/* Действия по статусу. */}
      {delivery.status === 'assigned' ? (
        <View style={{ gap: spacing.sm }}>
          <Button
            title="Выехал за товаром"
            size="lg"
            loading={busy === 'start'}
            onPress={() => void run('start')}
          />
          <Button
            title="Отменить рейс"
            variant="ghost"
            size="md"
            loading={busy === 'cancel'}
            onPress={() => void run('cancel')}
          />
        </View>
      ) : null}
      {delivery.status === 'in_transit' ? (
        <View style={{ gap: spacing.sm }}>
          <Button
            title="Товар передан"
            size="lg"
            loading={busy === 'deliver'}
            onPress={() => void run('deliver')}
          />
          {cancelArmed ? (
            <>
              <Input
                placeholder="Причина отмены (обязательна после выезда)"
                value={cancelReason}
                onChangeText={setCancelReason}
              />
              <Button
                title="Подтвердить отмену"
                variant="secondary"
                size="md"
                loading={busy === 'cancel'}
                disabled={cancelReason.trim().length === 0}
                onPress={() => void run('cancel')}
              />
            </>
          ) : (
            <Button
              title="Отменить (с причиной)"
              variant="ghost"
              size="md"
              onPress={() => {
                tap();
                setCancelArmed(true);
              }}
            />
          )}
        </View>
      ) : null}
    </Card>
  );
}

/** Строка шага: галка / активная точка / будущая. */
function StepRow({ done, active, label }: { done: boolean; active: boolean; label: string }) {
  const iconName = done
    ? 'checkmark-circle'
    : active
      ? 'ellipse-outline'
      : 'radio-button-off-outline';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Icon name={iconName} size={20} color={done ? 'primary' : active ? 'warning' : 'secondary'} />
      <Text variant="caption" color={done ? 'primary' : 'secondary'} style={{ flex: 1 }}>
        {label}
      </Text>
    </View>
  );
}

/** Конечный автомат (v0.6.1-D, ADR-026): loading → ready | error. */
type MyDeliveriesState =
  | { phase: 'loading' }
  | { phase: 'error'; error: unknown }
  | { phase: 'ready'; deliveries: DeliveryDto[]; staleError?: unknown };

export default function DeliveriesScreen() {
  const router = useRouter();
  const [state, setState] = useState<MyDeliveriesState>({ phase: 'loading' });
  // v0.6.0-A (ADR-031): push-сигнал — экран перечитывает данные.
  const pushVersion = useNotificationStore((s) => s.version);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const mine = await api.deliveriesMine();
      setState({ phase: 'ready', deliveries: mine });
    } catch (err) {
      logger.warn('deliveries', 'мои доставки не загрузились', { error: toApiError(err).message });
      setState((prev) =>
        prev.phase === 'ready' ? { ...prev, staleError: err } : { phase: 'error', error: err },
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, pushVersion]);

  const handleRefresh = useCallback((): void => {
    setRefreshing(true);
    void load();
  }, [load]);

  const deliveries = state.phase === 'ready' ? state.deliveries : [];
  const active = deliveries.filter((d) => d.status === 'assigned' || d.status === 'in_transit');
  const history = deliveries.filter((d) => d.status !== 'assigned' && d.status !== 'in_transit');

  // Тексты ошибок — из единого маппинга (ADR-026).
  const stale =
    state.phase === 'ready' && state.staleError !== undefined
      ? errorContentFor(state.staleError)
      : null;

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Мои доставки"
        subtitle="Активные рейсы и история"
        badge={
          active.length > 0 ? (
            <Badge label={`${active.length} в работе`} variant="attention" />
          ) : undefined
        }
      />

      {state.phase === 'loading' ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton height={180} />
          <Skeleton height={90} />
        </View>
      ) : state.phase === 'error' ? (
        <ErrorState {...errorContentFor(state.error)} onRetry={() => void load()} />
      ) : deliveries.length === 0 ? (
        <EmptyState
          illustration="truck"
          title="Доставок пока нет"
          description="Возьмите заказ в «Радаре» — активный рейс появится здесь с пошаговым сценарием."
          // v0.6.2-C: грузовик-иллюстрация + конкретное действие (ADR-029)
          action={{ label: 'В радар', onPress: () => router.push('/(driver)/radar') }}
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
            {active.map((delivery, index) => (
              <Animated.View
                key={delivery.id}
                entering={FadeInDown.springify()
                  .damping(18)
                  .delay(Math.min(index * 50, 200))}
              >
                <ActiveDeliveryCard delivery={delivery} onFinished={() => void load()} />
              </Animated.View>
            ))}

            {history.length > 0 ? (
              <Text variant="body" weight="600">
                История
              </Text>
            ) : null}
            {history.map((delivery) => (
              <Card key={delivery.id} style={{ gap: spacing.xs }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: spacing.sm,
                  }}
                >
                  <Text variant="body" weight="600" style={{ flex: 1 }}>
                    {delivery.pickup.label ?? delivery.pickup.ownerName}
                    {'  →  '}
                    {delivery.dropoff.label ?? delivery.buyerName}
                  </Text>
                  <Badge
                    label={DELIVERY_STATUS_LABELS[delivery.status]}
                    variant={statusVariant(delivery.status)}
                  />
                </View>
                <Text variant="caption" color="secondary">
                  {delivery.weightKg} кг · {formatClock(delivery.createdAt)}
                </Text>
              </Card>
            ))}
          </View>
        </PullToRefreshScrollView>
      )}
    </Screen>
  );
}

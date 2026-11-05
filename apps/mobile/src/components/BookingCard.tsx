import { useState } from 'react';
import { Alert, View } from 'react-native';
import { BOOKING_STATUS_LABELS } from '@agromoll/types';
import type { BookingDto } from '@agromoll/types';
import { Badge, Button, Card, spacing, Text } from '@agromoll/ui';
import * as Haptics from 'expo-haptics';
import { api, ApiError } from '@/lib/api';
import { bookingBadgeVariant, formatClock, formatQuantity } from '@/lib/format';

export interface BookingCardProps {
  booking: BookingDto;
  /** id покупателя (для запросов). */
  /** Показать детали корректировки (offeredQuantity/pickupTime/note). */
  counterOffer?: { offeredQuantity?: number; pickupTime?: string; note?: string };
  /** Обновить список после действия. */
  onChanged: () => void;
  /** Демо-режим: кнопки не ходят в API. */
  demo: boolean;
}

/**
 * Карточка брони покупателя («Мои брони»): статус-пилюля, количество,
 * время истечения, кнопки «Принять предложение» / «Отменить».
 */
export function BookingCard({ booking, counterOffer, onChanged, demo }: BookingCardProps) {
  const [busy, setBusy] = useState<'accept' | 'cancel' | null>(null);

  const canCancel = booking.status === 'requested' || booking.status === 'counter_offered';
  const canAccept = booking.status === 'counter_offered';

  const run = async (action: 'accept' | 'cancel'): Promise<void> => {
    if (demo) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      Alert.alert(
        'Демо-режим',
        'API недоступен — действие не выполнено. Поднимите pnpm dev, чтобы работать по-настоящему.',
      );
      return;
    }
    setBusy(action);
    try {
      if (action === 'accept') {
        await api.acceptCounter(booking.id);
      } else {
        await api.cancelBooking(booking.id);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      onChanged();
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      const hint = error instanceof ApiError ? error.hint : undefined;
      Alert.alert('Не получилось', hint ?? 'Проверьте соединение с API и попробуйте ещё раз.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card style={{ gap: spacing.md }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: spacing.sm,
        }}
      >
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text variant="title">{booking.listingTitle ?? 'Лот'}</Text>
          <Text variant="caption" color="secondary">
            {formatQuantity(booking.requestedQuantity, booking.listingUnit)}
            {booking.confirmedQuantity !== null
              ? ` → подтверждено ${formatQuantity(booking.confirmedQuantity, booking.listingUnit)}`
              : ''}
            {' · истекает в '}
            {formatClock(booking.expiresAt)}
          </Text>
        </View>
        <Badge
          label={BOOKING_STATUS_LABELS[booking.status]}
          variant={bookingBadgeVariant(booking.status)}
        />
      </View>

      {canAccept && counterOffer ? (
        <Text variant="body" color="onWarning">
          {`Продавец предлагает: ${[counterOffer.offeredQuantity !== undefined ? formatQuantity(counterOffer.offeredQuantity, booking.listingUnit) : undefined, counterOffer.pickupTime, counterOffer.note].filter(Boolean).join(' · ')}`}
        </Text>
      ) : null}

      {canAccept || canCancel ? (
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          {canAccept ? (
            <View style={{ flex: 1 }}>
              <Button
                title="Принять предложение"
                onPress={() => void run('accept')}
                loading={busy === 'accept'}
                disabled={busy !== null}
              />
            </View>
          ) : null}
          {canCancel ? (
            <View style={{ flex: canAccept ? undefined : 1 }}>
              <Button
                title="Отменить"
                variant="ghost"
                onPress={() => void run('cancel')}
                loading={busy === 'cancel'}
                disabled={busy !== null}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

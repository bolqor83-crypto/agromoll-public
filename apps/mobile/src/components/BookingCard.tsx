import { useState } from 'react';
import { Alert, View } from 'react-native';
import { BOOKING_STATUS_LABELS } from '@agromoll/types';
import type { BookingDto } from '@agromoll/types';
import { Badge, Button, Card, spacing, success, tap, Text, warning } from '@agromoll/ui';
import { RatingBadge } from './RatingBadge';
import { acceptCounterMutation, cancelBookingMutation } from '@/lib/outbox/mutations';
import { bookingBadgeVariant, formatClock, formatQuantity } from '@/lib/format';

export interface BookingCardProps {
  booking: BookingDto;
  /** Показать детали корректировки (offeredQuantity/pickupTime/note). */
  counterOffer?: { offeredQuantity?: number; pickupTime?: string; note?: string };
  /** Оптимистичная операция ещё не подтверждена сервером. */
  pendingLabel?: string;
  /** Демо-режим: кнопки не ходят в API. */
  demo: boolean;
  /** Открыть модалку приёмки (v0.4.0-C, только покупатель подтверждённой брони). */
  onConfirmDelivery?: (booking: BookingDto) => void;
}

/**
 * Карточка брони покупателя («Мои брони»): статус-пилюля, количество,
 * время истечения, кнопки «Принять предложение» / «Отменить».
 *
 * v0.3.0: действия уходят через локальный outbox — работают офлайн,
 * UI сразу показывает оптимистичное состояние (список перерисовывает
 * стор по событиям очереди).
 */
export function BookingCard({ booking, counterOffer, pendingLabel, demo, onConfirmDelivery }: BookingCardProps) {
  const [busy, setBusy] = useState<'accept' | 'cancel' | null>(null);

  const canCancel = booking.status === 'requested' || booking.status === 'counter_offered';
  const canAccept = booking.status === 'counter_offered';
  // Приёмка — только покупатель подтверждённой брони (ADR-012).
  const canConfirmDelivery = booking.status === 'confirmed';

  const run = async (action: 'accept' | 'cancel'): Promise<void> => {
    if (demo) {
      tap();
      Alert.alert(
        'Демо-режим',
        'API недоступен — действие не выполнено. Поднимите pnpm dev, чтобы работать по-настоящему.',
      );
      return;
    }
    setBusy(action);
    try {
      if (action === 'accept') {
        await acceptCounterMutation(booking.id);
      } else {
        await cancelBookingMutation(booking.id);
      }
      success();
      // Список обновится сам: событие outbox → version++ → экран перечитает.
    } catch (error) {
      warning();
      Alert.alert('Не получилось', String(error instanceof Error ? error.message : error));
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
          <RatingBadge rating={booking.sellerRating ?? null} short />
          <Text variant="caption" color="secondary">
            {formatQuantity(booking.requestedQuantity, booking.listingUnit)}
            {booking.confirmedQuantity !== null
              ? ` → подтверждено ${formatQuantity(booking.confirmedQuantity, booking.listingUnit)}`
              : ''}
            {' · истекает в '}
            {formatClock(booking.expiresAt)}
          </Text>
        </View>
        <View style={{ gap: spacing.xs, alignItems: 'flex-end' }}>
          <Badge
            label={BOOKING_STATUS_LABELS[booking.status]}
            variant={bookingBadgeVariant(booking.status)}
          />
          {pendingLabel ? (
            <Text variant="caption" color="onWarning">
              {pendingLabel}
            </Text>
          ) : null}
        </View>
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

      {/* Приёмка (v0.4.0-C, ADR-012): confirmed → completed/disputed. */}
      {canConfirmDelivery ? (
        <Button
          title="Подтвердить получение"
          onPress={() => {
            if (demo) {
              tap();
              Alert.alert(
                'Демо-режим',
                'API недоступен — действие не выполнено. Поднимите pnpm dev, чтобы работать по-настоящему.',
              );
              return;
            }
            onConfirmDelivery?.(booking);
          }}
        />
      ) : null}
    </Card>
  );
}

import { useState } from 'react';
import { Alert, View } from 'react-native';
import { BOOKING_STATUS_LABELS } from '@agromoll/types';
import type { BookingDto } from '@agromoll/types';
import { Badge, Button, Card, spacing, success as successHaptic, SuccessCheck, Text, warning } from '@agromoll/ui';
import { RatingBadge } from './RatingBadge';
import { acceptCounterMutation, cancelBookingMutation } from '@/lib/outbox/mutations';
import { bookingBadgeVariant, formatClock, formatQuantity } from '@/lib/format';

export interface BookingCardProps {
  booking: BookingDto;
  /** Показать детали корректировки (offeredQuantity/pickupTime/note). */
  counterOffer?: { offeredQuantity?: number; pickupTime?: string; note?: string };
  /** Оптимистичная операция ещё не подтверждена сервером. */
  pendingLabel?: string;
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
 *
 * v0.6.1-D (ADR-026): демо-ветки убраны — «Мои брони» не показывает
 * выдуманных данных (вариант A).
 */
export function BookingCard({ booking, counterOffer, pendingLabel, onConfirmDelivery }: BookingCardProps) {
  const [busy, setBusy] = useState<'accept' | 'cancel' | null>(null);
  // v0.6.1-E2 (ADR-027): тихая галочка на ~1 с после успешного действия.
  const [flash, setFlash] = useState(false);

  const canCancel = booking.status === 'requested' || booking.status === 'counter_offered';
  const canAccept = booking.status === 'counter_offered';
  // Приёмка — только покупатель подтверждённой брони (ADR-012).
  const canConfirmDelivery = booking.status === 'confirmed';

  const run = async (action: 'accept' | 'cancel'): Promise<void> => {
    setBusy(action);
    try {
      if (action === 'accept') {
        await acceptCounterMutation(booking.id);
      } else {
        await cancelBookingMutation(booking.id);
      }
      successHaptic();
      // v0.6.1-E2 (ADR-027): успех подтверждаем телом — галочка 400 мс spring.
      if (action === 'accept') {
        setFlash(true);
      }
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
      {/* Успех действия — тихая галочка поверх карточки (ADR-027). */}
      {flash ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <SuccessCheck onDone={() => setFlash(false)} />
        </View>
      ) : null}
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
        <Button title="Подтвердить получение" onPress={() => onConfirmDelivery?.(booking)} />
      ) : null}
    </Card>
  );
}

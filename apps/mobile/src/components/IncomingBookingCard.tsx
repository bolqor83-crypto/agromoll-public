import { useState } from 'react';
import { Alert, View } from 'react-native';
import { BOOKING_STATUS_LABELS } from '@agromoll/types';
import type { BookingDto } from '@agromoll/types';
import { Badge, Button, Card, spacing, success, tap, Text, warning } from '@agromoll/ui';
import { RatingBadge } from './RatingBadge';
import { cancelBookingMutation, confirmBookingMutation } from '@/lib/outbox/mutations';
import { CounterOfferModal } from './CounterOfferModal';
import { bookingBadgeVariant, formatClock, formatQuantity } from '@/lib/format';

export interface IncomingBookingCardProps {
  booking: BookingDto;
  /** Оптимистичная операция ещё не подтверждена сервером. */
  pendingLabel?: string;
  /** Демо-режим: действия не ходят в API. */
  demo: boolean;
}

/**
 * Входящая бронь продавца («Входящие»): кто, что, сколько,
 * «Подтвердить» / «Предложить корректировку» / «Отклонить».
 */
export function IncomingBookingCard({ booking, pendingLabel, demo }: IncomingBookingCardProps) {
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [counterOpen, setCounterOpen] = useState(false);

  const canAct = booking.status === 'requested' || booking.status === 'counter_offered';

  const run = async (action: 'confirm' | 'cancel'): Promise<void> => {
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
      if (action === 'confirm') {
        await confirmBookingMutation(booking.id);
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
          <Text variant="title">{booking.buyerName ?? 'Покупатель'}</Text>
          <RatingBadge rating={booking.buyerRating ?? null} short />
          <Text variant="caption" color="secondary">
            {`${booking.listingTitle ?? 'Лот'} · ${formatQuantity(booking.requestedQuantity, booking.listingUnit)} · истекает в ${formatClock(booking.expiresAt)}`}
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

      {booking.status === 'counter_offered' ? (
        <Text variant="caption" color="onWarning">
          Ждём решения покупателя по вашей корректировке.
        </Text>
      ) : null}

      {canAct ? (
        <View style={{ gap: spacing.sm }}>
          {booking.status === 'requested' ? (
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Подтвердить"
                  onPress={() => void run('confirm')}
                  loading={busy === 'confirm'}
                  disabled={busy !== null}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Скорректировать"
                  variant="secondary"
                  onPress={() => {
                    tap();
                    setCounterOpen(true);
                  }}
                  disabled={busy !== null}
                />
              </View>
            </View>
          ) : null}
          <Button
            title="Отклонить"
            variant="ghost"
            size="md"
            onPress={() => void run('cancel')}
            loading={busy === 'cancel'}
            disabled={busy !== null}
          />
        </View>
      ) : null}

      <CounterOfferModal
        visible={counterOpen}
        booking={booking}
        demo={demo}
        onClose={() => setCounterOpen(false)}
        onDone={() => setCounterOpen(false)}
      />
    </Card>
  );
}

import { useState } from 'react';
import { Alert, View } from 'react-native';
import { BOOKING_STATUS_LABELS } from '@agromoll/types';
import type { BookingDto } from '@agromoll/types';
import { Badge, Button, Card, spacing, success as successHaptic, SuccessCheck, tap, Text, warning } from '@agromoll/ui';
import { RatingBadge } from './RatingBadge';
import { cancelBookingMutation, confirmBookingMutation } from '@/lib/outbox/mutations';
import { CounterOfferModal } from './CounterOfferModal';
import { bookingBadgeVariant, formatClock, formatQuantity } from '@/lib/format';

export interface IncomingBookingCardProps {
  booking: BookingDto;
  /** Оптимистичная операция ещё не подтверждена сервером. */
  pendingLabel?: string;
}

/**
 * Входящая бронь продавца («Входящие»): кто, что, сколько,
 * «Подтвердить» / «Предложить корректировку» / «Отклонить».
 *
 * v0.6.1-D (ADR-026): демо-ветка убрана — «Входящие» без фейков (вариант A).
 */
export function IncomingBookingCard({ booking, pendingLabel }: IncomingBookingCardProps) {
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [counterOpen, setCounterOpen] = useState(false);
  // v0.6.1-E2 (ADR-027): тихая галочка после успешного подтверждения.
  const [flash, setFlash] = useState(false);

  const canAct = booking.status === 'requested' || booking.status === 'counter_offered';

  const run = async (action: 'confirm' | 'cancel'): Promise<void> => {
    setBusy(action);
    try {
      if (action === 'confirm') {
        await confirmBookingMutation(booking.id);
      } else {
        await cancelBookingMutation(booking.id);
      }
      successHaptic();
      // v0.6.1-E2 (ADR-027): галочка 400 мс spring — подтверждение телом.
      if (action === 'confirm') {
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
        onClose={() => setCounterOpen(false)}
        onDone={() => setCounterOpen(false)}
      />
    </Card>
  );
}

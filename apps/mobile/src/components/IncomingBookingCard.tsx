import { useState } from 'react';
import { Alert, View } from 'react-native';
import { BOOKING_STATUS_LABELS } from '@agromoll/types';
import type { BookingDto } from '@agromoll/types';
import { Badge, Button, Card, spacing, Text } from '@agromoll/ui';
import * as Haptics from 'expo-haptics';
import { api, ApiError } from '@/lib/api';
import { CounterOfferModal } from './CounterOfferModal';
import { bookingBadgeVariant, formatClock, formatQuantity } from '@/lib/format';

export interface IncomingBookingCardProps {
  booking: BookingDto;
  /** id продавца (для запросов). */
  userId: string;
  /** Обновить список после действия. */
  onChanged: () => void;
  /** Демо-режим: действия не ходят в API. */
  demo: boolean;
}

/**
 * Входящая бронь продавца («Входящие»): кто, что, сколько,
 * «Подтвердить» / «Предложить корректировку» / «Отклонить».
 */
export function IncomingBookingCard({
  booking,
  userId,
  onChanged,
  demo,
}: IncomingBookingCardProps) {
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [counterOpen, setCounterOpen] = useState(false);

  const canAct = booking.status === 'requested' || booking.status === 'counter_offered';

  const run = async (action: 'confirm' | 'cancel'): Promise<void> => {
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
      if (action === 'confirm') {
        await api.confirmBooking(userId, booking.id);
      } else {
        await api.cancelBooking(userId, booking.id);
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
          <Text variant="title">{booking.buyerName ?? 'Покупатель'}</Text>
          <Text variant="caption" color="secondary">
            {`${booking.listingTitle ?? 'Лот'} · ${formatQuantity(booking.requestedQuantity, booking.listingUnit)} · истекает в ${formatClock(booking.expiresAt)}`}
          </Text>
        </View>
        <Badge
          label={BOOKING_STATUS_LABELS[booking.status]}
          variant={bookingBadgeVariant(booking.status)}
        />
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
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                      () => undefined,
                    );
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
        userId={userId}
        demo={demo}
        onClose={() => setCounterOpen(false)}
        onDone={() => {
          setCounterOpen(false);
          onChanged();
        }}
      />
    </Card>
  );
}

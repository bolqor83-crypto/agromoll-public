import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, View } from 'react-native';
import type { BookingDto } from '@agromoll/types';
import { Button, Card, Input, spacing, Text, useTheme } from '@agromoll/ui';
import * as Haptics from 'expo-haptics';
import { api, ApiError } from '@/lib/api';

export interface CounterOfferModalProps {
  visible: boolean;
  booking: BookingDto;
  userId: string;
  demo: boolean;
  onClose: () => void;
  /** Успешная корректировка. */
  onDone: () => void;
}

/**
 * Модалка корректировки брони (seller): предложить другое количество,
 * время выкупа или комментарий. Отправка — POST /bookings/:id/counter-offer.
 */
export function CounterOfferModal({
  visible,
  booking,
  userId,
  demo,
  onClose,
  onDone,
}: CounterOfferModalProps) {
  const { colors } = useTheme();
  const [quantity, setQuantity] = useState(String(booking.requestedQuantity));
  const [pickupTime, setPickupTime] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const parsedQuantity = useMemo(() => Number.parseInt(quantity, 10), [quantity]);
  const quantityValid = Number.isInteger(parsedQuantity) && parsedQuantity > 0;
  const canSend = quantityValid || pickupTime.trim().length > 0 || note.trim().length > 0;

  const send = async (): Promise<void> => {
    if (demo) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      Alert.alert('Демо-режим', 'API недоступен — корректировка не отправлена.');
      onClose();
      return;
    }
    setSending(true);
    try {
      await api.counterOffer(userId, booking.id, {
        offeredQuantity: quantityValid ? parsedQuantity : undefined,
        pickupTime: pickupTime.trim() || undefined,
        note: note.trim() || undefined,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      onDone();
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      const hint = error instanceof ApiError ? error.hint : undefined;
      Alert.alert('Не получилось', hint ?? 'Проверьте соединение с API и попробуйте ещё раз.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,20,17,0.45)' }}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          <Card elevated style={{ gap: spacing.lg }}>
            <View style={{ gap: spacing.xs }}>
              <Text variant="title">Предложить корректировку</Text>
              <Text variant="caption" color="secondary">
                {`${booking.buyerName ?? 'Покупатель'} просит ${booking.requestedQuantity}. Предложите другое количество или условия выкупа — покупатель решит.`}
              </Text>
            </View>

            <View style={{ gap: spacing.xs }}>
              <Text variant="caption" color="secondary">
                Количество ({booking.listingUnit ?? 'ед.'})
              </Text>
              <Input
                placeholder={String(booking.requestedQuantity)}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="number-pad"
              />
            </View>

            <View style={{ gap: spacing.xs }}>
              <Text variant="caption" color="secondary">
                Когда выдать
              </Text>
              <Input
                placeholder="например, после 9:00"
                value={pickupTime}
                onChangeText={setPickupTime}
              />
            </View>

            <View style={{ gap: spacing.xs }}>
              <Text variant="caption" color="secondary">
                Комментарий
              </Text>
              <Input placeholder="например, ящиками по 20 кг" value={note} onChangeText={setNote} />
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Button title="Отмена" variant="ghost" onPress={onClose} disabled={sending} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Отправить"
                  onPress={() => void send()}
                  loading={sending}
                  disabled={!canSend || sending}
                />
              </View>
            </View>
            <View
              style={{
                height: 2,
                borderRadius: 1,
                backgroundColor: colors.border,
                alignSelf: 'center',
                width: 36,
              }}
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * ConfirmDeliveryModal — приёмка товара (v0.4.0-C, ADR-012).
 *
 * Количество (по умолчанию = подтверждённому), оценка качества
 * (ok / minor / major) и опциональный комментарий. При major —
 * предупреждение: «Это создаст спор, продавец получит уведомление».
 * Отправка — через офлайн-ядро (confirm_delivery): работает и без сети.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Input, Text, spacing, useTheme } from '@agromoll/ui';
import { QUALITY_FLAG_LABELS, QUALITY_FLAGS } from '@agromoll/types';
import type { BookingDto, QualityFlag } from '@agromoll/types';
import { SheetModal } from '@/components/SheetModal';
import { confirmDeliveryMutation } from '@/lib/outbox/mutations';
import { pressFeedback } from '@/lib/feedback';

export interface ConfirmDeliveryModalProps {
  visible: boolean;
  booking: BookingDto | null;
  onClose: () => void;
}

export function ConfirmDeliveryModal({ visible, booking, onClose }: ConfirmDeliveryModalProps) {
  const { colors } = useTheme();
  const defaultQuantity = booking?.confirmedQuantity ?? booking?.requestedQuantity ?? 1;
  const [quantityText, setQuantityText] = useState(String(defaultQuantity));
  const [qualityFlag, setQualityFlag] = useState<QualityFlag>('ok');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setQuantityText(String(defaultQuantity));
      setQualityFlag('ok');
      setNotes('');
      setError(null);
      setSubmitting(false);
    }
  }, [visible, defaultQuantity]);

  const quantity = Number.parseInt(quantityText, 10);
  const quantityValid = useMemo(
    () => Number.isInteger(quantity) && quantity > 0 && quantity <= 1_000_000,
    [quantity],
  );
  const canSubmit = quantityValid && !submitting && booking !== null;

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!booking || !quantityValid) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await pressFeedback('booking:confirm-delivery');
      await confirmDeliveryMutation(booking.id, {
        receivedQuantity: quantity,
        qualityFlag,
        ...(notes.trim() ? { qualityNotes: notes.trim() } : {}),
      });
      onClose();
    } catch (mutationError) {
      setError(String(mutationError));
      setSubmitting(false);
    }
  }, [booking, quantityValid, quantity, qualityFlag, notes, onClose]);

  return (
    <SheetModal
      visible={visible}
      onClose={submitting ? () => undefined : onClose}
      footer={
        // v0.6.1-C (ADR-025): primary-кнопка прибита к низу листа,
        // не «плавает» в середине контента при коротких карточках.
        <Button
          title={submitting ? 'Подтверждаем…' : 'Подтвердить получение'}
          variant="primary"
          size="lg"
          disabled={!canSubmit}
          loading={submitting}
          onPress={() => void handleSubmit()}
        />
      }
    >
      <View style={{ gap: spacing.md }}>
        <Text variant="title">Подтвердить получение</Text>
        <Text variant="caption" color="secondary">
          {booking?.listingTitle ?? 'Лот'} · подтверждено{' '}
          {defaultQuantity} {booking?.listingUnit === 'kg' ? 'кг' : booking?.listingUnit === 'box' ? 'ящ.' : 'шт'}
        </Text>

        <Input
          label="Фактически получено"
          value={quantityText}
          onChangeText={(text) => {
            setQuantityText(text.replace(/[^\d]/g, ''));
            setError(null);
          }}
          keyboardType="number-pad"
          error={
            quantityText.length > 0 && !quantityValid
              ? 'Количество — целое положительное число'
              : quantityValid && quantity < defaultQuantity
                ? 'Получили меньше подтверждённого — отметим как «мелкие проблемы»'
                : null
          }
        />

        <View style={{ gap: spacing.xs }}>
          <Text variant="caption" color="secondary">
            Качество поставки
          </Text>
          {QUALITY_FLAGS.map((flag) => (
            <Pressable
              key={flag}
              onPress={() => setQualityFlag(flag)}
              accessibilityRole="button"
              accessibilityState={{ selected: flag === qualityFlag }}
              style={{
                borderWidth: 1,
                borderRadius: 12,
                borderColor: flag === qualityFlag ? colors.primary : colors.border,
                backgroundColor: flag === qualityFlag ? colors.primaryMuted : colors.surface,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm + 2,
              }}
            >
              <Text variant="body" weight="600" color={flag === qualityFlag ? 'primary' : 'text'}>
                {QUALITY_FLAG_LABELS[flag]}
              </Text>
            </Pressable>
          ))}
        </View>

        {qualityFlag === 'major_issue' ? (
          <Text variant="caption" color="warning">
            Это создаст спор: продавец получит уведомление, бронь перейдёт
            в статус «Спор по приёмке». Опишите проблему в комментарии.
          </Text>
        ) : null}

        <Input
          label="Комментарий (необязательно)"
          value={notes}
          onChangeText={setNotes}
          placeholder={qualityFlag === 'major_issue' ? 'Что именно не так' : 'Например, всё свежее'}
          multiline
        />

        {error ? (
          <Text variant="caption" color="warning">
            {error}
          </Text>
        ) : null}
      </View>
    </SheetModal>
  );
}

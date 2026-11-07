/**
 * OpenDisputeSheet — эскалация сделки в арбитраж (v0.6.0-C, ADR-033).
 *
 * Сторона описывает суть претензии; причина становится первым
 * сообщением кейса. Онлайн-процедура: без сети спор не открыть —
 * осознанно (отправленный из лифта «спор» без объяснений бесполезен
 * арбитру). 409 «уже идёт спор» показываем мягко: значит, кейс открыт.
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Input, Text, spacing } from '@agromoll/ui';
import { DISPUTE_TYPE_LABELS } from '@agromoll/types';
import type { DisputeType } from '@agromoll/types';
import { SheetModal } from '@/components/SheetModal';
import { api, isInvalidResponseError, toApiError } from '@/lib/api';
import { logger } from '@/lib/logger';
import { pressFeedback } from '@/lib/feedback';

export interface OpenDisputeSheetProps {
  visible: boolean;
  /** Тип спорного объекта. */
  type: DisputeType;
  /** id объекта (брони/доставки/долга). */
  referenceId: string;
  /** Краткое имя объекта для заголовка (название лота, сумма долга…). */
  subject: string;
  onClose: () => void;
  /** Спор открыт (экран перечитает список/карточку). */
  onOpened?: () => void;
}

const MIN_REASON = 10;

export function OpenDisputeSheet({
  visible,
  type,
  referenceId,
  subject,
  onClose,
  onOpened,
}: OpenDisputeSheetProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setReason('');
      setError(null);
      setSubmitting(false);
    }
  }, [visible]);

  const canSubmit = reason.trim().length >= MIN_REASON && !submitting;

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await pressFeedback('dispute:open');
      await api.openDispute({ type, referenceId, reason: reason.trim() });
      onOpened?.();
      onClose();
    } catch (submitError) {
      const apiError = toApiError(submitError);
      if (apiError.status === 409) {
        // Уже есть активный спор — не ошибка, а состояние сделки.
        setError('По этой сделке уже идёт спор — откройте «Споры».');
      } else if (isInvalidResponseError(submitError)) {
        setError('Сервер ответил неожиданно. Попробуйте ещё раз.');
      } else {
        setError(apiError.message);
      }
      logger.warn('disputes', 'открыть спор не удалось', {
        type,
        referenceId,
        error: apiError.message,
      });
      setSubmitting(false);
    }
  }, [canSubmit, reason, type, referenceId, onOpened, onClose]);

  return (
    <SheetModal
      visible={visible}
      onClose={submitting ? () => undefined : onClose}
      footer={
        <Button
          title={submitting ? 'Открываем…' : 'Открыть спор'}
          variant="primary"
          size="lg"
          disabled={!canSubmit}
          loading={submitting}
          onPress={() => void handleSubmit()}
        />
      }
    >
      <View style={{ gap: spacing.md }}>
        <Text variant="title">Спор: {DISPUTE_TYPE_LABELS[type]}</Text>
        <Text variant="caption" color="secondary">
          {subject}. Нейтральный арбитр рынка рассмотрит спор: объект сделки
          будет заморожен до решения, обе стороны получат уведомления.
        </Text>
        <Input
          label="Что случилось (минимум 10 символов)"
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={4}
          placeholder="Например: половина ящиков приехала разбитой, продавец отказывается менять товар"
          textAlignVertical="top"
        />
        {error ? (
          <Text variant="caption" color="onWarning">
            {error}
          </Text>
        ) : null}
      </View>
    </SheetModal>
  );
}

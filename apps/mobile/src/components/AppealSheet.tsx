/**
 * AppealSheet — обжалование блокировки 289-ФЗ в арбитраж (v0.6.0-E, ADR-035).
 *
 * Сторона пары (водитель или продавец) описывает, почему блокировка
 * ошибочна; арбитр увидит суть жалобы и историю часов пары. Онлайн-
 * процедура: без сети апелляцию не открыть — осознанно (жалоба «из
 * лифта» без объяснений арбитру бесполезна). 409 «уже идёт апелляция»
 * показываем мягко: значит, кейс уже открыт.
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Input, Text, spacing } from '@agromoll/ui';
import { SheetModal } from '@/components/SheetModal';
import { api, isInvalidResponseError, toApiError } from '@/lib/api';
import { logger } from '@/lib/logger';
import { pressFeedback } from '@/lib/feedback';

export interface AppealSheetProps {
  visible: boolean;
  /** Активная блокировка пары (id из строки «Мои часы»). */
  blockedPairId: string;
  /** Имя контрагента для заголовка. */
  counterpartName: string;
  onClose: () => void;
  /** Апелляция открыта (экран перечитает список пар). */
  onOpened?: () => void;
}

const MIN_REASON = 10;

export function AppealSheet({
  visible,
  blockedPairId,
  counterpartName,
  onClose,
  onOpened,
}: AppealSheetProps) {
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
      await pressFeedback('appeal:open');
      await api.openAppeal({ blockedPairId, reason: reason.trim() });
      onOpened?.();
      onClose();
    } catch (submitError) {
      const apiError = toApiError(submitError);
      if (apiError.status === 409) {
        // По блокировке уже идёт апелляция — не ошибка, а состояние пары.
        setError('По этой блокировке уже идёт апелляция — дождитесь решения арбитра.');
      } else if (isInvalidResponseError(submitError)) {
        setError('Сервер ответил неожиданно. Попробуйте ещё раз.');
      } else {
        setError(apiError.message);
      }
      logger.warn('appeals', 'открыть апелляцию не удалось', {
        blockedPairId,
        error: apiError.message,
      });
      setSubmitting(false);
    }
  }, [canSubmit, reason, blockedPairId, onOpened, onClose]);

  return (
    <SheetModal
      visible={visible}
      onClose={submitting ? () => undefined : onClose}
      footer={
        <Button
          title={submitting ? 'Отправляем…' : 'Отправить в арбитраж'}
          variant="primary"
          size="lg"
          disabled={!canSubmit}
          loading={submitting}
          onPress={() => void handleSubmit()}
        />
      }
    >
      <View style={{ gap: spacing.md }}>
        <Text variant="title">Оспорить блокировку</Text>
        <Text variant="caption" color="secondary">
          Пара с {counterpartName} приостановлена по 289-ФЗ. Если часы считались неверно или
          блокировка ошибочна — арбитр рынка рассмотрит вашу жалобу и снимет паузу, если правда на
          вашей стороне.
        </Text>
        <Input
          label="Что случилось (минимум 10 символов)"
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={4}
          placeholder="Например: смены закрывались дважды из-за отменённых доставок, часы задвоились"
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

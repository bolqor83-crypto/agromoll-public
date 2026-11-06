/**
 * CreateDebtModal — форма «отпустил в долг» (v0.4.0, ADR-010).
 *
 * SheetModal-лист: выбор контрагента (только те, с кем уже были сделки —
 * защита от долгов «в пустоту», список даёт GET /debts/counterparties),
 * сумма и описание. Дисклеймер «платформа — не платёжный агент»
 * присутствует всегда (требование оферты и ADR-010).
 *
 * Отправка — через офлайн-ядро (createDebtMutation): работает и без сети,
 * карточка появится как оптимистичная, сервер подтвердит позже.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Button, Input, ShakeField, Text, spacing, useTheme } from '@agromoll/ui';
import { SheetModal } from '@/components/SheetModal';
import type { CounterpartyDto } from '@agromoll/types';
import { DEBT_MAX_AMOUNT } from '@agromoll/validation';
import { createDebtMutation } from '@/lib/outbox/debt-mutations';
import { pressFeedback } from '@/lib/feedback';

export interface CreateDebtModalProps {
  visible: boolean;
  onClose: () => void;
  /** С кем уже были сделки — загружает экран. */
  counterparties: CounterpartyDto[];
  /** Контрагенты ещё грузятся. */
  counterpartiesLoading?: boolean;
}

export function CreateDebtModal({
  visible,
  onClose,
  counterparties,
  counterpartiesLoading = false,
}: CreateDebtModalProps) {
  const { colors } = useTheme();
  const [debtorId, setDebtorId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // v0.6.1-E2 (ADR-027): покачивание суммы, когда она стала невалидной
  // (выше лимита / не число) — ошибка валидации ощущается телом.
  const [amountShake, setAmountShake] = useState(0);

  // Сброс формы при каждом открытии.
  useEffect(() => {
    if (visible) {
      setDebtorId(null);
      setAmountText('');
      setDescription('');
      setError(null);
      setSubmitting(false);
    }
  }, [visible]);

  const amount = Number.parseFloat(amountText.replace(',', '.'));
  const amountValid = useMemo(
    () =>
      Number.isFinite(amount) &&
      amount > 0 &&
      amount <= DEBT_MAX_AMOUNT &&
      Math.round(amount * 100) === amount * 100,
    [amount],
  );

  // Невалидное значение ПОСЛЕ валидного (или первое же «слишком много»)
  // — качаем поле: пользователь ещё держит телефон в руках и может поправить.
  const amountWasValid = useRef(true);
  useEffect(() => {
    if (amountText.length > 0 && !amountValid && amountWasValid.current) {
      setAmountShake((k) => k + 1);
    }
    amountWasValid.current = amountValid || amountText.length === 0;
  }, [amountValid, amountText]);

  const canSubmit = debtorId !== null && amountValid && !submitting;

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!debtorId || !amountValid) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await pressFeedback('debt:create');
      const counterparty = counterparties.find((c) => c.id === debtorId);
      await createDebtMutation({
        debtorId,
        amount,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(counterparty ? { debtorName: counterparty.displayName } : {}),
      });
      onClose();
    } catch (mutationError) {
      setError(String(mutationError));
      setSubmitting(false);
    }
  }, [debtorId, amountValid, amount, description, counterparties, onClose]);

  return (
    <SheetModal visible={visible} onClose={submitting ? () => undefined : onClose}>
      <View style={{ gap: spacing.md }}>
        <Text variant="title">Отпустить в долг</Text>
        <Text variant="caption" color="secondary">
          Запись об договорённости. Деньги передаются напрямую — платформа не является
          платёжным агентом.
        </Text>

        {counterpartiesLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : counterparties.length === 0 ? (
          <Text variant="body" color="secondary">
            Пока нет контрагентов: список соберётся после первых сделок на рынке.
          </Text>
        ) : (
          <View style={{ gap: spacing.xs }}>
            <Text variant="caption" color="secondary">
              Контрагент (только те, с кем были сделки)
            </Text>
            <View style={{ gap: spacing.xs }}>
              {counterparties.map((candidate) => (
                <Pressable
                  key={candidate.id}
                  onPress={() => setDebtorId(candidate.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: candidate.id === debtorId }}
                  style={{
                    borderWidth: 1,
                    borderRadius: 12,
                    borderColor: candidate.id === debtorId ? colors.primary : colors.border,
                    backgroundColor:
                      candidate.id === debtorId ? colors.primaryMuted : colors.surface,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm + 2,
                  }}
                >
                  <Text
                    variant="body"
                    weight="600"
                    color={candidate.id === debtorId ? 'primary' : 'text'}
                  >
                    {candidate.displayName}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <ShakeField shakeKey={amountShake}>
          <Input
            label={`Сумма, ₽ (до ${DEBT_MAX_AMOUNT.toLocaleString('ru-RU')})`}
            value={amountText}
            onChangeText={(text) => {
              setAmountText(text.replace(/[^\d.,]/g, ''));
              setError(null);
            }}
            keyboardType="decimal-pad"
            placeholder="12500"
            error={
              amountText.length > 0 && !amountValid
                ? 'Сумма — от 1 ₽ до 1 000 000 ₽, максимум две цифры после запятой'
                : null
            }
          />
        </ShakeField>
        <Input
          label="Описание (необязательно)"
          value={description}
          onChangeText={setDescription}
          placeholder="Помидоры, 2 ящика"
          multiline
        />

        {error ? (
          <Text variant="caption" color="secondary">
            {error}
          </Text>
        ) : null}

        <Button
          title={submitting ? 'Записываем…' : 'Отпустить в долг'}
          variant="primary"
          size="lg"
          disabled={!canSubmit}
          loading={submitting}
          onPress={() => void handleSubmit()}
        />
      </View>
    </SheetModal>
  );
}

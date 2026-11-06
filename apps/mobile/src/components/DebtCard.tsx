/**
 * DebtCard — карточка долга (v0.4.0, ADR-010).
 *
 * Минимум текста: контрагент, сумма, дата, статус-pill. Действия —
 * по роли смотрящего и статусу:
 *   active: кредитор — «Погасить»/«Напомнить»/«Спор», дебитор — «Погасить»/«Спор»;
 *   disputed: «Согласен» (обоюдное разрешение) или «Ждём вторую сторону»;
 *   settled: без действий.
 * Платформа не платёжный агент — дисклеймер живёт на экране и в форме.
 */
import { useMemo } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Badge, Button, Card, Icon, Text, spacing } from '@agromoll/ui';
import { DEBT_STATUS_LABELS } from '@agromoll/types';
import type { DebtDto } from '@agromoll/types';
import { RatingBadge } from './RatingBadge';
import { debtBadgeVariant, formatClock, formatMoney } from '@/lib/format';

export interface DebtCardProps {
  debt: DebtDto;
  /** id смотрящего: определяет роль (кредитор/дебитор) и набор кнопок. */
  viewerId: string;
  /** Идёт ли уже операция по этому долгу (оптимистичный override есть). */
  pending?: boolean;
  onSettle: (debt: DebtDto) => void;
  onDispute: (debt: DebtDto) => void;
  onResolve: (debt: DebtDto) => void;
  onRemind: (debt: DebtDto) => void;
}

export function DebtCard({
  debt,
  viewerId,
  pending = false,
  onSettle,
  onDispute,
  onResolve,
  onRemind,
}: DebtCardProps) {
  const isCreditor = debt.creditorId === viewerId;
  const counterparty = isCreditor ? debt.debtorName : debt.creditorName;
  // Рейтинг контрагента — чей долг смотрю, тот и показан (ADR-013).
  const counterpartyRating = isCreditor ? debt.debtorRating : debt.creditorRating;

  const statusBadge = useMemo(() => {
    if (debt.isOverdue) {
      return <Badge label="Просрочен · 30+ дней" variant="attention" />;
    }
    return (
      <Badge label={DEBT_STATUS_LABELS[debt.status]} variant={debtBadgeVariant(debt.status)} />
    );
  }, [debt.status, debt.isOverdue]);

  return (
    <Animated.View entering={FadeInDown.springify().damping(18)}>
      <Card>
        <View style={{ gap: spacing.sm }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: spacing.sm,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="body" weight="600" numberOfLines={1}>
                {counterparty ?? 'Контрагент'}
              </Text>
              <RatingBadge rating={counterpartyRating ?? null} short />
              <Text variant="caption" color="secondary">
                {isCreditor ? 'Вам должны' : 'Вы должны'} · {formatClock(debt.createdAt)}
              </Text>
            </View>
            {statusBadge}
          </View>

          <Text variant="title" numeric>
            {formatMoney(debt.amount)}
          </Text>

          {debt.description ? (
            <Text variant="body" color="secondary" numberOfLines={2}>
              {debt.description}
            </Text>
          ) : null}

          {debt.status === 'disputed' ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.xs,
              }}
            >
              <Icon name="information-circle-outline" size={16} />
              <Text variant="caption" color="secondary" style={{ flex: 1 }}>
                {debt.resolveRequestedById === viewerId
                  ? 'Вы предложили закрыть спор. Ждём подтверждения второй стороны.'
                  : debt.resolveRequestedById
                    ? 'Вторая сторона предлагает закрыть спор. Подтвердите, если согласны.'
                    : 'Спор открыт. Любая сторона может предложить обоюдное закрытие.'}
              </Text>
            </View>
          ) : null}

          {renderActions()}
        </View>
      </Card>
    </Animated.View>
  );

  function renderActions() {
    if (debt.status === 'settled' || debt.status === 'cancelled') {
      return null;
    }

    if (debt.status === 'disputed') {
      // Повторное подтверждение той же стороны — ждём вторую (сервер 409).
      const waiting = debt.resolveRequestedById === viewerId;
      return (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button
            title={waiting ? 'Ждём вторую сторону' : 'Согласен закрыть спор'}
            variant={waiting ? 'secondary' : 'primary'}
            size="md"
            disabled={waiting || pending}
            onPress={() => onResolve(debt)}
            style={{ flex: 1 }}
          />
        </View>
      );
    }

    // active: обе стороны могут подтвердить погашение; кредитор — напомнить.
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Button
          title="Погасить"
          variant="primary"
          size="md"
          disabled={pending}
          onPress={() => onSettle(debt)}
          style={{ flexGrow: 1 }}
        />
        {isCreditor ? (
          <Button
            title="Напомнить"
            variant="secondary"
            size="md"
            disabled={pending || !debt.canRemind}
            onPress={() => onRemind(debt)}
            style={{ flexGrow: 1 }}
          />
        ) : null}
        <Button
          title="Спор"
          variant="ghost"
          size="md"
          disabled={pending}
          onPress={() => onDispute(debt)}
          style={{ flexGrow: 1 }}
        />
      </View>
    );
  }
}

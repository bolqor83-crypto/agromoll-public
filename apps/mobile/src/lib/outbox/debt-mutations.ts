/**
 * Мутации долгов через outbox (v0.4.0, ADR-010/ADR-006).
 *
 * Создание, погашение и спор работают офлайн: операция попадает в
 * локальную очередь, UI сразу показывает оптимистичное состояние.
 * Напоминание (remindDebt) — прямой вызов API: оно осмысленно только
 * при живой сети, офлайн-очередь для него не нужна.
 *
 * Оптимистичная модель:
 *  - create_debt → псевдо-карточка долга (pendingDebtCreates);
 *  - settle/dispute/resolve → локальный override статуса (debtOverrides).
 * Когда сервер подтверждает (событие completed) — оптимистичное
 * состояние убирается, экран перечитывает данные (version++).
 */
import type { DebtStatus } from '@agromoll/types';
import { api } from '../api';
import { getOutbox } from './outbox-instance';
import { useOutboxStore } from '@/store/outbox';

/** Записать «отпустил в долг» (кредитор). Возвращает clientUuid. */
export async function createDebtMutation(input: {
  debtorId: string;
  amount: number;
  description?: string;
  debtorName?: string;
}): Promise<string> {
  const outbox = await getOutbox();
  // В payload — ТОЛЬКО поля CreateDebtSchema (strict): доп. поля для
  // оптимистичного UI живут в pendingDebtCreates, а не в запросе.
  const record = await outbox.enqueue('create_debt', {
    debtorId: input.debtorId,
    amount: input.amount,
    ...(input.description !== undefined ? { description: input.description } : {}),
  });
  useOutboxStore.getState().addPendingDebtCreate(record.clientUuid, {
    debtorId: input.debtorId,
    debtorName: input.debtorName,
    amount: input.amount,
    description: input.description,
    createdAt: record.createdAt,
  });
  void outbox.processQueue().catch(() => undefined);
  return record.clientUuid;
}

/** Погасить долг (любая сторона). */
export async function settleDebtMutation(debtId: string): Promise<string> {
  return enqueueWithDebtOverride('settle_debt', { debtId }, debtId, 'settled');
}

/** Открыть спор (любая сторона). */
export async function disputeDebtMutation(debtId: string, reason?: string): Promise<string> {
  return enqueueWithDebtOverride(
    'dispute_debt',
    { debtId, ...(reason !== undefined ? { reason } : {}) },
    debtId,
    'disputed',
  );
}

/**
 * Разрешить спор обоюдно. Оптимистичный статус зависит от того, первое
 * это подтверждение (спор остаётся открытым — ждём вторую сторону) или
 * второе (спор закрыт → settled): экран знает resolveRequestedById.
 */
export async function resolveDebtMutation(
  debtId: string,
  optimisticStatus: DebtStatus,
): Promise<string> {
  return enqueueWithDebtOverride('resolve_debt', { debtId }, debtId, optimisticStatus);
}

/**
 * Напомнить дебитору (только кредитор). Прямой вызов: напоминание
 * осмысленно только онлайн, кулдаун 24 ч считает сервер (429 → hint).
 */
export async function remindDebt(debtId: string): Promise<{ nextReminderAt: string }> {
  const result = await api.remindDebt(debtId);
  return { nextReminderAt: result.nextReminderAt };
}

async function enqueueWithDebtOverride(
  operationType: 'settle_debt' | 'dispute_debt' | 'resolve_debt',
  payload: Record<string, unknown>,
  debtId: string,
  optimisticStatus: DebtStatus,
): Promise<string> {
  const outbox = await getOutbox();
  const record = await outbox.enqueue(operationType, payload);
  useOutboxStore.getState().setDebtOverride(debtId, optimisticStatus, record.clientUuid);
  void outbox.processQueue().catch(() => undefined);
  return record.clientUuid;
}

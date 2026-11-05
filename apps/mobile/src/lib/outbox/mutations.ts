/**
 * Мутации броней через outbox (v0.3.0, ADR-006).
 *
 * ВСЕ мутации броней идут только здесь: экраны вызывают эти функции,
 * операция попадает в локальную очередь, UI сразу показывает
 * оптимистичное состояние, отправка — когда есть сеть.
 *
 * Оптимистичная модель:
 *  - create_booking → псевдо-карточка брони (pendingCreates);
 *  - cancel/confirm/accept-counter/counter-offer → локальный override
 *    статуса существующей брони.
 * Когда сервер подтверждает (событие completed) — оптимистичное
 * состояние убирается, экраны перечитывают данные (version++).
 */
import type { BookingStatus } from '@agromoll/types';
import { getOutbox } from './outbox-instance';
import { useOutboxStore } from '@/store/outbox';

/** Создать бронь (buyer). Возвращает clientUuid операции. */
export async function createBookingMutation(input: {
  listingId: string;
  requestedQuantity: number;
  listingTitle?: string;
  listingUnit?: string;
}): Promise<string> {
  const outbox = await getOutbox();
  const record = await outbox.enqueue('create_booking', {
    listingId: input.listingId,
    requestedQuantity: input.requestedQuantity,
  });
  useOutboxStore.getState().addPendingCreate(record.clientUuid, {
    listingId: input.listingId,
    listingTitle: input.listingTitle,
    listingUnit: input.listingUnit,
    requestedQuantity: input.requestedQuantity,
    createdAt: record.createdAt,
  });
  void outbox.processQueue().catch(() => undefined);
  return record.clientUuid;
}

/** Отменить бронь (любая сторона). */
export async function cancelBookingMutation(bookingId: string, reason?: string): Promise<string> {
  return enqueueWithOverride(
    'cancel_booking',
    { bookingId, ...(reason ? { reason } : {}) },
    bookingId,
    'cancelled',
  );
}

/** Подтвердить бронь (seller). */
export async function confirmBookingMutation(bookingId: string): Promise<string> {
  return enqueueWithOverride('confirm_booking', { bookingId }, bookingId, 'confirmed');
}

/** Принять корректировку (buyer). */
export async function acceptCounterMutation(bookingId: string): Promise<string> {
  return enqueueWithOverride('accept_counter_booking', { bookingId }, bookingId, 'confirmed');
}

/** Предложить корректировку (seller). */
export async function counterOfferMutation(
  bookingId: string,
  body: { offeredQuantity?: number; pickupTime?: string; note?: string },
): Promise<string> {
  return enqueueWithOverride(
    'counter_offer_booking',
    { bookingId, ...body },
    bookingId,
    'counter_offered',
  );
}

async function enqueueWithOverride(
  operationType:
    'cancel_booking' | 'confirm_booking' | 'accept_counter_booking' | 'counter_offer_booking',
  payload: Record<string, unknown>,
  bookingId: string,
  optimisticStatus: BookingStatus,
): Promise<string> {
  const outbox = await getOutbox();
  const record = await outbox.enqueue(operationType, payload);
  useOutboxStore.getState().setOverride(bookingId, optimisticStatus, record.clientUuid);
  void outbox.processQueue().catch(() => undefined);
  return record.clientUuid;
}

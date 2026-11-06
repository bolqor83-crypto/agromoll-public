/**
 * Мутации доставки через outbox (v0.5.0, ADR-015).
 *
 * Создание запроса работает офлайн (create_delivery в очереди):
 * покупатель может оформить доставку прямо с рынка без сети —
 * очередь отправит при появлении соединения (ADR-006).
 *
 * Взятие и шаги — прямые вызовы api.* (онлайн): сервер в момент
 * взятия проверяет BlockedPair (289-ФЗ) и открытые смены — офлайн-очередь
 * здесь исказила бы смысл (ADR-015).
 */
import { getOutbox } from './outbox-instance';

/** Покупатель просит подвезти. Возвращает clientUuid очереди. */
export async function createDeliveryMutation(input: {
  pickupPointId: string;
  dropoffPointId: string;
  weightKg: number;
  description?: string;
  bookingId?: string;
}): Promise<string> {
  const outbox = await getOutbox();
  const record = await outbox.enqueue('create_delivery', {
    pickupPointId: input.pickupPointId,
    dropoffPointId: input.dropoffPointId,
    weightKg: input.weightKg,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.bookingId !== undefined ? { bookingId: input.bookingId } : {}),
  });
  void outbox.processQueue().catch(() => undefined);
  return record.clientUuid;
}

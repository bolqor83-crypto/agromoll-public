/**
 * Карта «тип операции → эндпоинт» (v0.3.0).
 * Совпадает с @Idempotent-разметкой на сервере (bookings.controller.ts).
 */
import type { OutboxOperationType } from './types';

export interface OutboxEndpoint {
  method: 'POST';
  url: string | ((payload: Record<string, unknown>) => string);
}

export const IDEMPOTENCY_ENDPOINTS: Record<OutboxOperationType, OutboxEndpoint> = {
  create_booking: { method: 'POST', url: '/bookings' },
  cancel_booking: {
    method: 'POST',
    url: (p) => `/bookings/${String(p.bookingId)}/cancel`,
  },
  confirm_booking: {
    method: 'POST',
    url: (p) => `/bookings/${String(p.bookingId)}/confirm`,
  },
  counter_offer_booking: {
    method: 'POST',
    url: (p) => `/bookings/${String(p.bookingId)}/counter-offer`,
  },
  accept_counter_booking: {
    method: 'POST',
    url: (p) => `/bookings/${String(p.bookingId)}/accept-counter`,
  },
  create_debt: { method: 'POST', url: '/debts' }, // будущее ядро долгов (v0.4+)
  confirm_delivery: { method: 'POST', url: '/deliveries/confirm' }, // будущее (v0.4+)
};

/**
 * Карта «тип операции → эндпоинт» (v0.3.0; долги — v0.4.0).
 * Совпадает с @Idempotent-разметкой на сервере (bookings/debts.controller.ts).
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
  create_debt: { method: 'POST', url: '/debts' }, // v0.4.0 (ADR-010)
  confirm_delivery: {
    method: 'POST',
    url: (p) => `/bookings/${String(p.bookingId)}/confirm-delivery`, // v0.4.0-C (ADR-012)
  },
  settle_debt: {
    method: 'POST',
    url: (p) => `/debts/${String(p.debtId)}/settle`,
  },
  dispute_debt: {
    method: 'POST',
    url: (p) => `/debts/${String(p.debtId)}/dispute`,
  },
  resolve_debt: {
    method: 'POST',
    url: (p) => `/debts/${String(p.debtId)}/resolve`,
  },
  create_delivery: { method: 'POST', url: '/deliveries' }, // v0.5.0 (ADR-015)
};

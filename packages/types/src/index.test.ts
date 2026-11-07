import { describe, expect, it } from 'vitest';
import {
  APPEAL_ACTIVE_STATUSES,
  APPEAL_DECISIONS,
  APPEAL_DECISION_LABELS,
  APPEAL_STATUSES,
  APPEAL_STATUS_LABELS,
  BOOKING_ACTIONS,
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  DISPUTE_RESOLUTIONS,
  DISPUTE_STATUSES,
  DISPUTE_TYPES,
  LISTING_CATEGORIES,
  LISTING_UNITS,
  MARKET_ROLES,
  ROLE_LABELS,
  USER_ROLES,
} from './index';

describe('@agromoll/types', () => {
  it('содержит три рыночные роли и арбитра (v0.6.0-C, ADR-033)', () => {
    expect(USER_ROLES).toEqual(['buyer', 'seller', 'driver', 'arbitrator']);
  });

  it('MARKET_ROLES — переключаемые роли без арбитра (ADR-033)', () => {
    expect(MARKET_ROLES).toEqual(['buyer', 'seller', 'driver']);
    expect(USER_ROLES).toEqual(expect.arrayContaining([...MARKET_ROLES]));
    expect(MARKET_ROLES).not.toContain('arbitrator');
  });

  it('константы арбитража согласованы с Prisma-схемой (ADR-033)', () => {
    expect(DISPUTE_TYPES).toEqual(['booking', 'delivery', 'debt']);
    expect(DISPUTE_STATUSES).toEqual(['open', 'under_review', 'resolved', 'dismissed']);
    expect(DISPUTE_RESOLUTIONS).toEqual(['favor_buyer', 'favor_seller', 'compromise', 'no_fault']);
  });

  it('константы апелляций 289-ФЗ согласованы с Prisma-схемой (ADR-035)', () => {
    expect(APPEAL_STATUSES).toEqual(['open', 'under_review', 'unblocked', 'rejected']);
    expect(APPEAL_ACTIVE_STATUSES).toEqual(['open', 'under_review']);
    expect(APPEAL_DECISIONS).toEqual(['unblock', 'reject']);
  });

  it('у каждого статуса и решения апелляции есть подпись для UI (ADR-035)', () => {
    for (const status of APPEAL_STATUSES) {
      expect(typeof APPEAL_STATUS_LABELS[status]).toBe('string');
      expect(APPEAL_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
    for (const decision of APPEAL_DECISIONS) {
      expect(typeof APPEAL_DECISION_LABELS[decision]).toBe('string');
      expect(APPEAL_DECISION_LABELS[decision].length).toBeGreaterThan(0);
    }
  });

  it('у каждой роли есть человекочитаемое название', () => {
    for (const role of USER_ROLES) {
      expect(typeof ROLE_LABELS[role]).toBe('string');
      expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
    }
  });

  it('категории и единицы листинга согласованы с Prisma-схемой', () => {
    expect(LISTING_CATEGORIES).toEqual(['vegetables', 'fruits', 'grocery', 'snacks', 'other']);
    expect(LISTING_UNITS).toEqual(['kg', 'box', 'piece']);
  });

  it('статусы и действия брони согласованы с Prisma-схемой', () => {
    expect(BOOKING_STATUSES).toEqual([
      'requested',
      'counter_offered',
      'confirmed',
      'cancelled',
      'expired',
      // v0.4.0-C (ADR-012): приёмка закрывает жизненный цикл брони.
      'completed',
      'disputed',
    ]);
    expect(BOOKING_ACTIONS).toEqual([
      'created',
      'counter_offered',
      'accepted_counter',
      'confirmed',
      'cancelled',
      'expired',
      'delivery_confirmed',
      'delivery_disputed',
      'system_auto_confirmed',
    ]);
  });

  it('у каждого статуса брони есть человекочитаемая подпись для UI', () => {
    for (const status of BOOKING_STATUSES) {
      expect(typeof BOOKING_STATUS_LABELS[status]).toBe('string');
      expect(BOOKING_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });
});

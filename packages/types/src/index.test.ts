import { describe, expect, it } from 'vitest';
import {
  BOOKING_ACTIONS,
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  LISTING_CATEGORIES,
  LISTING_UNITS,
  ROLE_LABELS,
  USER_ROLES,
} from './index';

describe('@agromoll/types', () => {
  it('содержит ровно три роли рынка', () => {
    expect(USER_ROLES).toEqual(['buyer', 'seller', 'driver']);
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
    ]);
    expect(BOOKING_ACTIONS).toEqual([
      'created',
      'counter_offered',
      'accepted_counter',
      'confirmed',
      'cancelled',
      'expired',
    ]);
  });

  it('у каждого статуса брони есть человекочитаемая подпись для UI', () => {
    for (const status of BOOKING_STATUSES) {
      expect(typeof BOOKING_STATUS_LABELS[status]).toBe('string');
      expect(BOOKING_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });
});

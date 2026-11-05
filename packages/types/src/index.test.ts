import { describe, expect, it } from 'vitest';
import { ROLE_LABELS, USER_ROLES } from './index';

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
});

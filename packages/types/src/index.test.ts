import { describe, expect, it } from 'vitest';

import { ROLES, ROLE_LABELS } from './index';

describe('roles', () => {
  it('содержит ровно три роли рынка', () => {
    expect(ROLES).toHaveLength(3);
    expect([...ROLES]).toEqual(['buyer', 'seller', 'driver']);
  });

  it('у каждой роли есть человекочитаемое название', () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
    }
  });

  it('названия ролей не содержат дублей', () => {
    const labels = Object.values(ROLE_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

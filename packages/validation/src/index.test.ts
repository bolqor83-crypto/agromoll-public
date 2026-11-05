import { describe, expect, it } from 'vitest';

import { idSchema, paginationSchema, roleSchema } from './index';

describe('roleSchema', () => {
  it('принимает все роли рынка', () => {
    expect(roleSchema.parse('buyer')).toBe('buyer');
    expect(roleSchema.parse('seller')).toBe('seller');
    expect(roleSchema.parse('driver')).toBe('driver');
  });

  it('отклоняет неизвестные роли', () => {
    expect(roleSchema.safeParse('admin').success).toBe(false);
    expect(roleSchema.safeParse('').success).toBe(false);
  });
});

describe('paginationSchema', () => {
  it('подставляет значения по умолчанию', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('приводит строки к числам (query-параметры)', () => {
    expect(paginationSchema.parse({ page: '3', pageSize: '10' })).toEqual({
      page: 3,
      pageSize: 10,
    });
  });

  it('отклоняет некорректные значения', () => {
    expect(paginationSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(paginationSchema.safeParse({ pageSize: 1000 }).success).toBe(false);
  });
});

describe('idSchema', () => {
  it('принимает uuid и отклоняет остальное', () => {
    expect(idSchema.safeParse('2f6b9d3e-1a4c-4d8e-9f0a-7b3c5d8e9f0a').success).toBe(true);
    expect(idSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});

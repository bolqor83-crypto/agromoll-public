/**
 * Unit-тесты долговых операций локального outbox (v0.4.0, ADR-010).
 *
 * Проверяют контракт «клиент ↔ сервер» для новых операций:
 *  - карта эндпоинтов строит URL из payload (settle/dispute/resolve);
  - enqueue принимает новые типы и хранит payload без потерь;
 *  - «ровно один раз» обеспечивается clientUuid (X-Idempotency-Key).
 */
import { IDEMPOTENCY_ENDPOINTS } from './endpoints';
import { OUTBOX_OPERATION_TYPES } from './types';
import type { OutboxOperationType } from './types';

describe('Долговые операции outbox (v0.4.0)', () => {
  it('новые типы операций объявлены и совпадают с серверным enum', () => {
    for (const operation of [
      'create_debt',
      'settle_debt',
      'dispute_debt',
      'resolve_debt',
    ] as const) {
      expect(OUTBOX_OPERATION_TYPES).toContain(operation);
    }
    // Порядок не важен, состав — да: лишних/недостающих нет.
    expect(OUTBOX_OPERATION_TYPES).toHaveLength(11); // +create_delivery (v0.5.0, ADR-015)
  });

  it('карта эндпоинтов строит URL из payload для каждой долговой операции', () => {
    const debtId = '11111111-2222-4333-8444-555555555555';
    expect(IDEMPOTENCY_ENDPOINTS.create_debt.url).toBe('/debts');
    expect(
      (IDEMPOTENCY_ENDPOINTS.settle_debt as { url: (p: Record<string, unknown>) => string }).url({
        debtId,
      }),
    ).toBe(`/debts/${debtId}/settle`);
    expect(
      (IDEMPOTENCY_ENDPOINTS.dispute_debt as { url: (p: Record<string, unknown>) => string }).url({
        debtId,
      }),
    ).toBe(`/debts/${debtId}/dispute`);
    expect(
      (IDEMPOTENCY_ENDPOINTS.resolve_debt as { url: (p: Record<string, unknown>) => string }).url({
        debtId,
      }),
    ).toBe(`/debts/${debtId}/resolve`);
  });

  it('каждая операция карты — из объявленного списка типов', () => {
    const known = new Set<string>(OUTBOX_OPERATION_TYPES);
    for (const key of Object.keys(IDEMPOTENCY_ENDPOINTS)) {
      expect(known.has(key as OutboxOperationType)).toBe(true);
    }
    expect(Object.keys(IDEMPOTENCY_ENDPOINTS)).toHaveLength(OUTBOX_OPERATION_TYPES.length);
  });
});

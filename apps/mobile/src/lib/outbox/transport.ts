/**
 * HTTP-транспорт outbox: мутации броней уходят с X-Idempotency-Key (v0.3.0).
 *
 * Здесь И ТОЛЬКО здесь мутации обращаются к API напрямую — экраны
 * работают с outbox (см. ADR-006). Ответ классифицируется для очереди:
 * успех / сеть / 5xx / 4xx / 409-идемпотентность.
 */
import { http, toApiError } from '../api';
import { IDEMPOTENCY_ENDPOINTS } from './endpoints';
import type { OutboxRecord, OutboxTransport, TransportResult } from './types';

export const httpOutboxTransport: OutboxTransport = {
  async send(record: OutboxRecord): Promise<TransportResult> {
    const endpoint = IDEMPOTENCY_ENDPOINTS[record.operationType];
    if (!endpoint) {
      return {
        kind: 'client-error',
        status: 0,
        data: { message: `Неизвестный тип операции: ${record.operationType}` },
      };
    }

    const url = typeof endpoint.url === 'function' ? endpoint.url(record.payload) : endpoint.url;

    try {
      const response = await http.request<unknown>({
        method: endpoint.method,
        url,
        data: record.payload,
        headers: { 'X-Idempotency-Key': record.clientUuid },
      });
      return { kind: 'success', status: response.status, data: response.data };
    } catch (error) {
      const apiError = toApiError(error);

      // Сеть/таймаут: сервер не ответил — повтор по backoff.
      if (apiError.code === 'NETWORK' || apiError.code === 'TIMEOUT') {
        return { kind: 'network-error', message: apiError.message };
      }

      // 409 «в обработке на сервере» — короткий повтор через 2 секунды.
      if (
        apiError.status === 409 &&
        (apiError.body as { code?: string } | undefined)?.code === 'IDEMPOTENCY_IN_PROGRESS'
      ) {
        return { kind: 'idempotency-in-progress' };
      }

      if (apiError.status !== undefined && apiError.status >= 500) {
        return { kind: 'server-error', status: apiError.status, message: apiError.message };
      }

      // Остальные 4xx — бизнес-ответ (конфликт или безнадёжная ошибка).
      return { kind: 'client-error', status: apiError.status ?? 0, data: apiError.body };
    }
  },
};

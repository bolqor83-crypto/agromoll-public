/**
 * OutboxService — локальная очередь мутаций (v0.3.0, ADR-006).
 *
 * Правила (по спецификации):
 *  - enqueue(operation): сразу в очередь с uuid v4, UI показывает
 *    оптимистичное состояние;
 *  - processQueue(): pending/retrying отправляются с X-Idempotency-Key;
 *  - сетевая ошибка и 5xx → retrying с экспоненциальным backoff
 *    1с→2с→4с→8с→16с, максимум 5 попыток, дальше permanently_failed;
 *  - 409 «в обработке на сервере» → retrying через 2с;
 *  - прочие 4xx → permanently_failed (повтор бессмысленен);
 *  - 409 бизнес-конфликт → conflicted: молча не решаем, UI показывает
 *    диалог «[Принять серверное] [Отменить локальную]»;
 *  - успех → completed + событие.
 *
 * Класс не знает про React и БД конкретно: хранилище и транспорт —
 * интерфейсы, в тестах подменяются (см. outbox-service.test.ts).
 */
import { randomUUID } from 'expo-crypto';
import type {
  OutboxEvent,
  OutboxListener,
  OutboxOperationType,
  OutboxRecord,
  OutboxStorage,
  OutboxTransport,
} from './types';
import { BACKOFF_SCHEDULE_MS, IN_PROGRESS_RETRY_MS, MAX_ATTEMPTS } from './types';

/** Сколько операций берём из очереди за один проход. */
const BATCH_SIZE = 20;

export interface ProcessSummary {
  completed: number;
  retrying: number;
  failed: number;
  conflicted: number;
  skipped: number;
}

export class OutboxService {
  private readonly listeners = new Set<OutboxListener>();
  private processing = false;

  constructor(
    private readonly storage: OutboxStorage,
    private readonly transport: OutboxTransport,
    /** Для тестов: контроль времени. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Подписка на события очереди. Возвращает отписку. */
  on(listener: OutboxListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: OutboxEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // слушатель упал — очередь продолжается
      }
    }
  }

  /** Добавить операцию в очередь (uuid v4 — ключ идемпотентности). */
  async enqueue(
    operationType: OutboxOperationType,
    payload: Record<string, unknown>,
  ): Promise<OutboxRecord> {
    const record: OutboxRecord = {
      clientUuid: randomUUID(),
      operationType,
      payload,
      state: 'pending',
      retries: 0,
      lastError: null,
      nextAttemptAt: null,
      createdAt: this.now().toISOString(),
      result: null,
    };
    await this.storage.insert(record);
    this.emit({ type: 'enqueued', record });
    return record;
  }

  /** Один проход по очереди. Параллельные вызовы сливаются в один. */
  async processQueue(): Promise<ProcessSummary> {
    if (this.processing) {
      return { completed: 0, retrying: 0, failed: 0, conflicted: 0, skipped: 0 };
    }
    this.processing = true;
    try {
      const summary: ProcessSummary = {
        completed: 0,
        retrying: 0,
        failed: 0,
        conflicted: 0,
        skipped: 0,
      };
      for (;;) {
        const batch = await this.storage.takeDue(BATCH_SIZE);
        if (batch.length === 0) {
          break;
        }
        for (const record of batch) {
          const outcome = await this.processOne(record);
          summary[outcome] += 1;
        }
      }
      return summary;
    } finally {
      this.processing = false;
    }
  }

  private async processOne(
    record: OutboxRecord,
  ): Promise<'completed' | 'retrying' | 'failed' | 'conflicted' | 'skipped'> {
    // помечаем processing, чтобы «очередь» и диагностика видели правду
    await this.storage.update(record.clientUuid, { state: 'processing' });

    let result;
    try {
      result = await this.transport.send({ ...record, state: 'processing' });
    } catch (error) {
      // транспорт обещал не бросать, но подстрахуемся
      result = { kind: 'network-error', message: String(error) } as const;
    }

    switch (result.kind) {
      case 'success': {
        const updated: OutboxRecord = {
          ...record,
          state: 'completed',
          result: result.data,
          lastError: null,
          nextAttemptAt: null,
        };
        await this.storage.update(record.clientUuid, {
          state: 'completed',
          result: result.data,
          lastError: null,
          nextAttemptAt: null,
        });
        this.emit({ type: 'completed', record: updated });
        return 'completed';
      }

      case 'network-error':
      case 'server-error':
      case 'idempotency-in-progress': {
        const retries = record.retries + 1;
        if (retries >= MAX_ATTEMPTS) {
          const message =
            result.kind === 'idempotency-in-progress'
              ? 'Сервер долго держит операцию в обработке'
              : result.kind === 'network-error'
                ? result.message || 'Сеть недоступна'
                : result.message || 'Сервер недоступен';
          await this.storage.update(record.clientUuid, {
            state: 'permanently_failed',
            retries,
            lastError: message,
            nextAttemptAt: null,
          });
          this.emit({
            type: 'permanently-failed',
            record: { ...record, state: 'permanently_failed', retries, lastError: message },
          });
          return 'failed';
        }
        const delay =
          result.kind === 'idempotency-in-progress'
            ? IN_PROGRESS_RETRY_MS
            : (BACKOFF_SCHEDULE_MS[Math.min(retries - 1, BACKOFF_SCHEDULE_MS.length - 1)] ??
              16_000);
        const nextAttemptAt = new Date(this.now().getTime() + delay).toISOString();
        const message =
          result.kind === 'idempotency-in-progress'
            ? 'Операция в обработке на сервере'
            : result.kind === 'network-error'
              ? result.message || 'Сеть недоступна'
              : result.message || 'Сервер недоступен';
        await this.storage.update(record.clientUuid, {
          state: 'retrying',
          retries,
          lastError: message,
          nextAttemptAt,
        });
        this.emit({
          type: 'retrying',
          record: { ...record, state: 'retrying', retries, lastError: message, nextAttemptAt },
        });
        return 'retrying';
      }

      case 'client-error': {
        // Бизнес-конфликт (409 состояния брони и т.п.) — решает человек.
        // Прочие 4xx — безнадёжны.
        const isConflict = result.status === 409;
        const message =
          extractMessage(result.data) ?? `Сервер отклонил операцию (${result.status})`;
        if (isConflict) {
          await this.storage.update(record.clientUuid, {
            state: 'conflicted',
            lastError: message,
            nextAttemptAt: null,
          });
          this.emit({
            type: 'conflicted',
            record: { ...record, state: 'conflicted', lastError: message },
          });
          return 'conflicted';
        }
        await this.storage.update(record.clientUuid, {
          state: 'permanently_failed',
          lastError: message,
          nextAttemptAt: null,
        });
        this.emit({
          type: 'permanently-failed',
          record: { ...record, state: 'permanently_failed', lastError: message },
        });
        return 'failed';
      }

      default:
        return 'skipped';
    }
  }

  /** Список всех операций (экран «Очередь»). */
  async list(): Promise<OutboxRecord[]> {
    return this.storage.list();
  }

  /** Разрешение конфликта человеком. */
  async resolveConflict(
    clientUuid: string,
    resolution: 'accept-server' | 'discard-local',
  ): Promise<void> {
    // Оба варианта удаляют локальную операцию; «принять серверное»
    // дополнительно заставит экраны перечитать данные с сервера
    // (события completed для этого недостаточно — слушатель UI сам
    // решает, что перечитать).
    await this.storage.remove(clientUuid);
    void resolution;
  }

  /** Повторить безнадёжную операцию вручную (кнопка на экране «Очередь»). */
  async retryManually(clientUuid: string): Promise<void> {
    await this.storage.update(clientUuid, {
      state: 'pending',
      retries: 0,
      nextAttemptAt: null,
    });
  }

  /** Полная очистка очереди — при выходе из аккаунта (критично!). */
  async clearAll(): Promise<void> {
    await this.storage.clear();
  }

  async pendingCount(): Promise<number> {
    return this.storage.pendingCount();
  }
}

function extractMessage(data: unknown): string | null {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  return null;
}

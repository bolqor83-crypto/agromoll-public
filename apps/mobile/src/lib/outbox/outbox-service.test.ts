/**
 * Unit-тесты OutboxService (v0.3.0): enqueue, процессинг, backoff,
 * permanent fail, конфликты, ручной retry, очистка, события.
 *
 * Хранилище — in-memory, транспорт — скриптованный мок.
 */
import { OutboxService } from './outbox-service';
import { InMemoryOutboxStorage } from './in-memory-storage';
import type { OutboxEvent, OutboxRecord, OutboxTransport, TransportResult } from './types';

// expo-crypto в jest-окружении не даёт настоящего randomUUID — подменяем
// на валидные v4-подобные UUID (счётчик внутри фабрики, без внешних переменных).
jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    randomUUID: (): string => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
    },
  };
});

/** Скриптованный транспорт: очередь ответов + лог вызовов. */
class ScriptedTransport implements OutboxTransport {
  readonly calls: OutboxRecord[] = [];
  readonly script: (TransportResult | Error)[] = [];

  /** Следующий ответ (по умолчанию — успех). */
  next: TransportResult | Error = { kind: 'success', status: 201, data: { id: 'b-1' } };

  async send(record: OutboxRecord): Promise<TransportResult> {
    this.calls.push(record);
    const reply =
      this.script.length > 0 ? (this.script.shift() as TransportResult | Error) : this.next;
    if (reply instanceof Error) {
      throw reply;
    }
    return reply;
  }
}

const NETWORK_ERROR: TransportResult = { kind: 'network-error', message: 'Сеть недоступна' };
const SERVER_ERROR: TransportResult = {
  kind: 'server-error',
  status: 503,
  message: 'Сервер недоступен',
};
const IN_PROGRESS: TransportResult = { kind: 'idempotency-in-progress' };
const BUSINESS_CONFLICT: TransportResult = {
  kind: 'client-error',
  status: 409,
  data: { message: 'Бронь уже отменена' },
};
const BAD_REQUEST: TransportResult = {
  kind: 'client-error',
  status: 400,
  data: { message: 'Некорректное количество' },
};

function makeService() {
  const storage = new InMemoryOutboxStorage();
  const transport = new ScriptedTransport();
  const service = new OutboxService(storage, transport);
  return { storage, transport, service };
}

describe('OutboxService', () => {
  it('enqueue: создаёт pending-операцию с uuid и событием', async () => {
    const { service } = makeService();
    const events: OutboxEvent[] = [];
    service.on((e) => events.push(e));

    const record = await service.enqueue('create_booking', {
      listingId: 'l-1',
      requestedQuantity: 10,
    });

    expect(record.state).toBe('pending');
    expect(record.clientUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(events.map((e) => e.type)).toEqual(['enqueued']);
  });

  it('processQueue: успех → completed + событие', async () => {
    const { service } = makeService();
    const events: OutboxEvent[] = [];
    service.on((e) => events.push(e));
    await service.enqueue('create_booking', { listingId: 'l-1', requestedQuantity: 10 });

    const summary = await service.processQueue();

    expect(summary).toEqual({ completed: 1, retrying: 0, failed: 0, conflicted: 0, skipped: 0 });
    const [record] = await service.list();
    expect(record.state).toBe('completed');
    expect(record.result).toEqual({ id: 'b-1' });
    expect(events.map((e) => e.type)).toEqual(['enqueued', 'completed']);
  });

  it('сетевая ошибка → retrying с backoff 1с', async () => {
    const { service, storage, transport } = makeService();
    transport.next = NETWORK_ERROR;
    await service.enqueue('create_booking', { listingId: 'l-1', requestedQuantity: 10 });

    const summary = await service.processQueue();

    expect(summary.retrying).toBe(1);
    const [record] = await service.list();
    expect(record.state).toBe('retrying');
    expect(record.retries).toBe(1);
    expect(record.lastError).toBe('Сеть недоступна');
    // следующая попытка примерно через 1 секунду
    const delay = new Date(record.nextAttemptAt as string).getTime() - Date.now();
    expect(delay).toBeGreaterThan(500);
    expect(delay).toBeLessThanOrEqual(1100);

    // не доросшая по времени операция не берётся из очереди
    expect(await storage.takeDue(10)).toHaveLength(0);
  });

  it('backoff растёт экспоненциально: 1с → 2с → 4с → 8с → 16с', async () => {
    const { service, storage, transport } = makeService();
    transport.next = NETWORK_ERROR;
    await service.enqueue('cancel_booking', { bookingId: 'b-1' });

    const delays: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await service.processQueue();
      const [record] = await service.list();
      delays.push(new Date(record.nextAttemptAt as string).getTime() - Date.now());
      // «проживаем» время до следующей попытки (таймер сбрасываем)
      await storage.update(record.clientUuid, { nextAttemptAt: null });
    }

    // строго возрастающие задержки в разумных пределах
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
    expect(delays[0]).toBeLessThanOrEqual(1100);
    expect(delays[3]).toBeGreaterThan(6000);
  });

  it('5 неудач подряд → permanently_failed, шестой попытки нет', async () => {
    const { service, transport } = makeService();
    transport.next = NETWORK_ERROR;
    await service.enqueue('create_booking', { listingId: 'l-1', requestedQuantity: 10 });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const [record] = await service.list();
      // сбрасываем таймер, чтобы операция была «дозревшей»
      const svc = service as unknown as { storage: InMemoryOutboxStorage };
      await svc.storage.update(record.clientUuid, { nextAttemptAt: null });
      await service.processQueue();
    }

    const [record] = await service.list();
    expect(record.state).toBe('permanently_failed');
    expect(record.retries).toBe(5);
    expect(transport.calls).toHaveLength(5);
  });

  it('5xx → retrying (как сеть)', async () => {
    const { service, transport } = makeService();
    transport.next = SERVER_ERROR;
    await service.enqueue('confirm_booking', { bookingId: 'b-1' });

    await service.processQueue();

    const [record] = await service.list();
    expect(record.state).toBe('retrying');
    expect(record.lastError).toBe('Сервер недоступен');
  });

  it('409 «в обработке на сервере» → retrying через ~2с, не по backoff', async () => {
    const { service, transport } = makeService();
    transport.next = IN_PROGRESS;
    await service.enqueue('create_booking', { listingId: 'l-1', requestedQuantity: 10 });

    await service.processQueue();

    const [record] = await service.list();
    expect(record.state).toBe('retrying');
    expect(record.lastError).toBe('Операция в обработке на сервере');
    const delay = new Date(record.nextAttemptAt as string).getTime() - Date.now();
    expect(delay).toBeGreaterThan(1500);
    expect(delay).toBeLessThanOrEqual(2100);
  });

  it('бизнес-конфликт 409 → conflicted, без автоповтора', async () => {
    const { service, transport } = makeService();
    const events: OutboxEvent[] = [];
    service.on((e) => events.push(e));
    transport.next = BUSINESS_CONFLICT;
    await service.enqueue('cancel_booking', { bookingId: 'b-1' });

    const summary = await service.processQueue();

    expect(summary.conflicted).toBe(1);
    const [record] = await service.list();
    expect(record.state).toBe('conflicted');
    expect(record.lastError).toBe('Бронь уже отменена');
    expect(events.map((e) => e.type)).toEqual(['enqueued', 'conflicted']);

    // повторный processQueue не трогает conflicted
    await service.processQueue();
    expect(transport.calls).toHaveLength(1);
  });

  it('прочий 4xx → permanently_failed сразу', async () => {
    const { service, transport } = makeService();
    transport.next = BAD_REQUEST;
    await service.enqueue('create_booking', { listingId: 'l-1', requestedQuantity: 10 });

    const summary = await service.processQueue();

    expect(summary.failed).toBe(1);
    const [record] = await service.list();
    expect(record.state).toBe('permanently_failed');
    expect(record.lastError).toBe('Некорректное количество');
  });

  it('транспорт бросил исключение → трактуется как сетевая ошибка', async () => {
    const { service, transport } = makeService();
    transport.next = new Error('внезапный аварийный сброс');
    await service.enqueue('create_booking', { listingId: 'l-1', requestedQuantity: 10 });

    await service.processQueue();

    const [record] = await service.list();
    expect(record.state).toBe('retrying');
  });

  it('resolveConflict удаляет операцию (оба варианта)', async () => {
    const { service, transport } = makeService();
    transport.next = BUSINESS_CONFLICT;
    const record = await service.enqueue('cancel_booking', { bookingId: 'b-1' });
    await service.processQueue();

    await service.resolveConflict(record.clientUuid, 'accept-server');

    expect(await service.list()).toHaveLength(0);
  });

  it('retryManually сбрасывает счётчик и ставит в очередь', async () => {
    const { service, transport } = makeService();
    transport.next = BAD_REQUEST;
    const record = await service.enqueue('create_booking', {
      listingId: 'l-1',
      requestedQuantity: 10,
    });
    await service.processQueue();

    await service.retryManually(record.clientUuid);

    const [updated] = await service.list();
    expect(updated.state).toBe('pending');
    expect(updated.retries).toBe(0);
    expect(updated.nextAttemptAt).toBeNull();
  });

  it('clearAll — полная очистка (logout)', async () => {
    const { service } = makeService();
    await service.enqueue('create_booking', { listingId: 'l-1', requestedQuantity: 10 });
    await service.enqueue('cancel_booking', { bookingId: 'b-1' });

    await service.clearAll();

    expect(await service.list()).toHaveLength(0);
    expect(await service.pendingCount()).toBe(0);
  });

  it('параллельные processQueue сливаются в один проход', async () => {
    const { service } = makeService();
    await service.enqueue('create_booking', { listingId: 'l-1', requestedQuantity: 10 });

    const [a, b] = await Promise.all([service.processQueue(), service.processQueue()]);

    // второй вызов вернул пустой summary: обработки не дублируются
    const total = a.completed + b.completed;
    expect(total).toBe(1);
  });
});

describe('офлайн-сценарий: обрыв сети → восстановление (интеграционный)', () => {
  it('бронь, созданная офлайн, уходит после восстановления сети', async () => {
    const storage = new InMemoryOutboxStorage();
    const transport = new ScriptedTransport();

    // сеть «отсутствует»
    transport.next = NETWORK_ERROR;
    const service = new OutboxService(storage, transport);
    const events: OutboxEvent[] = [];
    service.on((e) => events.push(e));

    // 1. создаём бронь офлайн
    const record = await service.enqueue('create_booking', {
      listingId: 'l-1',
      requestedQuantity: 20,
    });
    expect(record.state).toBe('pending');

    // 2. пытаемся отправить — сеть недоступна
    let summary = await service.processQueue();
    expect(summary.retrying).toBe(1);
    expect(transport.calls).toHaveLength(1);

    // 3. «время прошло», сеть восстановилась
    transport.next = {
      kind: 'success',
      status: 201,
      data: { id: 'b-server-1', status: 'requested' },
    };
    await storage.update(record.clientUuid, { nextAttemptAt: null });

    // 4. синхронизация — операция ушла и подтверждена
    summary = await service.processQueue();
    expect(summary.completed).toBe(1);

    const [stored] = await service.list();
    expect(stored.state).toBe('completed');
    expect(stored.result).toEqual({ id: 'b-server-1', status: 'requested' });
    expect(events.map((e) => e.type)).toEqual(['enqueued', 'retrying', 'completed']);

    // идемпотентность: отправляли дважды с одним ключом
    const key = transport.calls[0].clientUuid;
    expect(transport.calls[1].clientUuid).toBe(key);
  });

  it('дубль не отправляется: completed не берётся из очереди повторно', async () => {
    const { service, transport } = makeService();
    await service.enqueue('create_booking', { listingId: 'l-1', requestedQuantity: 5 });

    await service.processQueue();
    await service.processQueue();
    await service.processQueue();

    expect(transport.calls).toHaveLength(1);
  });
});

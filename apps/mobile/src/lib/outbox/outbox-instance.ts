/**
 * Синглтон outbox: SQLite-хранилище + HTTP-транспорт (v0.3.0).
 *
 * Инициализация ленивая: SQLite недоступен в jest-окружении, поэтому
 * в тестах сервис создаётся напрямую с in-memory хранилищем и мок-транспортом.
 */
import { OutboxService } from './outbox-service';
import { createSqliteOutboxStorage } from './sqlite-storage';
import { httpOutboxTransport } from './transport';

let instance: OutboxService | null = null;
let initPromise: Promise<OutboxService> | null = null;

/** Получить (и при первом обращении создать) сервис. */
export function getOutbox(): Promise<OutboxService> {
  if (instance) {
    return Promise.resolve(instance);
  }
  initPromise ??= (async () => {
    const storage = await createSqliteOutboxStorage();
    instance = new OutboxService(storage, httpOutboxTransport);
    return instance;
  })();
  return initPromise;
}

/** Только для тестов: подменить экземпляр. */
export function setOutboxForTests(service: OutboxService | null): void {
  instance = service;
  initPromise = null;
}

/**
 * Синглтон outbox: хранилище + HTTP-транспорт (v0.3.0).
 *
 * Хранилище выбирается по платформе:
 *  - iOS/Android — expo-sqlite (динамический импорт: у expo-sqlite в
 *    SDK 52 нет web-реализации, статический импорт ломает web-экспорт);
 *  - web — localStorage (платформа демо и разработки, см. ADR-006).
 *
 * В тестах сервис создаётся напрямую с in-memory хранилищем.
 */
import { Platform } from 'react-native';
import { OutboxService } from './outbox-service';
import { httpOutboxTransport } from './transport';
import type { OutboxStorage } from './types';

let instance: OutboxService | null = null;
let initPromise: Promise<OutboxService> | null = null;

/** Получить (и при первом обращении создать) сервис. */
export function getOutbox(): Promise<OutboxService> {
  if (instance) {
    return Promise.resolve(instance);
  }
  initPromise ??= (async () => {
    let storage: OutboxStorage;
    if (Platform.OS === 'web') {
      const { createLocalStorageOutboxStorage } = await import('./local-storage');
      storage = createLocalStorageOutboxStorage();
    } else {
      const { createSqliteOutboxStorage } = await import('./sqlite-storage');
      storage = await createSqliteOutboxStorage();
    }
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

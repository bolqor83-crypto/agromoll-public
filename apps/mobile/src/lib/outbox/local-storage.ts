/**
 * Web-хранилище outbox: localStorage (v0.3.0).
 *
 * expo-sqlite в Expo SDK 52 не имеет web-реализации («Cannot find native
 * module 'ExpoSQLite'»), поэтому на web-экспорте очередь живёт в
 * localStorage: JSON-массив под одним ключом. Это платформа демо
 * и разработки; на iOS/Android работает SQLite (ADR-006).
 */
import type { OutboxRecord, OutboxStorage } from './types';

const STORAGE_KEY = 'agromoll.outbox';

function readAll(): OutboxRecord[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OutboxRecord[]) : [];
  } catch {
    return [];
  }
}

function writeAll(rows: OutboxRecord[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // localStorage переполнен/недоступен (приватный режим) — очередь
    // живёт до перезагрузки страницы; на web это приемлемо
  }
}

/** Реализация OutboxStorage поверх localStorage. */
export function createLocalStorageOutboxStorage(): OutboxStorage {
  return {
    async init(): Promise<void> {},

    async insert(record: OutboxRecord): Promise<void> {
      writeAll([...readAll(), record]);
    },

    async takeDue(limit: number): Promise<OutboxRecord[]> {
      const now = new Date().toISOString();
      return readAll()
        .filter(
          (r) =>
            (r.state === 'pending' || r.state === 'retrying') &&
            (r.nextAttemptAt === null || r.nextAttemptAt <= now),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit);
    },

    async update(clientUuid: string, patch: Partial<OutboxRecord>): Promise<void> {
      writeAll(readAll().map((r) => (r.clientUuid === clientUuid ? { ...r, ...patch } : r)));
    },

    async list(): Promise<OutboxRecord[]> {
      return [...readAll()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async get(clientUuid: string): Promise<OutboxRecord | null> {
      return readAll().find((r) => r.clientUuid === clientUuid) ?? null;
    },

    async remove(clientUuid: string): Promise<void> {
      writeAll(readAll().filter((r) => r.clientUuid !== clientUuid));
    },

    async clear(): Promise<void> {
      writeAll([]);
    },

    async pendingCount(): Promise<number> {
      return readAll().filter(
        (r) => r.state === 'pending' || r.state === 'processing' || r.state === 'retrying',
      ).length;
    },
  };
}

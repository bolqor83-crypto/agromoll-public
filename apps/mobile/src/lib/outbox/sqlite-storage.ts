/**
 * SQLite-хранилище outbox (expo-sqlite, v0.3.0).
 *
 * Выбор expo-sqlite вместо WatermelonDB — см. ADR-006: нам нужна
 * простая FIFO-очередь с одним типом записи, без реактивных связей
 * и синхронизации схем; ~200 строк вместо тяжёлой ORM-зависимости.
 *
 * Схема живёт в самом модуле (CREATE TABLE IF NOT EXISTS) — отдельного
 * механизма миграций очереди на MVP не требуется: при изменении схемы
 * таблица пересоздаётся, несинхронизированные операции теряются только
 * при обновлении приложения с новой схемой (редкий случай, принимается).
 */
import * as SQLite from 'expo-sqlite';
import type { OutboxRecord, OutboxState, OutboxStorage } from './types';

/** Открыть БД и создать схему. Идемпотентно. */
export async function createSqliteOutboxStorage(): Promise<OutboxStorage> {
  const db = await SQLite.openDatabaseAsync('agromoll-outbox');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS outbox_operations (
      clientUuid    TEXT PRIMARY KEY NOT NULL,
      operationType TEXT NOT NULL,
      payload       TEXT NOT NULL,
      state         TEXT NOT NULL,
      retries       INTEGER NOT NULL DEFAULT 0,
      lastError     TEXT,
      nextAttemptAt TEXT,
      createdAt     TEXT NOT NULL,
      result        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_state ON outbox_operations(state);
  `);
  return new SqliteOutboxStorage(db);
}

type Row = {
  clientUuid: string;
  operationType: string;
  payload: string;
  state: string;
  retries: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  result: string | null;
};

function rowToRecord(row: Row): OutboxRecord {
  return {
    clientUuid: row.clientUuid,
    operationType: row.operationType as OutboxRecord['operationType'],
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    state: row.state as OutboxState,
    retries: row.retries,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt,
    createdAt: row.createdAt,
    result: row.result === null ? null : (JSON.parse(row.result) as unknown),
  };
}

class SqliteOutboxStorage implements OutboxStorage {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  async init(): Promise<void> {
    // схема создаётся в createSqliteOutboxStorage
  }

  async insert(record: OutboxRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO outbox_operations
         (clientUuid, operationType, payload, state, retries, lastError, nextAttemptAt, createdAt, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.clientUuid,
        record.operationType,
        JSON.stringify(record.payload),
        record.state,
        record.retries,
        record.lastError,
        record.nextAttemptAt,
        record.createdAt,
        record.result === null || record.result === undefined ? null : JSON.stringify(record.result),
      ],
    );
  }

  async takeDue(limit: number): Promise<OutboxRecord[]> {
    const rows = await this.db.getAllAsync<Row>(
      `SELECT * FROM outbox_operations
       WHERE state IN ('pending', 'retrying')
         AND (nextAttemptAt IS NULL OR nextAttemptAt <= ?)
       ORDER BY createdAt ASC
       LIMIT ?`,
      [new Date().toISOString(), limit],
    );
    return rows.map(rowToRecord);
  }

  async update(clientUuid: string, patch: Partial<OutboxRecord>): Promise<void> {
    const current = await this.get(clientUuid);
    if (!current) {
      return;
    }
    await this.db.runAsync(
      `UPDATE outbox_operations
       SET operationType = ?, payload = ?, state = ?, retries = ?, lastError = ?,
           nextAttemptAt = ?, result = ?
       WHERE clientUuid = ?`,
      [
        patch.operationType ?? current.operationType,
        JSON.stringify(patch.payload ?? current.payload),
        patch.state ?? current.state,
        patch.retries ?? current.retries,
        patch.lastError === undefined ? current.lastError : patch.lastError,
        patch.nextAttemptAt === undefined ? current.nextAttemptAt : patch.nextAttemptAt,
        (patch.result ?? current.result) === null
          ? null
          : JSON.stringify(patch.result ?? current.result),
        clientUuid,
      ],
    );
  }

  async list(): Promise<OutboxRecord[]> {
    const rows = await this.db.getAllAsync<Row>(
      `SELECT * FROM outbox_operations ORDER BY createdAt DESC`,
    );
    return rows.map(rowToRecord);
  }

  async get(clientUuid: string): Promise<OutboxRecord | null> {
    const row = await this.db.getFirstAsync<Row>(
      `SELECT * FROM outbox_operations WHERE clientUuid = ?`,
      [clientUuid],
    );
    return row ? rowToRecord(row) : null;
  }

  async remove(clientUuid: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM outbox_operations WHERE clientUuid = ?`, [clientUuid]);
  }

  async clear(): Promise<void> {
    await this.db.runAsync(`DELETE FROM outbox_operations`);
  }

  async pendingCount(): Promise<number> {
    const row = await this.db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM outbox_operations
       WHERE state IN ('pending', 'processing', 'retrying')`,
    );
    return row?.count ?? 0;
  }
}

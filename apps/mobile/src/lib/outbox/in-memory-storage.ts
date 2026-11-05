/**
 * In-memory хранилище outbox для тестов (зеркалит SQLite-схему).
 */
import type { OutboxRecord, OutboxStorage } from './types';

export class InMemoryOutboxStorage implements OutboxStorage {
  readonly rows = new Map<string, OutboxRecord>();

  async init(): Promise<void> {}

  async insert(record: OutboxRecord): Promise<void> {
    this.rows.set(record.clientUuid, { ...record });
  }

  async takeDue(limit: number): Promise<OutboxRecord[]> {
    const now = new Date().toISOString();
    const due = [...this.rows.values()]
      .filter(
        (r) =>
          (r.state === 'pending' || r.state === 'retrying') &&
          (r.nextAttemptAt === null || r.nextAttemptAt <= now),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
    return due.map((r) => ({ ...r }));
  }

  async update(clientUuid: string, patch: Partial<OutboxRecord>): Promise<void> {
    const current = this.rows.get(clientUuid);
    if (!current) {
      return;
    }
    this.rows.set(clientUuid, { ...current, ...patch });
  }

  async list(): Promise<OutboxRecord[]> {
    return [...this.rows.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ ...r }));
  }

  async get(clientUuid: string): Promise<OutboxRecord | null> {
    const row = this.rows.get(clientUuid);
    return row ? { ...row } : null;
  }

  async remove(clientUuid: string): Promise<void> {
    this.rows.delete(clientUuid);
  }

  async clear(): Promise<void> {
    this.rows.clear();
  }

  async pendingCount(): Promise<number> {
    return [...this.rows.values()].filter(
      (r) => r.state === 'pending' || r.state === 'processing' || r.state === 'retrying',
    ).length;
  }
}

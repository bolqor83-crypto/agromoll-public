/**
 * Типы локального outbox (v0.3.0, ADR-006).
 *
 * Локальная очередь мутаций: операции живут в SQLite на устройстве
 * и уходят на сервер с заголовком X-Idempotency-Key (= clientUuid).
 * Сервер гарантирует «ровно один раз»: повтор при обрыве сети не
 * создаёт дубль.
 */

/** Типы операций — совпадают с enum OutboxOperationType на сервере. */
export const OUTBOX_OPERATION_TYPES = [
  'create_booking',
  'cancel_booking',
  'confirm_booking',
  'counter_offer_booking',
  'accept_counter_booking',
  'create_debt',
  'confirm_delivery',
] as const;

export type OutboxOperationType = (typeof OUTBOX_OPERATION_TYPES)[number];

/**
 * Шесть состояний операции:
 *  pending             — в очереди, ещё не отправлялась;
 *  processing          — отправляется прямо сейчас;
 *  retrying            — сеть/сервер недоступны, ждём с backoff;
 *  conflicted          — сервер отверг по бизнес-правилу, нужен человек;
 *  permanently_failed  — безнадёжно (4xx), повтор не поможет;
 *  completed           — сервер подтвердил.
 */
export const OUTBOX_STATES = [
  'pending',
  'processing',
  'retrying',
  'conflicted',
  'permanently_failed',
  'completed',
] as const;

export type OutboxState = (typeof OUTBOX_STATES)[number];

/** Строка outbox_operations в локальной БД. */
export interface OutboxRecord {
  clientUuid: string;
  operationType: OutboxOperationType;
  payload: Record<string, unknown>;
  state: OutboxState;
  retries: number;
  lastError: string | null;
  /** Когда можно следующую попытку (ISO); null — можно сразу. */
  nextAttemptAt: string | null;
  createdAt: string;
  /** Ответ сервера при успехе (для отладки на экране «Очередь»). */
  result: unknown;
}

/** Абстракция хранилища: SQLite в приложении, Map в тестах. */
export interface OutboxStorage {
  init(): Promise<void>;
  insert(record: OutboxRecord): Promise<void>;
  /** Взять очередную порцию к отправке: pending и «созревшие» retrying. */
  takeDue(limit: number): Promise<OutboxRecord[]>;
  update(clientUuid: string, patch: Partial<OutboxRecord>): Promise<void>;
  list(): Promise<OutboxRecord[]>;
  get(clientUuid: string): Promise<OutboxRecord | null>;
  remove(clientUuid: string): Promise<void>;
  clear(): Promise<void>;
  /** Количество неотправленных (для индикатора синхронизации). */
  pendingCount(): Promise<number>;
}

/** Результат попытки отправки. */
export type TransportResult =
  | { kind: 'success'; status: number; data: unknown }
  | { kind: 'network-error'; message: string }
  | { kind: 'server-error'; status: number; message: string }
  | { kind: 'client-error'; status: number; data: unknown }
  | { kind: 'idempotency-in-progress' };

/** Транспорт: HTTP-вызов мутации с ключом идемпотентности. */
export interface OutboxTransport {
  send(record: OutboxRecord): Promise<TransportResult>;
}

/** Backoff: 1с, 2с, 4с, 8с, 16с (максимум 5 попыток). */
export const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

/** Пауза при 409 «в обработке на сервере». */
export const IN_PROGRESS_RETRY_MS = 2_000;

/** Максимум попыток (по спецификации v0.3.0). */
export const MAX_ATTEMPTS = 5;

/** События outbox для UI (оптимистичные состояния, конфликты). */
export type OutboxEvent =
  | { type: 'enqueued'; record: OutboxRecord }
  | { type: 'completed'; record: OutboxRecord }
  | { type: 'retrying'; record: OutboxRecord }
  | { type: 'permanently-failed'; record: OutboxRecord }
  | { type: 'conflicted'; record: OutboxRecord };

export type OutboxListener = (event: OutboxEvent) => void;

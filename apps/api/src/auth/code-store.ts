/**
 * Хранилище SMS-кодов: Redis (основной) или in-memory (fallback).
 *
 * Redis выбран ради TTL из коробки и общей памяти между инстансами API —
 * код должен пережить рестарт процесса и работать при нескольких репликах.
 * Если REDIS_URL не задан (локальная разработка, e2e без контейнеров),
 * используем Map в памяти процесса: для одного инстанса этого достаточно,
 * о чём честно предупреждает лог. Выбор — ADR-007.
 */
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { CODE_STORE, CODE_TTL_SECONDS } from './auth.constants';

/** Абстракция хранилища кодов: легко мокается в unit-тестах. */
export interface CodeStore {
  /** Сохранить код для телефона. Перезаписывает предыдущий. */
  save(phone: string, code: string): Promise<void>;
  /** Получить код. Нет/истёк — null. */
  get(phone: string): Promise<string | null>;
  /** Удалить код после успешной проверки (одноразовость). */
  delete(phone: string): Promise<void>;
}

const KEY_PREFIX = 'auth:code:';

/** Redis-хранилище: ключ auth:code:<phone>, TTL 5 минут. */
export class RedisCodeStore implements CodeStore {
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
  }

  async save(phone: string, code: string): Promise<void> {
    await this.redis.set(KEY_PREFIX + phone, code, 'EX', CODE_TTL_SECONDS);
  }

  async get(phone: string): Promise<string | null> {
    return this.redis.get(KEY_PREFIX + phone);
  }

  async delete(phone: string): Promise<void> {
    await this.redis.del(KEY_PREFIX + phone);
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

/** In-memory fallback: Map с «ленивой» проверкой истечения. */
export class InMemoryCodeStore implements CodeStore {
  private readonly codes = new Map<string, { code: string; expiresAt: number }>();

  async save(phone: string, code: string): Promise<void> {
    this.codes.set(phone, { code, expiresAt: Date.now() + CODE_TTL_SECONDS * 1000 });
  }

  async get(phone: string): Promise<string | null> {
    const entry = this.codes.get(phone);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.codes.delete(phone);
      return null;
    }
    return entry.code;
  }

  async delete(phone: string): Promise<void> {
    this.codes.delete(phone);
  }
}

/** Есть ли у хранилища соединение, которое нужно закрыть при остановке. */
export function isClosableStore(store: CodeStore): store is CodeStore & { close(): Promise<void> } {
  return typeof (store as { close?: unknown }).close === 'function';
}

/**
 * Фабрика хранилища: Redis, если задан REDIS_URL; иначе in-memory
 * с предупреждением в лог (только для разработки и e2e).
 */
export const codeStoreProvider = {
  provide: CODE_STORE,
  useFactory: (): CodeStore => {
    const url = process.env.REDIS_URL;
    if (url) {
      return new RedisCodeStore(url);
    }
    Logger.warn(
      'REDIS_URL не задан — SMS-коды хранятся в памяти процесса. ' +
        'Для продакшена обязательно подключите Redis (см. ADR-007).',
      'AuthModule',
    );
    return new InMemoryCodeStore();
  },
};

/** Закрывает Redis-соединение хранилища при остановке приложения. */
@Injectable()
export class CodeStoreShutdown implements OnModuleDestroy {
  constructor(@Inject(CODE_STORE) private readonly store: CodeStore) {}

  async onModuleDestroy(): Promise<void> {
    if (isClosableStore(this.store)) {
      await this.store.close();
    }
  }
}

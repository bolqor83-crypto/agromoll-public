/**
 * Хранилище сессий refresh-токенов (v0.3.1, ADR-008).
 *
 * Паттерн «Refresh Token Family + Rotation + Reuse Detection»:
 *  - каждый вход (verify) открывает «семью» с UUID familyId;
 *  - при каждом /auth/refresh jti ротируется: старый → used, новый → active;
 *  - повторное предъявление used-jti = признак кражи → вся семья отзывается;
 *  - logout отзывает семью целиком.
 *
 * Redis — источник решений об авторизации: TTL ключей из коробки и общая
 * память между репликами API. Таблица Session в Postgres — только аудит.
 * Ключи (TTL = TTL refresh-токена):
 *  - session:family:<familyId> → JSON { familyId, userId, status, currentJti, jtis }
 *  - session:jti:<jti>        → "<familyId>:<active|used|revoked>"
 *  - auth:access-blacklist:<jti> → "1" (TTL = остаток жизни access-токена)
 *
 * Атомарность конкурентных refresh — Lua CAS: скрипт «проверить active →
 * пометить used» выполняется в Redis неделимо, второй конкурентный запрос
 * увидит used и попадёт в reuse detection.
 *
 * Если REDIS_URL не задан — in-memory fallback для локальной разработки
 * и e2e без контейнеров (один инстанс). В production отсутствие Redis —
 * ошибка старта: fail-closed (см. sessionStoreProvider).
 */
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { DEFAULT_REFRESH_TTL_SECONDS, SESSION_STORE } from './auth.constants';

/** Статус отдельного refresh-jti. */
export type JtiStatus = 'active' | 'used' | 'revoked';

/** Статус семьи токенов. */
export type FamilyStatus = 'active' | 'revoked';

/** Абстракция хранилища сессий: легко мокается в unit-тестах. */
export interface SessionStore {
  /** Открыть семью при входе: зарегистрировать стартовый jti. */
  createSession(meta: { familyId: string; userId: string; jti: string }): Promise<void>;
  /**
   * Атомарно (CAS) пометить jti использованным.
   * Возвращает прежний статус: active — успешно (теперь used), used —
   * повторное использование (кража!), revoked — семья отозвана,
   * null — ключа нет (истёк TTL или семья отозвана и забыта).
   */
  consumeRefreshJti(jti: string): Promise<JtiStatus | null>;
  /** Ротация: зарегистрировать новый jti в семье, продлив её TTL. */
  rotateRefreshJti(input: { familyId: string; userId: string; newJti: string }): Promise<void>;
  /** Отозвать семью: сама семья и все её jti → revoked. */
  revokeFamily(familyId: string): Promise<void>;
  /** Отозвать несколько семей (смена роли: все сессии кроме текущей). */
  revokeFamilies(familyIds: string[]): Promise<void>;
  /** Статус семьи по familyId (диагностика и тесты). null — нет/истекла. */
  getFamilyStatus(familyId: string): Promise<FamilyStatus | null>;
  /** Занести jti access-токена в блэклист (TTL = остаток жизни токена). */
  blacklistAccessJti(jti: string, ttlSeconds: number): Promise<void>;
  /** Есть ли jti access-токена в блэклисте. */
  isAccessJtiBlacklisted(jti: string): Promise<boolean>;
}

const FAMILY_KEY = 'session:family:';
const JTI_KEY = 'session:jti:';
const ACCESS_BLACKLIST_KEY = 'auth:access-blacklist:';

/**
 * «30d»/«15m»/«12h»/«45s» → секунды. Неизвестный формат — fallback:
 * некорректная строка не должна молча обнулять TTL ключей.
 */
export function ttlStringToSeconds(input: string | undefined, fallback: number): number {
  if (!input) {
    return fallback;
  }
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(input.trim());
  if (!match) {
    return fallback;
  }
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(match[1]) * multipliers[match[2].toLowerCase()];
}

// ─── Lua-скрипты (атомарность в Redis) ─────────────────────────────────────

/** CAS: active → used; вернуть прежний статус ('' = ключа нет). */
const CONSUME_JTI_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if not v then return '' end
local status = string.match(v, ':([^:]+)$')
if status == 'active' then
  -- ВАЖНО: string.gsub возвращает (результат, счётчик) — скобки отбрасывают
  -- второй return, иначе он попал бы в SET лишним аргументом.
  redis.call('SET', KEYS[1], (string.gsub(v, ':active$', ':used')), 'KEEPTTL')
  return 'active'
end
return status
`;

/** Ротация/создание семьи: обновить JSON семьи, зарегистрировать новый jti. */
const UPSERT_FAMILY_SCRIPT = `
local meta
local fam = redis.call('GET', KEYS[1])
if fam then
  local ok, decoded = pcall(cjson.decode, fam)
  if ok and type(decoded) == 'table' then meta = decoded end
end
if not meta then
  meta = { familyId = ARGV[1], userId = ARGV[2], status = 'active', jtis = {} }
end
meta.status = 'active'
meta.currentJti = ARGV[3]
if type(meta.jtis) ~= 'table' then meta.jtis = {} end
table.insert(meta.jtis, ARGV[3])
redis.call('SET', KEYS[1], cjson.encode(meta), 'EX', tonumber(ARGV[4]))
redis.call('SET', KEYS[2] .. ARGV[3], ARGV[1] .. ':active', 'EX', tonumber(ARGV[4]))
return 1
`;

/**
 * Отзыв семьи: JSON → revoked, все jti семьи → revoked.
 * TTL продлеваем до полного: SET с KEEPTTL на уже истёкшем ключе создал бы
 * ключ без TTL (жил бы вечно) — EX надёжнее.
 */
const REVOKE_FAMILY_SCRIPT = `
local fam = redis.call('GET', KEYS[1])
if not fam then return 0 end
local ok, meta = pcall(cjson.decode, fam)
if not ok or type(meta) ~= 'table' then return 0 end
meta.status = 'revoked'
if type(meta.jtis) == 'table' and type(meta.familyId) == 'string' then
  for _, jti in ipairs(meta.jtis) do
    redis.call('SET', KEYS[2] .. jti, meta.familyId .. ':revoked', 'EX', tonumber(ARGV[1]))
  end
end
redis.call('SET', KEYS[1], cjson.encode(meta), 'EX', tonumber(ARGV[1]))
return 1
`;

/** Redis-реализация: ключи session:family:* / session:jti:* / блэклист. */
export class RedisSessionStore implements SessionStore {
  private readonly redis: Redis;

  constructor(
    url: string,
    private readonly ttlSeconds: number,
  ) {
    this.redis = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
  }

  async createSession(meta: { familyId: string; userId: string; jti: string }): Promise<void> {
    await this.redis.eval(
      UPSERT_FAMILY_SCRIPT,
      2,
      FAMILY_KEY + meta.familyId,
      JTI_KEY,
      meta.familyId,
      meta.userId,
      meta.jti,
      this.ttlSeconds,
    );
  }

  async consumeRefreshJti(jti: string): Promise<JtiStatus | null> {
    const result = (await this.redis.eval(CONSUME_JTI_SCRIPT, 1, JTI_KEY + jti)) as string;
    return result === '' ? null : (result as JtiStatus);
  }

  async rotateRefreshJti(input: {
    familyId: string;
    userId: string;
    newJti: string;
  }): Promise<void> {
    await this.redis.eval(
      UPSERT_FAMILY_SCRIPT,
      2,
      FAMILY_KEY + input.familyId,
      JTI_KEY,
      input.familyId,
      input.userId,
      input.newJti,
      this.ttlSeconds,
    );
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.redis.eval(REVOKE_FAMILY_SCRIPT, 2, FAMILY_KEY + familyId, JTI_KEY, this.ttlSeconds);
  }

  async revokeFamilies(familyIds: string[]): Promise<void> {
    // Семей у пользователя единицы — цикл вместо pipeline не критичен.
    for (const familyId of familyIds) {
      await this.revokeFamily(familyId);
    }
  }

  async getFamilyStatus(familyId: string): Promise<FamilyStatus | null> {
    const raw = await this.redis.get(FAMILY_KEY + familyId);
    if (!raw) {
      return null;
    }
    try {
      const meta = JSON.parse(raw) as { status?: unknown };
      return meta.status === 'revoked' ? 'revoked' : 'active';
    } catch {
      return null;
    }
  }

  async blacklistAccessJti(jti: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(ACCESS_BLACKLIST_KEY + jti, '1', 'EX', Math.max(1, ttlSeconds));
  }

  async isAccessJtiBlacklisted(jti: string): Promise<boolean> {
    return (await this.redis.exists(ACCESS_BLACKLIST_KEY + jti)) === 1;
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

interface TtlEntry<T> {
  value: T;
  expiresAt: number;
}

/** In-memory fallback: те же семантики и TTL, что в Redis (ленивая чистка). */
export class InMemorySessionStore implements SessionStore {
  private readonly families = new Map<
    string,
    TtlEntry<{ userId: string; status: FamilyStatus; jtis: string[] }>
  >();
  private readonly jtis = new Map<string, TtlEntry<{ familyId: string; status: JtiStatus }>>();
  private readonly accessBlacklist = new Map<string, number>();

  constructor(private readonly ttlSeconds: number = DEFAULT_REFRESH_TTL_SECONDS) {}

  async createSession(meta: { familyId: string; userId: string; jti: string }): Promise<void> {
    this.families.set(meta.familyId, {
      value: { userId: meta.userId, status: 'active', jtis: [meta.jti] },
      expiresAt: this.deadline(),
    });
    this.jtis.set(meta.jti, {
      value: { familyId: meta.familyId, status: 'active' },
      expiresAt: this.deadline(),
    });
  }

  async consumeRefreshJti(jti: string): Promise<JtiStatus | null> {
    const entry = this.getFresh(this.jtis, jti);
    if (!entry) {
      return null;
    }
    if (entry.value.status === 'active') {
      entry.value.status = 'used';
      return 'active';
    }
    return entry.value.status;
  }

  async rotateRefreshJti(input: {
    familyId: string;
    userId: string;
    newJti: string;
  }): Promise<void> {
    const family = this.getFresh(this.families, input.familyId);
    if (family) {
      family.value.jtis.push(input.newJti);
      family.value.status = 'active';
      family.expiresAt = this.deadline();
    } else {
      this.families.set(input.familyId, {
        value: { userId: input.userId, status: 'active', jtis: [input.newJti] },
        expiresAt: this.deadline(),
      });
    }
    this.jtis.set(input.newJti, {
      value: { familyId: input.familyId, status: 'active' },
      expiresAt: this.deadline(),
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    const family = this.getFresh(this.families, familyId);
    if (!family) {
      return;
    }
    family.value.status = 'revoked';
    family.expiresAt = this.deadline();
    for (const jti of family.value.jtis) {
      const entry = this.getFresh(this.jtis, jti);
      if (entry) {
        entry.value.status = 'revoked';
        entry.expiresAt = this.deadline();
      }
    }
  }

  async revokeFamilies(familyIds: string[]): Promise<void> {
    for (const familyId of familyIds) {
      await this.revokeFamily(familyId);
    }
  }

  async getFamilyStatus(familyId: string): Promise<FamilyStatus | null> {
    return this.getFresh(this.families, familyId)?.value.status ?? null;
  }

  async blacklistAccessJti(jti: string, ttlSeconds: number): Promise<void> {
    this.accessBlacklist.set(jti, Date.now() + Math.max(1, ttlSeconds) * 1000);
  }

  async isAccessJtiBlacklisted(jti: string): Promise<boolean> {
    const expiresAt = this.accessBlacklist.get(jti);
    if (expiresAt === undefined) {
      return false;
    }
    if (Date.now() > expiresAt) {
      this.accessBlacklist.delete(jti);
      return false;
    }
    return true;
  }

  private deadline(): number {
    return Date.now() + this.ttlSeconds * 1000;
  }

  /** Запись с ленивой проверкой истечения — как EX в Redis. */
  private getFresh<T>(map: Map<string, TtlEntry<T>>, key: string): TtlEntry<T> | null {
    const entry = map.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      map.delete(key);
      return null;
    }
    return entry;
  }
}

/** Есть ли у хранилища соединение, которое нужно закрыть при остановке. */
export function isClosableStore(
  store: SessionStore,
): store is SessionStore & { close(): Promise<void> } {
  return typeof (store as { close?: unknown }).close === 'function';
}

/**
 * Фабрика хранилища: Redis при REDIS_URL; иначе in-memory для разработки.
 * В production без REDIS_URL — ошибка старта (fail-closed): отдавать
 * неотзываемые refresh-токены нельзя (ADR-008).
 */
export const sessionStoreProvider = {
  provide: SESSION_STORE,
  useFactory: (): SessionStore => {
    const url = process.env.REDIS_URL;
    const ttl = ttlStringToSeconds(process.env.JWT_REFRESH_TTL, DEFAULT_REFRESH_TTL_SECONDS);
    if (url) {
      return new RedisSessionStore(url, ttl);
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'В production обязателен REDIS_URL: сессии без Redis не отзываются (ADR-008)',
      );
    }
    Logger.warn(
      'REDIS_URL не задан — сессии refresh-токенов хранятся в памяти процесса. ' +
        'Только для разработки и e2e; для продакшена обязателен Redis (см. ADR-008).',
      'AuthModule',
    );
    return new InMemorySessionStore(ttl);
  },
};

/** Закрывает Redis-соединение хранилища при остановке приложения. */
@Injectable()
export class SessionStoreShutdown implements OnModuleDestroy {
  constructor(@Inject(SESSION_STORE) private readonly store: SessionStore) {}

  async onModuleDestroy(): Promise<void> {
    if (isClosableStore(this.store)) {
      await this.store.close();
    }
  }
}

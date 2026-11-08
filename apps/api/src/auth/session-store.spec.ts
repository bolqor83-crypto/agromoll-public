/**
 * Unit-тесты InMemorySessionStore (v0.3.1): семантики ротации, отзыва
 * и блэклиста. Redis-реализация использует те же контракты через Lua
 * (GETDEL-подобный CAS) и покрыта e2e в CI против реального Redis —
 * здесь проверяем логику состояний и TTL.
 */
import {
  InMemorySessionStore,
  isClosableStore,
  sessionStoreProvider,
  ttlStringToSeconds,
  type SessionStore,
} from './session-store';
import { DEFAULT_REFRESH_TTL_SECONDS } from './auth.constants';

describe('InMemorySessionStore', () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    // короткий TTL, чтобы проверить истечение без часового ожидания
    store = new InMemorySessionStore(1); // 1 секунда
  });

  describe('жизненный цикл jti', () => {
    it('active → consume → used → повторный consume → used (reuse)', async () => {
      await store.createSession({ familyId: 'f-1', userId: 'u-1', jti: 'j-1' });

      await expect(store.consumeRefreshJti('j-1')).resolves.toBe('active');
      await expect(store.consumeRefreshJti('j-1')).resolves.toBe('used');
    });

    it('неизвестный jti — null (истёк или отозван и забыт)', async () => {
      await expect(store.consumeRefreshJti('nope')).resolves.toBeNull();
    });

    it('TTL истекает: jti и семья исчезают', async () => {
      await store.createSession({ familyId: 'f-1', userId: 'u-1', jti: 'j-1' });
      await expect(store.getFamilyStatus('f-1')).resolves.toBe('active');

      await new Promise((resolve) => setTimeout(resolve, 1100));

      await expect(store.consumeRefreshJti('j-1')).resolves.toBeNull();
      await expect(store.getFamilyStatus('f-1')).resolves.toBeNull();
    });
  });

  describe('ротация', () => {
    it('новый jti активен, семья продлевается', async () => {
      await store.createSession({ familyId: 'f-1', userId: 'u-1', jti: 'j-1' });
      await store.consumeRefreshJti('j-1');

      await store.rotateRefreshJti({ familyId: 'f-1', userId: 'u-1', newJti: 'j-2' });

      await expect(store.consumeRefreshJti('j-2')).resolves.toBe('active');
      await expect(store.getFamilyStatus('f-1')).resolves.toBe('active');
    });

    it('ротация в неизвестной семье создаёт её заново (defensive)', async () => {
      await store.rotateRefreshJti({ familyId: 'f-x', userId: 'u-1', newJti: 'j-x' });
      await expect(store.consumeRefreshJti('j-x')).resolves.toBe('active');
    });
  });

  describe('отзыв семьи', () => {
    it('revokeFamily: все jti (включая использованные) → revoked', async () => {
      await store.createSession({ familyId: 'f-1', userId: 'u-1', jti: 'j-1' });
      await store.consumeRefreshJti('j-1');
      await store.rotateRefreshJti({ familyId: 'f-1', userId: 'u-1', newJti: 'j-2' });

      await store.revokeFamily('f-1');

      await expect(store.getFamilyStatus('f-1')).resolves.toBe('revoked');
      // текущий jti
      await expect(store.consumeRefreshJti('j-2')).resolves.toBe('revoked');
      // старый (уже used) — тоже revoked, не 'used'
      await expect(store.consumeRefreshJti('j-1')).resolves.toBe('revoked');
    });

    it('revokeFamily неизвестной семьи — не ошибка (идемпотентность)', async () => {
      await expect(store.revokeFamily('f-nope')).resolves.toBeUndefined();
    });

    it('revokeFamilies отзывает каждую', async () => {
      await store.createSession({ familyId: 'f-1', userId: 'u-1', jti: 'j-1' });
      await store.createSession({ familyId: 'f-2', userId: 'u-1', jti: 'j-2' });

      await store.revokeFamilies(['f-1', 'f-2']);

      await expect(store.getFamilyStatus('f-1')).resolves.toBe('revoked');
      await expect(store.getFamilyStatus('f-2')).resolves.toBe('revoked');
    });
  });

  describe('блэклист access-токенов', () => {
    it('jti в блэклисте до истечения TTL', async () => {
      await store.blacklistAccessJti('a-1', 1);
      await expect(store.isAccessJtiBlacklisted('a-1')).resolves.toBe(true);
      await expect(store.isAccessJtiBlacklisted('a-2')).resolves.toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 1100));
      // TTL вышел — записи больше нет
      await expect(store.isAccessJtiBlacklisted('a-1')).resolves.toBe(false);
    });

    it('TTL не может быть нулевым (минимум 1 секунда)', async () => {
      await store.blacklistAccessJti('a-0', 0);
      await expect(store.isAccessJtiBlacklisted('a-0')).resolves.toBe(true);
    });
  });
});

describe('ttlStringToSeconds', () => {
  it.each([
    ['15m', 900],
    ['30d', DEFAULT_REFRESH_TTL_SECONDS],
    ['45s', 45],
    ['12h', 43200],
    ['2d', 172800],
  ])('%s → %i секунд', (input, expected) => {
    expect(ttlStringToSeconds(input, 1)).toBe(expected);
  });

  it('мусор и undefined — fallback', () => {
    expect(ttlStringToSeconds(undefined, 42)).toBe(42);
    expect(ttlStringToSeconds('abc', 42)).toBe(42);
    expect(ttlStringToSeconds('', 42)).toBe(42);
  });
});

describe('sessionStoreProvider: production без Redis (v0.8.1-B, ADR-040)', () => {
  const factory = (): SessionStore =>
    (sessionStoreProvider as { useFactory: () => SessionStore }).useFactory();

  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.SESSION_ALLOW_IN_MEMORY;
    delete process.env.REDIS_URL;
  });

  it('production без REDIS_URL и без флага — fail-closed (ADR-008)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SESSION_ALLOW_IN_MEMORY;
    expect(factory).toThrow('обязателен REDIS_URL');
  });

  it('production + SESSION_ALLOW_IN_MEMORY=true — in-memory (демо, ADR-040)', () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_ALLOW_IN_MEMORY = 'true';
    expect(factory()).toBeInstanceOf(InMemorySessionStore);
  });

  it('флаг не влияет на заданный REDIS_URL — только Redis', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_ALLOW_IN_MEMORY = 'true';
    process.env.REDIS_URL = 'redis://localhost:6379';
    // RedisSessionStore создаётся без блокировки (lazyConnect: false —
    // соединение в фоне); проверяем тип и сразу закрываем, чтобы фоновые
    // реконнекты не держали процесс jest (close → quit, при недоступном
    // сервере — disconnect).
    const store = factory();
    try {
      expect(store).not.toBeInstanceOf(InMemorySessionStore);
    } finally {
      if (isClosableStore(store)) await store.close();
    }
  });
});

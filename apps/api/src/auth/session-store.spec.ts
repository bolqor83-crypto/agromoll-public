/**
 * Unit-тесты InMemorySessionStore (v0.3.1): семантики ротации, отзыва
 * и блэклиста. Redis-реализация использует те же контракты через Lua
 * (GETDEL-подобный CAS) и покрыта e2e в CI против реального Redis —
 * здесь проверяем логику состояний и TTL.
 */
import { InMemorySessionStore, ttlStringToSeconds } from './session-store';
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

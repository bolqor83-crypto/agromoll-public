/**
 * Unit-тесты AuthService (v0.3.0/v0.3.1): request-code / verify / refresh
 * (ротация + reuse detection) / logout / revokeOtherSessions.
 *
 * Prisma замокан, JwtService — настоящий (секрет теста), коды —
 * in-memory хранилище, сессии — InMemorySessionStore (те же семантики,
 * что в Redis-версии; Redis-путь дополнительно покрыт e2e в CI).
 * Сетевых зависимостей нет.
 */
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { InMemoryCodeStore } from './code-store';
import { InMemorySessionStore } from './session-store';
import { TOKEN_REUSE_DETECTED } from './auth.constants';
import type { PrismaService } from '../prisma/prisma.service';

const ACCESS_SECRET = 'test-access-secret';
const REFRESH_SECRET = 'test-refresh-secret';

type UserRecord = {
  id: string;
  role: 'buyer' | 'seller' | 'driver';
  displayName: string;
  phone: string | null;
  phoneVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'u-1',
    role: 'buyer',
    displayName: 'Ларёк «У Ашота»',
    phone: '+79611234567',
    phoneVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Полный вход через сервис (код-заглушка dev) — чтобы получить живую пару. */
async function login(service: AuthService, prismaMock: {
  user: { upsert: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
  session: Record<string, jest.Mock>;
}, phone = '+79611234567') {
  prismaMock.user.upsert.mockResolvedValue(makeUser());
  await service.requestCode(phone);
  prismaMock.user.update.mockResolvedValue(makeUser({ phoneVerified: true }));
  // refresh после входа перечитывает пользователя — мок по умолчанию
  prismaMock.user.findUnique.mockResolvedValue(makeUser({ phoneVerified: true }));
  return service.verify(phone, '0000');
}

describe('AuthService', () => {
  let prisma: {
    user: {
      upsert: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
    };
    session: {
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let codes: InMemoryCodeStore;
  let sessions: InMemorySessionStore;
  let service: AuthService;

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
  });

  afterAll(() => {
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
  });

  beforeEach(() => {
    prisma = {
      user: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
      session: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    codes = new InMemoryCodeStore();
    sessions = new InMemorySessionStore();
    const jwt = new JwtService({ secret: ACCESS_SECRET }); // подпись access
    // refresh подписывается своим секретом через options.secret — базовый не важен
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt,
      codes,
      sessions,
    );
  });

  describe('requestCode', () => {
    it('создаёт/находит пользователя и сохраняет dev-код «0000»', async () => {
      prisma.user.upsert.mockResolvedValue(makeUser());

      const result = await service.requestCode('+79611234567');

      expect(result).toEqual({ expiresInSec: 300 });
      expect(prisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { phone: '+79611234567' } }),
      );
      await expect(codes.get('+79611234567')).resolves.toBe('0000');
    });

    it('новому пользователю даёт имя «Участник +7***4567» и роль buyer', async () => {
      prisma.user.upsert.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
        makeUser(create as Partial<UserRecord>),
      );

      await service.requestCode('+79611234567');

      expect(prisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            phone: '+79611234567',
            displayName: 'Участник +7***4567',
            role: 'buyer',
          }),
        }),
      );
    });
  });

  describe('verify', () => {
    it('возвращает токены и профиль, открывает сессию (Redis + аудит-строка)', async () => {
      await codes.save('+79611234567', '0000');
      prisma.user.update.mockResolvedValue(makeUser({ phoneVerified: true }));

      const result = await service.verify('+79611234567', '0000', {
        userAgent: 'Jest/1.0',
        ip: '127.0.0.1',
      });

      expect(result.user).toMatchObject({ id: 'u-1', phoneVerified: true });
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');

      // аудит-строка Session: familyId, currentJti, userAgent, ip
      expect(prisma.session.create).toHaveBeenCalledTimes(1);
      const created = prisma.session.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(created.data).toMatchObject({
        userId: 'u-1',
        userAgent: 'Jest/1.0',
        ip: '127.0.0.1',
      });
      expect(typeof created.data.familyId).toBe('string');
      expect(typeof created.data.currentJti).toBe('string');

      // access-токен несёт jti и familyId; refresh — jti, familyId, sub, роль
      const access = new JwtService({ secret: ACCESS_SECRET }).verify<{
        sub: string;
        role: string;
        jti?: string;
        familyId?: string;
      }>(result.accessToken);
      expect(access.jti).toBeTruthy();
      expect(access.familyId).toBe(created.data.familyId);

      const refresh = new JwtService({ secret: REFRESH_SECRET }).verify<{
        sub: string;
        jti?: string;
        familyId?: string;
      }>(result.refreshToken);
      expect(refresh.jti).toBe(created.data.currentJti);
      expect(refresh.familyId).toBe(created.data.familyId);
    });

    it('неверный код — 401, код НЕ сгорает (можно перепечатать)', async () => {
      await codes.save('+79611234567', '123456');

      await expect(service.verify('+79611234567', '654321')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(codes.get('+79611234567')).resolves.toBe('123456');
    });

    it('истёкший/несуществующий код — 401', async () => {
      await expect(service.verify('+79611234567', '0000')).rejects.toThrow(
        'Код не найден или истёк',
      );
    });

    it('session store недоступен — вход не выдаёт токены (fail-closed, 503)', async () => {
      await codes.save('+79611234567', '0000');
      prisma.user.update.mockResolvedValue(makeUser({ phoneVerified: true }));
      sessions.createSession = jest.fn().mockRejectedValue(new Error('redis down'));

      await expect(service.verify('+79611234567', '0000')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('refresh (ротация, v0.3.1)', () => {
    it('возвращает НОВУЮ пару, старый jti помечен used', async () => {
      const first = await login(service, prisma);

      const second = await service.refresh(first.refreshToken);

      expect(typeof second.accessToken).toBe('string');
      expect(typeof second.refreshToken).toBe('string');
      // новая пара реально работает: refresh по новому токену succeeds
      const third = await service.refresh(second.refreshToken);
      expect(typeof third.refreshToken).toBe('string');

      // аудит: currentJti обновлён, старый jti ушёл в usedJtis
      expect(prisma.session.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ usedJtis: { push: expect.any(String) } }),
        }),
      );
    });

    it('повторное использование СТАРОГО refresh — вся семья отозвана, 401 TOKEN_REUSE_DETECTED', async () => {
      const first = await login(service, prisma);
      const second = await service.refresh(first.refreshToken);

      // Вор предъявил старый токен:
      const reuseError = await service.refresh(first.refreshToken).catch((e: unknown) => e);
      expect(reuseError).toBeInstanceOf(UnauthorizedException);
      const response = (reuseError as UnauthorizedException).getResponse() as {
        code?: string;
      };
      expect(response.code).toBe(TOKEN_REUSE_DETECTED);

      // Семья мертва: новый (легитимный) токен тоже больше не работает
      await expect(service.refresh(second.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // и аудит помечен отозванным
      expect(prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
      );
    });

    it('токен формата v0.3.0 (без jti/familyId) — 401', async () => {
      const jwt = new JwtService({ secret: REFRESH_SECRET });
      const legacyToken = jwt.sign({ sub: 'u-1', role: 'buyer' });
      await expect(service.refresh(legacyToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('мусорный токен — 401', async () => {
      await expect(service.refresh('garbage')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('токен access-секретом вместо refresh — 401 (секреты разные)', async () => {
      const jwt = new JwtService({ secret: ACCESS_SECRET });
      const wrongToken = jwt.sign({ sub: 'u-1' });
      await expect(service.refresh(wrongToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('пользователь удалён — 401', async () => {
      const jwt = new JwtService({ secret: REFRESH_SECRET });
      const refreshToken = jwt.sign(
        { sub: 'ghost', familyId: 'f-1' },
        { jwtid: 'j-1' },
      );
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('session store недоступен — 401 (fail-closed), не fail-open', async () => {
      const first = await login(service, prisma);
      sessions.consumeRefreshJti = jest.fn().mockRejectedValue(new Error('redis down'));

      await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('logout (v0.3.1)', () => {
    it('отзывает семью: refresh с этим токеном — 401, access-jti в блэклисте', async () => {
      const first = await login(service, prisma);

      await service.logout({ refreshToken: first.refreshToken, accessToken: first.accessToken });

      // refresh мёртв
      await expect(service.refresh(first.refreshToken)).rejects.toThrow('Сессия завершена');
      // access-jti в блэклисте (guard отклонит токен)
      await expect(service.isAccessTokenRevoked(extractJti(first.accessToken))).resolves.toBe(true);
      // аудит помечен отозванным
      expect(prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
      );
    });

    it('идемпотентен: повторный logout и мусорный токен — не ошибка', async () => {
      const first = await login(service, prisma);
      await service.logout({ refreshToken: first.refreshToken });
      // повтор — уже «вышли»
      await expect(service.logout({ refreshToken: first.refreshToken })).resolves.toBeUndefined();
      // мусор — не ошибка
      await expect(service.logout({ refreshToken: 'not-a-jwt' })).resolves.toBeUndefined();
    });

    it('session store недоступен — 503 (отзыв не подтверждён вслепую)', async () => {
      const first = await login(service, prisma);
      sessions.revokeFamily = jest.fn().mockRejectedValue(new Error('redis down'));

      await expect(service.logout({ refreshToken: first.refreshToken })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('revokeOtherSessions (смена роли, v0.3.1)', () => {
    it('отзывает все семьи кроме текущей', async () => {
      prisma.session.findMany.mockResolvedValue([
        { familyId: 'f-other-1' },
        { familyId: 'f-other-2' },
      ]);
      const revokeSpy = jest.spyOn(sessions, 'revokeFamilies');

      const count = await service.revokeOtherSessions('u-1', 'f-current');

      expect(count).toBe(2);
      expect(revokeSpy).toHaveBeenCalledWith(['f-other-1', 'f-other-2']);
      expect(prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { familyId: { in: ['f-other-1', 'f-other-2'] } },
        }),
      );
    });

    it('других сессий нет — 0 и без отзыва', async () => {
      prisma.session.findMany.mockResolvedValue([]);
      const count = await service.revokeOtherSessions('u-1', 'f-current');
      expect(count).toBe(0);
      expect(prisma.session.updateMany).not.toHaveBeenCalled();
    });

    it('session store недоступен — 503, роль менять нельзя (fail-closed)', async () => {
      prisma.session.findMany.mockResolvedValue([{ familyId: 'f-other-1' }]);
      sessions.revokeFamilies = jest.fn().mockRejectedValue(new Error('redis down'));

      await expect(service.revokeOtherSessions('u-1', 'f-current')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('isAccessTokenRevoked (блэклист для guard)', () => {
    it('нет jti (токен v0.3.0) — не отозван', async () => {
      await expect(service.isAccessTokenRevoked(undefined)).resolves.toBe(false);
    });

    it('store недоступен — fail-closed: отозван', async () => {
      sessions.isAccessJtiBlacklisted = jest.fn().mockRejectedValue(new Error('redis down'));
      await expect(service.isAccessTokenRevoked('j-1')).resolves.toBe(true);
    });
  });
});

/** jti из JWT без проверки подписи (как blacklistAccessToken в сервисе). */
function extractJti(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8')) as {
    jti: string;
  };
  return payload.jti;
}

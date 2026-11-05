/**
 * Unit-тесты AuthService (v0.3.0): request-code / verify / refresh.
 *
 * Prisma замокан, JwtService — настоящий (секрет теста), коды —
 * in-memory хранилище. Сетевых зависимостей нет.
 */
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { InMemoryCodeStore } from './code-store';
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

describe('AuthService', () => {
  let prisma: {
    user: {
      upsert: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let codes: InMemoryCodeStore;
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
    prisma = { user: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() } };
    codes = new InMemoryCodeStore();
    const jwt = new JwtService({ secret: ACCESS_SECRET }); // подпись access
    // refresh подписывается своим секретом через options.secret — базовый не важен
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt,
      codes,
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

    it('перезаписывает предыдущий код (старый больше не работает)', async () => {
      prisma.user.upsert.mockResolvedValue(makeUser());
      prisma.user.update.mockResolvedValue(makeUser({ phoneVerified: true }));
      await service.requestCode('+79611234567');
      await service.requestCode('+79611234567');

      const verify = await service.verify('+79611234567', '0000');
      expect(verify.accessToken).toBeTruthy();

      // код одноразовый и удалён
      await expect(codes.get('+79611234567')).resolves.toBeNull();
    });
  });

  describe('verify', () => {
    it('возвращает токены и профиль, помечает phoneVerified', async () => {
      await codes.save('+79611234567', '0000');
      prisma.user.update.mockResolvedValue(makeUser({ phoneVerified: true }));

      const result = await service.verify('+79611234567', '0000');

      expect(result.user).toMatchObject({
        id: 'u-1',
        phone: '+79611234567',
        phoneVerified: true,
      });
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { phone: '+79611234567' },
        data: { phoneVerified: true },
      });
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

    it('код одноразовый: повторный verify — 401', async () => {
      await codes.save('+79611234567', '0000');
      prisma.user.update.mockResolvedValue(makeUser({ phoneVerified: true }));

      await service.verify('+79611234567', '0000');
      await expect(service.verify('+79611234567', '0000')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('access-токен содержит sub и роль, подписан access-секретом', async () => {
      await codes.save('+79611234567', '0000');
      prisma.user.update.mockResolvedValue(makeUser({ role: 'seller', phoneVerified: true }));

      const { accessToken, refreshToken } = await service.verify('+79611234567', '0000');

      const verifier = new JwtService({ secret: ACCESS_SECRET });
      const access = verifier.verify<{ sub: string; role: string }>(accessToken);
      expect(access).toMatchObject({ sub: 'u-1', role: 'seller' });

      const refreshVerifier = new JwtService({ secret: REFRESH_SECRET });
      const refresh = refreshVerifier.verify<{ sub: string }>(refreshToken);
      expect(refresh.sub).toBe('u-1');
    });
  });

  describe('refresh', () => {
    it('выдаёт новый валидный access-токен', async () => {
      const jwt = new JwtService({ secret: REFRESH_SECRET });
      const refreshToken = jwt.sign({ sub: 'u-1', role: 'buyer' });
      prisma.user.findUnique.mockResolvedValue(makeUser({ role: 'seller' }));

      const result = await service.refresh(refreshToken);

      const verifier = new JwtService({ secret: ACCESS_SECRET });
      expect(verifier.verify<{ sub: string; role: string }>(result.accessToken)).toMatchObject({
        sub: 'u-1',
        role: 'seller',
      });
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
      const refreshToken = jwt.sign({ sub: 'ghost' });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});

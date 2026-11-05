/**
 * E2E подэтапа A (v0.3.1): отзыв refresh-токенов — ротация, обнаружение
 * повторного использования, logout, блэклист access-токенов.
 *
 * Требует DATABASE_URL и REDIS_URL — в CI запускается с service-
 * контейнерами (реальный Postgres + Redis: Lua-скрипты session-store
 * проверяются именно здесь).
 *
 * Сценарии:
 *  1. login → refresh (ротация: новая пара) → старый refresh повторно →
 *     401 TOKEN_REUSE_DETECTED → новый refresh тоже 401 (семья мертва).
 *  2. logout → access к /bookings → 401 (блэклист jti), refresh → 401.
 *     Повторный logout → 204 (идемпотентность).
 *  3. Смена роли → все сессии пользователя, кроме текущей, отозваны.
 *  4. Мусорный refresh в logout → 204, access всё равно в блэклисте.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CODE_STORE } from '../src/auth/auth.constants';
import type { CodeStore } from '../src/auth/code-store';
import { authHeader, registerAndLogin, uniquePhone } from './auth.helper';

describe('Refresh token revocation (e2e, HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let codes: CodeStore;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    codes = app.get<CodeStore>(CODE_STORE);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.bookingEvent.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.listing.deleteMany();
    // сессии каскадятся удалением пользователей (onDelete: Cascade)
    await prisma.user.deleteMany();
    await app.close();
  });

  it('ротация: новая пара; повторное использование старого — семья отозвана', async () => {
    const user = await registerAndLogin(app, 'buyer');

    // 1. Ротация: старый refresh → новая ПАРА токенов
    const rotated = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(200);
    expect(typeof rotated.body.accessToken).toBe('string');
    expect(typeof rotated.body.refreshToken).toBe('string');
    // старый и новый refresh различаются (новый jti)
    expect(rotated.body.refreshToken).not.toBe(user.refreshToken);

    // 2. Старый refresh предъявлен повторно (сценарий кражи)
    const reuse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);
    expect(reuse.body).toMatchObject({ code: 'TOKEN_REUSE_DETECTED' });

    // 3. Семья мертва: даже свежий (легитимный) refresh не работает
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);

    // 4. Аудит в БД: семья помечена отозванной
    const accessPayload = decodeJwt(user.accessToken);
    const session = await prisma.session.findUnique({
      where: { familyId: accessPayload.familyId as string },
    });
    expect(session?.revokedAt).not.toBeNull();
    // история ротации записана
    expect(session?.usedJtis.length).toBeGreaterThanOrEqual(1);
  });

  it('logout: access в блэклисте, refresh мёртв, повторный logout — 204', async () => {
    const user = await registerAndLogin(app, 'buyer');

    // до logout — доступ есть
    await request(app.getHttpServer()).get('/bookings').set(authHeader(user)).expect(200);

    // logout с обоими токенами
    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: user.refreshToken, accessToken: user.accessToken })
      .expect(204);

    // access-токен отклонён (jti в блэклисте)
    await request(app.getHttpServer()).get('/bookings').set(authHeader(user)).expect(401);

    // refresh тоже мёртв
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);

    // идемпотентность: повторный logout — не ошибка
    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: user.refreshToken })
      .expect(204);
  });

  it('logout с мусорным refresh: access всё равно отзывается (204)', async () => {
    const user = await registerAndLogin(app, 'buyer');

    // refresh «сгорел», но access ещё жив — сервер должен отозвать access
    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: 'not-a-jwt', accessToken: user.accessToken })
      .expect(204);

    await request(app.getHttpServer()).get('/bookings').set(authHeader(user)).expect(401);
  });

  it('смена роли отзывает все сессии, кроме текущей', async () => {
    // Два входа на одном телефоне = два устройства = две семьи.
    // request-code лимитирован 1/мин на телефон, поэтому код «восстанавливаем»
    // в хранилище между входами (тот же трюк, что делает e2e-хелпер).
    const phone = uniquePhone();
    await request(app.getHttpServer()).post('/auth/request-code').send({ phone }).expect(200);
    const code = await codes.get(phone);
    if (!code) {
      throw new Error('Код не найден — request-code не сработал');
    }

    const deviceA = await request(app.getHttpServer())
      .post('/auth/verify')
      .send({ phone, code })
      .expect(200);
    await codes.save(phone, code); // код одноразовый — вернём для второго входа
    const deviceB = await request(app.getHttpServer())
      .post('/auth/verify')
      .send({ phone, code })
      .expect(200);

    // Устройство A меняет роль → сессия устройства B отозвана
    await request(app.getHttpServer())
      .patch('/users/me/role')
      .set('Authorization', `Bearer ${deviceA.body.accessToken}`)
      .send({ role: 'seller' })
      .expect(200);

    // B: refresh не работает (семья отозвана)
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: deviceB.body.refreshToken })
      .expect(401);

    // A: текущая сессия жива — refresh работает
    const refreshedA = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: deviceA.body.refreshToken })
      .expect(200);
    expect(typeof refreshedA.body.accessToken).toBe('string');
  });
});

/** Декод payload JWT без проверки подписи (jti/familyId для проверок). */
function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
}

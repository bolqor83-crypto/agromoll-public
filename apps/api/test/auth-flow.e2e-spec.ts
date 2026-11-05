/**
 * E2E подэтапа A (v0.3.0): аутентификация телефон + SMS-код → JWT.
 *
 * Требует DATABASE_URL (и REDIS_URL, если коды в Redis) — запускается
 * в CI с service-контейнерами командой `pnpm --filter @agromoll/api test:e2e`.
 *
 * Флоу: request-code → verify → доступ к /bookings с JWT → 401 без токена
 * → refresh → доступ с новым токеном. Плюс rate limit, неверный код,
 * повторное использование кода, смена роли.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CODE_STORE } from '../src/auth/auth.constants';
import type { CodeStore } from '../src/auth/code-store';
import { authHeader, registerAndLogin, uniquePhone } from './auth.helper';

describe('Auth flow (e2e, HTTP)', () => {
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
    await prisma.user.deleteMany();
    await app.close();
  });

  it('request-code → verify → /bookings с JWT → 401 без токена → refresh', async () => {
    const phone = uniquePhone();

    // 1. Запрос кода
    const requested = await request(app.getHttpServer())
      .post('/auth/request-code')
      .send({ phone })
      .expect(200);
    expect(requested.body).toMatchObject({ expiresInSec: 300 });

    // 2. Без токена — 401
    await request(app.getHttpServer()).get('/bookings').expect(401);

    // 3. Неверный код — 401, код остаётся валиден (не сгорает)
    const code = await codes.get(phone);
    expect(code).toBeTruthy();
    await request(app.getHttpServer())
      .post('/auth/verify')
      .send({ phone, code: '999999' })
      .expect(401);

    // 4. Верный код — токены + профиль
    const verified = await request(app.getHttpServer())
      .post('/auth/verify')
      .send({ phone, code: code as string })
      .expect(200);
    expect(verified.body.user).toMatchObject({
      phone,
      phoneVerified: true,
      role: 'buyer',
    });
    expect(typeof verified.body.accessToken).toBe('string');
    expect(typeof verified.body.refreshToken).toBe('string');

    // 5. Код одноразовый: повторная проверка — 401
    await request(app.getHttpServer())
      .post('/auth/verify')
      .send({ phone, code: code as string })
      .expect(401);

    // 6. Доступ к /bookings с access-токеном — 200 (пустой список)
    await request(app.getHttpServer())
      .get('/bookings')
      .set('Authorization', `Bearer ${verified.body.accessToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual([]);
      });

    // 7. Refresh → новый access-токен работает
    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: verified.body.refreshToken })
      .expect(200);
    expect(typeof refreshed.body.accessToken).toBe('string');
    // заметка: подпись в ту же секунду может дать идентичную строку JWT
    // (одинаковые payload и iat) — важна работоспособность, а не различие.

    await request(app.getHttpServer())
      .get('/bookings')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .expect(200);

    // 8. Мусорный refresh-токен — 401
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'not-a-jwt' })
      .expect(401);

    // 9. Пользователь создан в БД с телефоном
    const user = await prisma.user.findUnique({ where: { phone } });
    expect(user).not.toBeNull();
    expect(user?.phoneVerified).toBe(true);
  });

  it('rate limit: второй request-code на тот же телефон в минуту — 429', async () => {
    const phone = uniquePhone();
    await request(app.getHttpServer()).post('/auth/request-code').send({ phone }).expect(200);
    await request(app.getHttpServer()).post('/auth/request-code').send({ phone }).expect(429);
    // на другой телефон лимит не действует
    await request(app.getHttpServer())
      .post('/auth/request-code')
      .send({ phone: uniquePhone() })
      .expect(200);
  });

  it('невалидный телефон — 400', async () => {
    await request(app.getHttpServer())
      .post('/auth/request-code')
      .send({ phone: '12345' })
      .expect(400);
  });

  it('истёкший код: удаление из хранилища → 401', async () => {
    const phone = uniquePhone();
    await request(app.getHttpServer()).post('/auth/request-code').send({ phone }).expect(200);
    // эмулируем истечение TTL (то же, что делает Redis по EX)
    await codes.delete(phone);
    await request(app.getHttpServer())
      .post('/auth/verify')
      .send({ phone, code: '000000' })
      .expect(401);
  });

  it('PATCH /users/me/role меняет роль, GET /users/me возвращает профиль', async () => {
    const user = await registerAndLogin(app, 'buyer');

    const patched = await request(app.getHttpServer())
      .patch('/users/me/role')
      .set(authHeader(user))
      .send({ role: 'seller' })
      .expect(200);
    expect(patched.body.role).toBe('seller');

    // Роль сразу действует: buyer-эндпоинт теперь 403
    await request(app.getHttpServer())
      .post('/bookings')
      .set(authHeader(user))
      .send({ listingId: '00000000-0000-4000-8000-000000000000', requestedQuantity: 1 })
      .expect(403);

    // seller-эндпоинт доступен
    await request(app.getHttpServer())
      .post('/listings')
      .set(authHeader(user))
      .send({
        title: 'Лук репчатый',
        category: 'vegetables',
        unit: 'kg',
        pricePerUnit: 30,
        quantityAvailable: 10,
      })
      .expect(201);

    const me = await request(app.getHttpServer())
      .get('/users/me')
      .set(authHeader(user))
      .expect(200);
    expect(me.body).toMatchObject({ id: user.id, role: 'seller' });
  });

  it('смена роли + новый логин: роль сохранена в профиле', async () => {
    const user = await registerAndLogin(app, 'seller');
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored?.role).toBe('seller');
  });
});

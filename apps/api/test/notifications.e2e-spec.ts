/**
 * E2E push-уведомлений (v0.6.0-A, ADR-031): HTTP против реального Postgres.
 *
 * Реальная доставка в CI не тестируется (нет Firebase/устройств) —
 * провайдер мокается сам собой: без FCM_SERVICE_ACCOUNT_JSON и VAPID_*
 * транспорты — Noop (доставка «успешна» вхолостую). Проверяем контракты:
 *
 *  - регистрация FCM-токена: upsert (идемпотентность, перепривязка);
 *  - регистрация Web Push-подписки: upsert по endpoint;
 *  - бизнес-события → NotificationLog (бронь: counter_offered/confirmed/
 *    cancelled; доставка: assigned/delivered);
 *  - in-app уведомление пишется вместе с push;
 *  - журнал /notifications/log — только свои записи;
 *  - unregister: токен отвязывается;
 *  - /notifications/vapid-public — null без настроенных ключей.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { authHeader, registerAndLogin } from './auth.helper';
import type { TestUser } from './auth.helper';

describe('Push-уведомления (e2e, ADR-031)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let seller: TestUser;
  let buyer: TestUser;
  let listingId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    seller = await registerAndLogin(app, 'seller');
    buyer = await registerAndLogin(app, 'buyer');
    const listing = await request(app.getHttpServer())
      .post('/listings')
      .set(authHeader(seller))
      .send({
        title: 'Картофель молодой',
        category: 'vegetables',
        unit: 'kg',
        pricePerUnit: '42.00',
        quantityAvailable: 200,
        lineNumber: 3,
      })
      .expect(201);
    listingId = listing.body.id;
  });

  /** Push пишется в журнал асинхронно (fire-and-forort после ответа):
   *  ждём появления строк с поллингом, чтобы не завязываться на тайминги. */
  async function waitForLog(userId: string, min: number, attempts = 20): Promise<void> {
    for (let i = 0; i < attempts; i += 1) {
      const count = await prisma.notificationLog.count({ where: { userId } });
      if (count >= min) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Зарегистрировать тестовый FCM-токен от имени пользователя. */
  const registerToken = (user: TestUser, token: string) =>
    request(app.getHttpServer())
      .post('/notifications/register')
      .set(authHeader(user))
      .send({ platform: 'ios', token });

  it('регистрация FCM-токена идемпотентна (upsert, без дублей)', async () => {
    await registerToken(buyer, 'e2e-fcm-token-buyer-1').expect(201);
    await registerToken(buyer, 'e2e-fcm-token-buyer-1').expect(201);

    const tokens = await prisma.deviceToken.findMany({ where: { userId: buyer.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ platform: 'ios', token: 'e2e-fcm-token-buyer-1' });

    const response = await request(app.getHttpServer())
      .post('/notifications/register')
      .set(authHeader(buyer))
      .send({ platform: 'android', token: '' })
      .expect(400);
    expect(response.body.message).toBe('Ошибка валидации');
  });

  it('токен перепривязывается к новому пользователю при повторной регистрации', async () => {
    await registerToken(buyer, 'e2e-fcm-shared-token').expect(201);
    await registerToken(seller, 'e2e-fcm-shared-token').expect(201);

    const rows = await prisma.deviceToken.findMany({
      where: { token: 'e2e-fcm-shared-token' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(seller.id);
  });

  it('регистрация web push идемпотентна по endpoint', async () => {
    const body = {
      platform: 'web',
      endpoint: 'https://push.example.e2e/sub/123',
      p256dh: 'e2e-p256dh-key-0123456789',
      auth: 'e2e-auth-key',
    } as const;
    await request(app.getHttpServer())
      .post('/notifications/register')
      .set(authHeader(buyer))
      .send(body)
      .expect(201);
    await request(app.getHttpServer())
      .post('/notifications/register')
      .set(authHeader(buyer))
      .send({ ...body, p256dh: 'e2e-p256dh-key-rotated-9876543210' })
      .expect(201);

    const subs = await prisma.webPushSubscription.findMany({
      where: { userId: buyer.id },
    });
    expect(subs).toHaveLength(1);
    expect(subs[0].p256dh).toBe('e2e-p256dh-key-rotated-9876543210');
  });

  it('бронь → counter_offered → покупателю in-app + журнал push', async () => {
    await registerToken(buyer, 'e2e-fcm-token-buyer-2').expect(201);

    const booking = await request(app.getHttpServer())
      .post('/bookings')
      .set(authHeader(buyer))
      .send({ listingId, requestedQuantity: 50 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/bookings/${booking.body.id}/counter-offer`)
      .set(authHeader(seller))
      .send({ offeredQuantity: 40 })
      .expect(201);

    // Push пишется асинхронно после ответа (ADR-031: очередь) — ждём.
    await waitForLog(buyer.id, 1);
    const logs = await prisma.notificationLog.findMany({ where: { userId: buyer.id } });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]).toMatchObject({ channel: 'fcm', status: 'sent', error: null });
    expect(logs[0].title).toBe('Продавец предложил корректировку');

    // In-app уведомление — тот же текст, есть в /notifications/me.
    const mine = await request(app.getHttpServer())
      .get('/notifications/me')
      .set(authHeader(buyer))
      .expect(200);
    expect(mine.body.unreadCount).toBeGreaterThanOrEqual(1);
    expect(
      (mine.body.items as { type: string }[]).some((n) => n.type === 'booking_counter_offered'),
    ).toBe(true);
  });

  it('подтверждение и отмена брони → уведомления получателям', async () => {
    await registerToken(buyer, 'e2e-fcm-token-buyer-3').expect(201);
    await registerToken(seller, 'e2e-fcm-token-seller-3').expect(201);

    const booking = await request(app.getHttpServer())
      .post('/bookings')
      .set(authHeader(buyer))
      .send({ listingId, requestedQuantity: 10 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/bookings/${booking.body.id}/confirm`)
      .set(authHeader(seller))
      .expect(201);

    await waitForLog(buyer.id, 1);
    const buyerLogs = await prisma.notificationLog.findMany({ where: { userId: buyer.id } });
    expect(buyerLogs.some((l) => l.title === 'Бронь подтверждена')).toBe(true);

    // Отмена покупателем → push продавцу.
    const booking2 = await request(app.getHttpServer())
      .post('/bookings')
      .set(authHeader(buyer))
      .send({ listingId, requestedQuantity: 5 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/bookings/${booking2.body.id}/cancel`)
      .set(authHeader(buyer))
      .send({ reason: 'Передумал' })
      .expect(201);

    await waitForLog(seller.id, 1);
    const sellerLogs = await prisma.notificationLog.findMany({ where: { userId: seller.id } });
    expect(sellerLogs.some((l) => l.title === 'Бронь отменена')).toBe(true);
    const sellerNotifications = await prisma.notification.findMany({
      where: { userId: seller.id, type: 'booking_cancelled' },
    });
    expect(sellerNotifications).toHaveLength(1);
    expect(sellerNotifications[0].data).toMatchObject({ bookingId: booking2.body.id });
  });

  it('доставка: assigned и delivered → журналы покупателю', async () => {
    const driver = await registerAndLogin(app, 'driver');
    await registerToken(buyer, 'e2e-fcm-token-buyer-4').expect(201);

    // Гео-точки: линия продавца (владелец — seller) и точка покупателя.
    const pickup = await request(app.getHttpServer())
      .post('/geo/points')
      .set(authHeader(seller))
      .send({ kind: 'seller_line', latitude: 47.22, longitude: 39.7, label: 'Ряд 3' })
      .expect(201);
    const dropoff = await request(app.getHttpServer())
      .post('/geo/points')
      .set(authHeader(buyer))
      .send({ kind: 'buyer_point', latitude: 47.23, longitude: 39.71, label: 'Мой склад' })
      .expect(201);

    const delivery = await request(app.getHttpServer())
      .post('/deliveries')
      .set(authHeader(buyer))
      .send({
        pickupPointId: pickup.body.id,
        dropoffPointId: dropoff.body.id,
        weightKg: '120.5',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/deliveries/${delivery.body.id}/assign`)
      .set(authHeader(driver))
      .expect(201);
    await waitForLog(buyer.id, 1);
    let logs = await prisma.notificationLog.findMany({ where: { userId: buyer.id } });
    expect(logs.some((l) => l.title === 'Водитель взял ваш заказ')).toBe(true);

    await request(app.getHttpServer())
      .post(`/deliveries/${delivery.body.id}/start`)
      .set(authHeader(driver))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/deliveries/${delivery.body.id}/deliver`)
      .set(authHeader(driver))
      .expect(201);

    await waitForLog(buyer.id, 3);
    logs = await prisma.notificationLog.findMany({ where: { userId: buyer.id } });
    const titles = logs.map((l) => l.title);
    expect(titles).toContain('Водитель выехал');
    expect(titles).toContain('Заказ доставлен');
  });

  it('GET /notifications/log — только свои записи', async () => {
    await registerToken(buyer, 'e2e-fcm-token-buyer-5').expect(201);

    const booking = await request(app.getHttpServer())
      .post('/bookings')
      .set(authHeader(buyer))
      .send({ listingId, requestedQuantity: 7 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/bookings/${booking.body.id}/counter-offer`)
      .set(authHeader(seller))
      .send({ offeredQuantity: 6 })
      .expect(201);
    await waitForLog(buyer.id, 1);

    const log = await request(app.getHttpServer())
      .get('/notifications/log')
      .set(authHeader(buyer))
      .expect(200);
    expect(log.body.items.length).toBeGreaterThanOrEqual(1);
    expect(log.body.items[0]).toMatchObject({ channel: 'fcm', status: 'sent' });

    // У продавца нет зарегистрированных устройств → его журнал пуст.
    const sellerLog = await request(app.getHttpServer())
      .get('/notifications/log')
      .set(authHeader(seller))
      .expect(200);
    expect(sellerLog.body.items).toHaveLength(0);
  });

  it('unregister отвязывает токен при logout', async () => {
    await registerToken(buyer, 'e2e-fcm-token-buyer-6').expect(201);

    await request(app.getHttpServer())
      .delete('/notifications/unregister')
      .set(authHeader(buyer))
      .send({ token: 'e2e-fcm-token-buyer-6' })
      .expect(200);

    const tokens = await prisma.deviceToken.findMany({ where: { userId: buyer.id } });
    expect(tokens).toHaveLength(0);

    // Повторный unregister — идемпотентен (200, не 500).
    await request(app.getHttpServer())
      .delete('/notifications/unregister')
      .set(authHeader(buyer))
      .send({ token: 'e2e-fcm-token-buyer-6' })
      .expect(200);
  });

  it('vapid-public: null без настроенных ключей (CI)', async () => {
    const response = await request(app.getHttpServer())
      .get('/notifications/vapid-public')
      .set(authHeader(buyer))
      .expect(200);
    expect(response.body).toEqual({ publicKey: null });
  });

  it('без устройств push не пишется в журнал, in-app работает', async () => {
    const booking = await request(app.getHttpServer())
      .post('/bookings')
      .set(authHeader(buyer))
      .send({ listingId, requestedQuantity: 3 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/bookings/${booking.body.id}/confirm`)
      .set(authHeader(seller))
      .expect(201);

    // In-app уведомление есть.
    const mine = await request(app.getHttpServer())
      .get('/notifications/me')
      .set(authHeader(buyer))
      .expect(200);
    expect(
      (mine.body.items as { type: string }[]).some((n) => n.type === 'booking_confirmed'),
    ).toBe(true);

    // Журнал push пуст: у покупателя нет зарегистрированных устройств.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const logs = await prisma.notificationLog.findMany({ where: { userId: buyer.id } });
    expect(logs).toHaveLength(0);
  });
});

/** Очистка таблиц в порядке внешних ключей. */
async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.notificationLog.deleteMany();
  await prisma.deviceToken.deleteMany();
  await prisma.webPushSubscription.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.bookingEvent.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.deliveryEvent.deleteMany();
  await prisma.deliveryRequest.deleteMany();
  await prisma.geoPoint.deleteMany();
  await prisma.workSession.deleteMany();
  await prisma.monthlyPairTotal.deleteMany();
  await prisma.blockedPair.deleteMany();
  await prisma.user.deleteMany();
}

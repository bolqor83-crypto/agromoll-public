/**
 * E2E доставки попутчиками (v0.5.0, подэтап C, ADR-015).
 *
 * Требует DATABASE_URL (Postgres + PostGIS) и применённых миграций —
 * запускается в CI (`pnpm --filter @agromoll/api test:e2e`).
 *
 * Сценарии: полный цикл create → assign → start → deliver с закрытием
 * WorkSession и обновлением MonthlyPairTotal; блокировка 289-ФЗ при
 * взятии (409, запрос остаётся открытым, событие blocked_by_289fz);
 * TTL-истечение; идемпотентность двойного assign; гео-интеграция —
 * водитель с коридором видит только попутные; роли; приватность
 * QR-кодов; правила отмены.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DeliveriesService } from '../src/deliveries/deliveries.service';
import { authHeader, registerAndLogin } from './auth.helper';
import type { TestUser } from './auth.helper';

/** Опорная точка: Центральный рынок Ростова-на-Дону. */
const MARKET = { lat: 47.2224, lng: 39.7138 };

describe('Delivery rideshare (e2e, HTTP + PostGIS)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let deliveriesService: DeliveriesService;

  let buyer: TestUser;
  let seller: TestUser;
  let driver: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    deliveriesService = app.get(DeliveriesService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    buyer = await registerAndLogin(app, 'buyer');
    seller = await registerAndLogin(app, 'seller');
    driver = await registerAndLogin(app, 'driver');
    outsider = await registerAndLogin(app, 'driver');
  });

  const post = (user: TestUser, url: string) =>
    request(app.getHttpServer()).post(url).set(authHeader(user));

  const get = (user: TestUser, url: string) =>
    request(app.getHttpServer()).get(url).set(authHeader(user));

  /** Создать геозоны сторон: линия продавца + точка покупателя. */
  async function makePoints(): Promise<{ pickupPointId: string; dropoffPointId: string }> {
    const pickup = await post(seller, '/geo/points')
      .send({ kind: 'seller_line', latitude: MARKET.lat, longitude: MARKET.lng, label: 'Линия 5' })
      .expect(201);
    const dropoff = await post(buyer, '/geo/points')
      .send({
        kind: 'buyer_point',
        latitude: MARKET.lat + 0.01,
        longitude: MARKET.lng + 0.01,
        label: 'Мой ларёк',
      })
      .expect(201);
    return { pickupPointId: pickup.body.id as string, dropoffPointId: dropoff.body.id as string };
  }

  /** Создать запрос доставки от покупателя. */
  async function makeDelivery(): Promise<string> {
    const points = await makePoints();
    const created = await post(buyer, '/deliveries')
      .send({ ...points, weightKg: 250.5, description: 'Томаты в ящиках' })
      .expect(201);
    return created.body.id as string;
  }

  it('полный цикл: create → assign → start → deliver; смена закрыта, часы в MonthlyPairTotal', async () => {
    const deliveryId = await makeDelivery();

    // Радар водителя видит заказ (коридора нет — все открытые).
    const radar = await get(driver, '/deliveries/open').expect(200);
    expect(radar.body).toHaveLength(1);
    expect(radar.body[0].id).toBe(deliveryId);
    expect(radar.body[0].pickup.ownerId).toBe(seller.id);
    expect(radar.body[0].corridorDistanceMeters).toBeNull();

    // Взял: assigned + WorkSession пары создана.
    const assigned = await post(driver, `/deliveries/${deliveryId}/assign`).send({}).expect(201);
    expect(assigned.body.status).toBe('assigned');
    expect(assigned.body.assignedDriverId).toBe(driver.id);
    // QR-коды теперь видны водителю (он сторона).
    expect(assigned.body.pickupCode).toBeTruthy();
    expect(assigned.body.dropoffCode).toBeTruthy();

    const session = await prisma.workSession.findFirstOrThrow({
      where: { driverId: driver.id, sellerId: seller.id, endedAt: null },
    });
    expect(session).toBeTruthy();

    // Выехал.
    const started = await post(driver, `/deliveries/${deliveryId}/start`).send({}).expect(201);
    expect(started.body.status).toBe('in_transit');

    // Передал: смена закрылась, часы учтены (минимум минута, ADR-011).
    const delivered = await post(driver, `/deliveries/${deliveryId}/deliver`).send({}).expect(201);
    expect(delivered.body.status).toBe('delivered');
    expect(delivered.body.deliveredAt).toBeTruthy();

    const closed = await prisma.workSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(closed.endedAt).not.toBeNull();
    expect(closed.durationMinutes).toBeGreaterThanOrEqual(1);

    const total = await prisma.monthlyPairTotal.findUnique({
      where: {
        driverId_sellerId_month: {
          driverId: driver.id,
          sellerId: seller.id,
          month: closed.month,
        },
      },
    });
    expect(total?.totalMinutes).toBeGreaterThanOrEqual(1);

    // Повторное завершение → 409 (терминальный статус).
    await post(driver, `/deliveries/${deliveryId}/deliver`).send({}).expect(409);
  });

  it('289-ФЗ: заблокированная пара не может взять заказ — 409, запрос остаётся открытым', async () => {
    const deliveryId = await makeDelivery();
    await prisma.blockedPair.create({
      data: { driverId: driver.id, sellerId: seller.id, reason: '289-ФЗ: серия закрыта' },
    });

    const blocked = await post(driver, `/deliveries/${deliveryId}/assign`).send({}).expect(409);
    expect(blocked.body.code).toBe('DELIVERY_PAIR_BLOCKED');
    expect(blocked.body.message).toContain('пауза');

    // Заказ жив и доступен другому водителю.
    const stillOpen = await prisma.deliveryRequest.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(stillOpen.status).toBe('open');

    const audit = await prisma.deliveryEvent.findFirst({
      where: { deliveryId, action: 'blocked_by_289fz' },
    });
    expect(audit?.actorId).toBe(driver.id);

    // Другой водитель берёт успешно.
    await post(outsider, `/deliveries/${deliveryId}/assign`).send({}).expect(201);
  });

  it('идемпотентность: двойной assign с одним ключом — один результат', async () => {
    const deliveryId = await makeDelivery();
    const key = 'ddddddd4-0000-4000-8000-000000000004';

    const first = await request(app.getHttpServer())
      .post(`/deliveries/${deliveryId}/assign`)
      .set(authHeader(driver))
      .set('X-Idempotency-Key', key)
      .send({})
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/deliveries/${deliveryId}/assign`)
      .set(authHeader(driver))
      .set('X-Idempotency-Key', key)
      .send({})
      .expect(201);

    expect(second.body).toEqual(first.body);
    const sessions = await prisma.workSession.findMany({ where: { driverId: driver.id } });
    expect(sessions).toHaveLength(1);
  });

  it('второй водитель не может взять занятый заказ → 409', async () => {
    const deliveryId = await makeDelivery();
    await post(driver, `/deliveries/${deliveryId}/assign`).send({}).expect(201);
    await post(outsider, `/deliveries/${deliveryId}/assign`).send({}).expect(409);
  });

  it('TTL: просроченный open гасится кроном в expired', async () => {
    const deliveryId = await makeDelivery();
    await prisma.deliveryRequest.update({
      where: { id: deliveryId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const expired = await deliveriesService.expireStale();
    expect(expired).toBe(1);

    const request_ = await prisma.deliveryRequest.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(request_.status).toBe('expired');
    const events = await prisma.deliveryEvent.findMany({
      where: { deliveryId, action: 'expired' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBeNull();
  });

  it('гео-интеграция: водитель с коридором видит только попутные заказы', async () => {
    // Коридор водителя: рынок → 1.1 км на восток.
    await post(driver, '/geo/corridors')
      .send({
        corridorFrom: { lat: MARKET.lat, lng: MARKET.lng },
        corridorTo: { lat: MARKET.lat, lng: MARKET.lng + 0.015 },
      })
      .expect(201);

    // Попутный заказ: забор на рынке (на линии).
    const near = await makeDelivery();

    // НЕпопутный: обе точки в 5 км севернее.
    const farPickup = await post(seller, '/geo/points')
      .send({ kind: 'seller_line', latitude: MARKET.lat + 0.045, longitude: MARKET.lng })
      .expect(201);
    const farDropoff = await post(buyer, '/geo/points')
      .send({ kind: 'buyer_point', latitude: MARKET.lat + 0.05, longitude: MARKET.lng })
      .expect(201);
    await post(buyer, '/deliveries')
      .send({
        pickupPointId: farPickup.body.id,
        dropoffPointId: farDropoff.body.id,
        weightKg: 100,
      })
      .expect(201);

    const radar = await get(driver, '/deliveries/open').expect(200);
    expect(radar.body).toHaveLength(1);
    expect(radar.body[0].id).toBe(near);
    expect(radar.body[0].corridorDistanceMeters).toBeLessThan(100);
  });

  it('роли: покупатель не берёт заказы (403), водитель не создаёт (403)', async () => {
    const deliveryId = await makeDelivery();
    await post(buyer, `/deliveries/${deliveryId}/assign`).send({}).expect(403);
    await get(buyer, '/deliveries/open').expect(403);

    const points = await makePoints();
    await post(driver, '/deliveries').send({ ...points, weightKg: 10 }).expect(403);
  });

  it('QR-коды скрыты от чужих, видны сторонам', async () => {
    const deliveryId = await makeDelivery();

    const radar = await get(outsider, '/deliveries/open').expect(200);
    expect(radar.body[0].pickupCode).toBeNull();

    const mine = await get(buyer, '/deliveries/me').expect(200);
    expect(mine.body[0].pickupCode).toBeTruthy();

    await post(driver, `/deliveries/${deliveryId}/assign`).send({}).expect(201);
    const driverMine = await get(driver, '/deliveries/me').expect(200);
    expect(driverMine.body[0].pickupCode).toBeTruthy();
  });

  it('отмены: open — покупателем; in_transit — только водитель с причиной', async () => {
    const deliveryId = await makeDelivery();

    // Open: покупатель отменяет свободно.
    const cancelled = await post(buyer, `/deliveries/${deliveryId}/cancel`).send({}).expect(201);
    expect(cancelled.body.status).toBe('cancelled');

    // Новая доставка до in_transit: покупатель может отменить тоже.
    const deliveryId2 = await makeDelivery();
    await post(driver, `/deliveries/${deliveryId2}/assign`).send({}).expect(201);
    const cancelled2 = await post(buyer, `/deliveries/${deliveryId2}/cancel`).send({}).expect(201);
    expect(cancelled2.body.status).toBe('cancelled');

    // in_transit: покупатель НЕ может, водитель — только с причиной.
    const deliveryId3 = await makeDelivery();
    await post(driver, `/deliveries/${deliveryId3}/assign`).send({}).expect(201);
    await post(driver, `/deliveries/${deliveryId3}/start`).send({}).expect(201);

    await post(buyer, `/deliveries/${deliveryId3}/cancel`).send({}).expect(403);
    await post(driver, `/deliveries/${deliveryId3}/cancel`).send({}).expect(400);
    const cancelled3 = await post(driver, `/deliveries/${deliveryId3}/cancel`)
      .send({ reason: 'сломалась машина' })
      .expect(201);
    expect(cancelled3.body.status).toBe('cancelled');

    // Смена пары закрыта при отмене взятого заказа.
    const open = await prisma.workSession.findFirst({
      where: { driverId: driver.id, endedAt: null },
    });
    expect(open).toBeNull();
  });

  it('валидация: вес 0 и > 20000 → 400; чужая точка-геозона несуществующая → 400', async () => {
    const points = await makePoints();
    await post(buyer, '/deliveries').send({ ...points, weightKg: 0 }).expect(400);
    await post(buyer, '/deliveries').send({ ...points, weightKg: 50000 }).expect(400);
    await post(buyer, '/deliveries')
      .send({
        pickupPointId: '00000000-0000-4000-8000-00000000dead',
        dropoffPointId: points.dropoffPointId,
        weightKg: 10,
      })
      .expect(400);
  });

  it('без авторизации → 401', async () => {
    await request(app.getHttpServer()).get('/deliveries/open').expect(401);
  });
});

async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.deliveryEvent.deleteMany();
  await prisma.deliveryRequest.deleteMany();
  await prisma.geoPoint.deleteMany();
  await prisma.reputationEvent.deleteMany();
  await prisma.reputationSnapshot.deleteMany();
  await prisma.workSession.deleteMany();
  await prisma.monthlyPairTotal.deleteMany();
  await prisma.blockedPair.deleteMany();
  await prisma.debtEvent.deleteMany();
  await prisma.debt.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.outboxOperation.deleteMany();
  await prisma.bookingEvent.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}

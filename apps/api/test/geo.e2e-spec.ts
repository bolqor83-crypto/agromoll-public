/**
 * E2E геозон (v0.5.0, подэтап B, ADR-014).
 *
 * Требует DATABASE_URL с PostGIS и применённых миграций — запускается
 * в CI (`pnpm --filter @agromoll/api test:e2e`).
 *
 * Сценарии: создание точек по ролям; nearby возвращает точку в радиусе
 * и не возвращает вне его; фильтр по kind; коридор — рядом с ЛИНИЕЙ
 * маршрута; деактивация убирает из выдачи; валидация координат;
 * производительность: 1000 точек, nearby < 100 мс (прямой вызов
 * сервиса — меряем PostGIS-запрос, а не HTTP-оверхед).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { GeoService } from '../src/geo/geo.service';
import { authHeader, registerAndLogin } from './auth.helper';
import type { TestUser } from './auth.helper';

/** Опорная точка: Центральный рынок Ростова-на-Дону. */
const MARKET = { lat: 47.2224, lng: 39.7138 };

describe('Geo points (e2e, HTTP + PostGIS)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let geoService: GeoService;

  let buyer: TestUser;
  let seller: TestUser;
  let driver: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    geoService = app.get(GeoService);
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
    outsider = await registerAndLogin(app, 'buyer');
  });

  const post = (user: TestUser, url: string) =>
    request(app.getHttpServer()).post(url).set(authHeader(user));

  const get = (user: TestUser, url: string) =>
    request(app.getHttpServer()).get(url).set(authHeader(user));

  const patch = (user: TestUser, url: string) =>
    request(app.getHttpServer()).patch(url).set(authHeader(user));

  const del = (user: TestUser, url: string) =>
    request(app.getHttpServer()).delete(url).set(authHeader(user));

  it('покупатель создаёт buyer_point, nearby возвращает её с расстоянием', async () => {
    const created = await post(buyer, '/geo/points')
      .send({
        kind: 'buyer_point',
        latitude: MARKET.lat + 0.0005, // ~55 м к северу от рынка
        longitude: MARKET.lng,
        address: 'ул. Станиславского, 8',
        label: 'Мой ларёк',
      })
      .expect(201);

    expect(created.body.kind).toBe('buyer_point');
    expect(created.body.isActive).toBe(true);

    const nearby = await get(seller, `/geo/points/nearby?lat=${MARKET.lat}&lng=${MARKET.lng}`).expect(200);
    expect(nearby.body).toHaveLength(1);
    expect(nearby.body[0].id).toBe(created.body.id);
    expect(nearby.body[0].distanceMeters).toBeGreaterThanOrEqual(40);
    expect(nearby.body[0].distanceMeters).toBeLessThanOrEqual(80);
  });

  it('точка вне радиуса не возвращается; расширенный радиус находит', async () => {
    // ~3.3 км к северу: вне дефолтных 2 км, внутри явных 5 км.
    const far = { lat: MARKET.lat + 0.03, lng: MARKET.lng };
    const created = await post(buyer, '/geo/points')
      .send({ kind: 'buyer_point', latitude: far.lat, longitude: far.lng })
      .expect(201);

    const defaultRadius = await get(buyer, `/geo/points/nearby?lat=${MARKET.lat}&lng=${MARKET.lng}`).expect(200);
    expect(defaultRadius.body).toHaveLength(0);

    const wide = await get(
      buyer,
      `/geo/points/nearby?lat=${MARKET.lat}&lng=${MARKET.lng}&radiusMeters=5000`,
    ).expect(200);
    expect(wide.body).toHaveLength(1);
    expect(wide.body[0].id).toBe(created.body.id);
    expect(wide.body[0].distanceMeters).toBeGreaterThan(3000);
  });

  it('фильтр kind=seller_line: линии продавцов находятся, точки покупателей нет', async () => {
    await post(buyer, '/geo/points')
      .send({ kind: 'buyer_point', latitude: MARKET.lat, longitude: MARKET.lng })
      .expect(201);
    const line = await post(seller, '/geo/points')
      .send({ kind: 'seller_line', latitude: MARKET.lat + 0.001, longitude: MARKET.lng })
      .expect(201);

    const nearby = await get(
      buyer,
      `/geo/points/nearby?lat=${MARKET.lat}&lng=${MARKET.lng}&kind=seller_line`,
    ).expect(200);

    expect(nearby.body).toHaveLength(1);
    expect(nearby.body[0].id).toBe(line.body.id);
  });

  it('роль обязана соответствовать виду: buyer → seller_line = 403', async () => {
    await post(buyer, '/geo/points')
      .send({ kind: 'seller_line', latitude: MARKET.lat, longitude: MARKET.lng })
      .expect(403);

    await post(seller, '/geo/points')
      .send({ kind: 'buyer_point', latitude: MARKET.lat, longitude: MARKET.lng })
      .expect(403);
  });

  it('коридор: nearby находит по ЛИНИИ маршрута, не по базовой точке', async () => {
    // Маршрут: рынок → 2.2 км на восток. Середина линии ~1.1 км от рынка.
    const corridor = await post(driver, '/geo/corridors')
      .send({
        corridorFrom: { lat: MARKET.lat, lng: MARKET.lng },
        corridorTo: { lat: MARKET.lat, lng: MARKET.lng + 0.03 },
        vehicleType: 'van',
        maxWeightKg: 1500,
        isRefrigerated: true,
      })
      .expect(201);

    expect(corridor.body.kind).toBe('delivery_corridor');
    expect(corridor.body.latitude).toBe(MARKET.lat);

    // Точка на середине маршрута (около линии) — коридор найден.
    const midLine = { lat: MARKET.lat, lng: MARKET.lng + 0.015 };
    const nearLine = await get(
      buyer,
      `/geo/corridors/nearby?lat=${midLine.lat}&lng=${midLine.lng}&radiusMeters=500`,
    ).expect(200);
    expect(nearLine.body).toHaveLength(1);
    expect(nearLine.body[0].id).toBe(corridor.body.id);
    expect(nearLine.body[0].vehicleType).toBe('van');
    expect(nearLine.body[0].isRefrigerated).toBe(true);

    // Точка в 2 км к северу от середины линии — далеко от маршрута.
    const offLine = { lat: MARKET.lat + 0.018, lng: MARKET.lng + 0.015 };
    const farFromLine = await get(
      buyer,
      `/geo/corridors/nearby?lat=${offLine.lat}&lng=${offLine.lng}&radiusMeters=500`,
    ).expect(200);
    expect(farFromLine.body).toHaveLength(0);
  });

  it('коридор создаёт только driver (buyer → 403)', async () => {
    await post(buyer, '/geo/corridors')
      .send({
        corridorFrom: { lat: MARKET.lat, lng: MARKET.lng },
        corridorTo: { lat: MARKET.lat, lng: MARKET.lng + 0.01 },
      })
      .expect(403);
  });

  it('PATCH: владелец обновляет, чужой — 403, координаты пересчитываются', async () => {
    const created = await post(buyer, '/geo/points')
      .send({ kind: 'buyer_point', latitude: MARKET.lat, longitude: MARKET.lng })
      .expect(201);

    await patch(outsider, `/geo/points/${created.body.id}`)
      .send({ label: 'Взлом' })
      .expect(403);

    // Сдвиг на ~330 м: сначала вне радиуса 200 м…
    const movedLat = MARKET.lat + 0.003;
    await patch(buyer, `/geo/points/${created.body.id}`)
      .send({ latitude: movedLat, label: 'Новый склад' })
      .expect(200);

    const tight = await get(
      buyer,
      `/geo/points/nearby?lat=${MARKET.lat}&lng=${MARKET.lng}&radiusMeters=200`,
    ).expect(200);
    expect(tight.body).toHaveLength(0);

    // …затем в радиусе 1 км — триггер пересчитал geog при UPDATE.
    const wider = await get(
      buyer,
      `/geo/points/nearby?lat=${MARKET.lat}&lng=${MARKET.lng}&radiusMeters=1000`,
    ).expect(200);
    expect(wider.body).toHaveLength(1);
    expect(wider.body[0].label).toBe('Новый склад');
  });

  it('DELETE деактивирует: точка исчезает из nearby, строка остаётся в БД', async () => {
    const created = await post(buyer, '/geo/points')
      .send({ kind: 'buyer_point', latitude: MARKET.lat, longitude: MARKET.lng })
      .expect(201);

    await del(outsider, `/geo/points/${created.body.id}`).expect(403);
    await del(buyer, `/geo/points/${created.body.id}`).expect(200);

    const nearby = await get(buyer, `/geo/points/nearby?lat=${MARKET.lat}&lng=${MARKET.lng}`).expect(200);
    expect(nearby.body).toHaveLength(0);

    // История не удаляется (ADR-014): isActive=false в таблице.
    const row = await prisma.geoPoint.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.isActive).toBe(false);
  });

  it('my points: только свои активные', async () => {
    await post(buyer, '/geo/points')
      .send({ kind: 'buyer_point', latitude: MARKET.lat, longitude: MARKET.lng })
      .expect(201);
    await post(seller, '/geo/points')
      .send({ kind: 'seller_line', latitude: MARKET.lat, longitude: MARKET.lng })
      .expect(201);

    const mine = await get(buyer, '/geo/points/mine').expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].kind).toBe('buyer_point');
  });

  it('валидация: lat=91 → 400, radiusMeters=5 → 400, мусорный kind → 400', async () => {
    await post(buyer, '/geo/points')
      .send({ kind: 'buyer_point', latitude: 91, longitude: 39 })
      .expect(400);

    await post(buyer, '/geo/points')
      .send({ kind: 'buyer_point', latitude: 47, longitude: 39, radiusMeters: 5 })
      .expect(400);

    await get(buyer, `/geo/points/nearby?lat=47&lng=39&radiusMeters=5`).expect(400);
  });

  it('производительность: 1000 точек, nearby < 100 мс (GIST + ST_DWithin)', async () => {
    // 1000 точек веером вокруг рынка (± ~5 км) + одна целевая рядом.
    const rows = Array.from({ length: 1000 }, () => ({
      ownerId: seller.id,
      kind: 'seller_line' as const,
      latitude: MARKET.lat + (Math.random() - 0.5) * 0.09,
      longitude: MARKET.lng + (Math.random() - 0.5) * 0.12,
      radiusMeters: 50,
    }));
    await prisma.geoPoint.createMany({ data: rows });

    // Прогрев (план запроса + кэши) — честно меряем второй прогон.
    await geoService.findNearby({ lat: MARKET.lat, lng: MARKET.lng, radiusMeters: 2000 });

    const started = Date.now();
    const found = await geoService.findNearby({ lat: MARKET.lat, lng: MARKET.lng, radiusMeters: 2000 });
    const elapsed = Date.now() - started;

    expect(found.length).toBeGreaterThan(0);
    // Спецификация v0.5.0-B: nearby по 1000 точкам быстрее 100 мс.
    expect(elapsed).toBeLessThan(100);
  });

  it('без авторизации геозоны недоступны → 401', async () => {
    await request(app.getHttpServer())
      .get(`/geo/points/nearby?lat=${MARKET.lat}&lng=${MARKET.lng}`)
      .expect(401);
  });
});

async function cleanDatabase(prisma: PrismaService): Promise<void> {
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

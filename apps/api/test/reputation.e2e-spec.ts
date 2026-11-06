/**
 * E2E публичного рейтинга (v0.5.0, подэтап A, ADR-013).
 *
 * Требует DATABASE_URL и применённых миграций — запускается в CI
 * (`pnpm --filter @agromoll/api test:e2e`).
 *
 * Сценарии: серия сделок → score; спор → score падает; авто-подтверждение
 * весит меньше явного; анти-накрутка (>10 сделок пары → вес 0.3);
 * score=null при малом числе сделок (+reason); /reputation/me с журналом
 * и dealsToRating; листинг несёт рейтинг продавца; долги двигают рейтинг.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BookingsService } from '../src/bookings/bookings.service';
import { authHeader, registerAndLogin } from './auth.helper';
import type { TestUser } from './auth.helper';

describe('Public reputation (e2e, HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let bookingsService: BookingsService;

  let seller: TestUser;
  let buyer: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    bookingsService = app.get(BookingsService);
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
    outsider = await registerAndLogin(app, 'driver');
  });

  const post = (user: TestUser, url: string) =>
    request(app.getHttpServer()).post(url).set(authHeader(user));

  const get = (user: TestUser, url: string) =>
    request(app.getHttpServer()).get(url).set(authHeader(user));

  /** Полный цикл до завершённой сделки: листинг → бронь → confirm → приёмка ok. */
  async function makeCompletedDeal(): Promise<void> {
    const listing = await post(seller, '/listings')
      .send({
        title: 'Помидоры розовые',
        category: 'vegetables',
        unit: 'kg',
        pricePerUnit: 85.5,
        quantityAvailable: 1000,
      })
      .expect(201);
    const booking = await post(buyer, '/bookings')
      .send({ listingId: listing.body.id, requestedQuantity: 20 })
      .expect(201);
    await post(seller, `/bookings/${booking.body.id}/confirm`).send({}).expect(201);
    await post(buyer, `/bookings/${booking.body.id}/confirm-delivery`)
      .send({ receivedQuantity: 20 })
      .expect(201);
  }

  it('серия из 5 сделок → score 5.0 у продавца и покупателя', async () => {
    for (let i = 0; i < 5; i += 1) {
      await makeCompletedDeal();
    }

    const sellerProfile = await get(buyer, `/reputation/${seller.id}`).expect(200);
    expect(sellerProfile.body.score).toBe(5);
    expect(sellerProfile.body.dealsCount).toBe(5);
    expect(sellerProfile.body.reason).toBeUndefined();

    const buyerProfile = await get(seller, `/reputation/${buyer.id}`).expect(200);
    expect(buyerProfile.body.score).toBe(5);
    expect(buyerProfile.body.dealsCount).toBe(5);
  });

  it('меньше RATING_MIN_DEALS сделок → score null + reason', async () => {
    for (let i = 0; i < 4; i += 1) {
      await makeCompletedDeal();
    }
    const response = await get(buyer, `/reputation/${seller.id}`).expect(200);
    expect(response.body.score).toBeNull();
    expect(response.body.reason).toBe('min_deals_not_reached');
    expect(response.body.dealsCount).toBe(4);
  });

  it('спор по качеству → score падает (4 ok + 1 спор = 3.0)', async () => {
    for (let i = 0; i < 4; i += 1) {
      await makeCompletedDeal();
    }

    // Пятая сделка — с серьёзной проблемой качества.
    const listing = await post(seller, '/listings')
      .send({
        title: 'Зелёные томаты',
        category: 'vegetables',
        unit: 'kg',
        pricePerUnit: 60,
        quantityAvailable: 100,
      })
      .expect(201);
    const booking = await post(buyer, '/bookings')
      .send({ listingId: listing.body.id, requestedQuantity: 10 })
      .expect(201);
    await post(seller, `/bookings/${booking.body.id}/confirm`).send({}).expect(201);
    await post(buyer, `/bookings/${booking.body.id}/confirm-delivery`)
      .send({ receivedQuantity: 2, qualityFlag: 'major_issue' })
      .expect(201);

    const response = await get(buyer, `/reputation/${seller.id}`).expect(200);
    expect(response.body.score).toBe(3);
    expect(response.body.disputesCount).toBe(1);
    expect(response.body.dealsCount).toBe(4);
  });

  it('авто-подтверждение весит меньше явного (5 авто → 1.5)', async () => {
    for (let i = 0; i < 5; i += 1) {
      const listing = await post(seller, '/listings')
        .send({
          title: `Партия ${i}`,
          category: 'vegetables',
          unit: 'kg',
          pricePerUnit: 50,
          quantityAvailable: 100,
        })
        .expect(201);
      const booking = await post(buyer, '/bookings')
        .send({ listingId: listing.body.id, requestedQuantity: 5 })
        .expect(201);
      const confirmed = await post(seller, `/bookings/${booking.body.id}/confirm`)
        .send({})
        .expect(201);

      // «Забыл подтвердить»: окно авто-подтверждения истекло.
      await prisma.booking.update({
        where: { id: confirmed.body.id },
        data: { confirmedAt: new Date(Date.now() - 25 * 3_600_000) },
      });
    }
    const closed = await bookingsService.autoConfirmStale();
    expect(closed).toBe(5);

    const response = await get(buyer, `/reputation/${seller.id}`).expect(200);
    expect(response.body.score).toBe(1.5);
    expect(response.body.autoConfirmedCount).toBe(5);
  });

  it('анти-накрутка: 11 сделок одной пары за 30 дней → вес 0.3, score 1.5', async () => {
    for (let i = 0; i < 11; i += 1) {
      await makeCompletedDeal();
    }

    const response = await get(buyer, `/reputation/${seller.id}`).expect(200);
    // pos = 11 × 0.3 = 3.3, total = 11 → 5 × 3.3 / 11 = 1.5
    expect(response.body.score).toBe(1.5);
    expect(response.body.dealsCount).toBe(11);
  });

  it('/reputation/me: журнал событий + подсказка «ещё N сделок»', async () => {
    for (let i = 0; i < 2; i += 1) {
      await makeCompletedDeal();
    }

    const response = await get(seller, '/reputation/me').expect(200);
    expect(response.body.score).toBeNull();
    expect(response.body.reason).toBe('min_deals_not_reached');
    expect(response.body.dealsToRating).toBe(3);
    expect(response.body.events.length).toBeGreaterThanOrEqual(2);
    expect(response.body.events[0].action).toBe('deal_confirmed');
  });

  it('листинг несёт рейтинг продавца для бейджа', async () => {
    for (let i = 0; i < 5; i += 1) {
      await makeCompletedDeal();
    }
    const listings = await get(buyer, '/listings').expect(200);
    expect(listings.body.length).toBeGreaterThan(0);
    expect(listings.body[0].sellerRating).toEqual({ score: 5, dealsCount: 5 });
  });

  it('долги двигают рейтинг дебитора: settled приближает к порогу', async () => {
    for (let i = 0; i < 3; i += 1) {
      await makeCompletedDeal();
    }

    // Продавец отпустил покупателю в долг; покупатель погасил.
    const debt = await post(seller, '/debts')
      .send({
        debtorId: buyer.id,
        amount: 1500,
        description: 'Партия томатов в долг',
      })
      .expect(201);
    await post(buyer, `/debts/${debt.body.id}/settle`).send({}).expect(201);

    // 3 сделки (3.0) + 1 погашенный долг (1.0) = 4 < 5 → всё ещё null,
    // но вес учтён: сделки 4 → осталась 1.
    const response = await get(seller, `/reputation/${buyer.id}`).expect(200);
    expect(response.body.score).toBeNull();
    expect(response.body.dealsCount).toBe(3);

    const mine = await get(buyer, '/reputation/me').expect(200);
    expect(mine.body.dealsToRating).toBe(1);
  });

  it('чужой рейтинг недоступен без авторизации → 401', async () => {
    await request(app.getHttpServer()).get(`/reputation/${seller.id}`).expect(401);
  });

  it('несуществующий пользователь → 404', async () => {
    await get(outsider, '/reputation/00000000-0000-4000-8000-00000000dead').expect(404);
  });
});

async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.reputationEvent.deleteMany();
  await prisma.reputationSnapshot.deleteMany();
  await prisma.deliveryEvent.deleteMany();
  await prisma.deliveryRequest.deleteMany();
  await prisma.geoPoint.deleteMany();
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

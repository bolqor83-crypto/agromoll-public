/**
 * E2E подэтапа B (v0.2.0): полный флоу брони по HTTP.
 *
 * Требует DATABASE_URL и применённых миграций — запускается в CI
 * (service-контейнер postgis) командой `pnpm --filter @agromoll/api test:e2e`.
 *
 * Флоу: seller создаёт лот → buyer бронирует (резерв растёт) →
 * seller предлагает корректировку → buyer принимает (резерв перестраивается) →
 * подтверждённая бронь видна обеим сторонам. Плюс запрещённые переходы
 * (403/409), отмена, истечение TTL с возвратом резерва.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BookingsService } from '../src/bookings/bookings.service';

describe('Booking flow (e2e, HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let bookingsService: BookingsService;

  let sellerId: string;
  let buyerId: string;
  let driverId: string;
  let listingId: string;

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
    const seller = await prisma.user.create({
      data: { role: 'seller', displayName: 'ФХ «Донская долина»' },
    });
    const buyer = await prisma.user.create({
      data: { role: 'buyer', displayName: 'Ларёк «У Ашота»' },
    });
    const driver = await prisma.user.create({
      data: { role: 'driver', displayName: 'Газель Next' },
    });
    sellerId = seller.id;
    buyerId = buyer.id;
    driverId = driver.id;
    listingId = '';
  });

  const sellerPost = (url: string) =>
    request(app.getHttpServer()).post(url).set('X-User-Id', sellerId);
  const buyerPost = (url: string) =>
    request(app.getHttpServer()).post(url).set('X-User-Id', buyerId);

  it('полный флоу: создание брони → корректировка → подтверждение', async () => {
    // 1. Продавец выставляет лот
    const created = await sellerPost('/listings')
      .send({
        title: 'Помидоры розовые',
        category: 'vegetables',
        unit: 'kg',
        pricePerUnit: '85.50',
        quantityAvailable: 100,
        lineNumber: 12,
        isPerishable: true,
      })
      .expect(201);
    listingId = created.body.id;
    expect(created.body.status).toBe('active');
    expect(created.body.quantityAvailableForBooking).toBe(100);

    // 2. Покупатель видит лот в ленте
    const feed = await request(app.getHttpServer()).get('/listings').expect(200);
    expect(feed.body).toHaveLength(1);
    expect(feed.body[0]).toMatchObject({ id: listingId, sellerName: 'ФХ «Донская долина»' });

    // 3. Покупатель бронирует 20 кг
    const booking = await buyerPost('/bookings')
      .send({ listingId, requestedQuantity: 20 })
      .expect(201);
    expect(booking.body).toMatchObject({ status: 'requested', requestedQuantity: 20 });
    const bookingId = booking.body.id;

    // резерв вырос
    const afterReserve = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(afterReserve.quantityReserved).toBe(20);

    // 4. Продавец предлагает корректировку: 15 кг после 9:00
    const countered = await sellerPost(`/bookings/${bookingId}/counter-offer`)
      .send({ offeredQuantity: 15, pickupTime: 'после 9:00' })
      .expect(201);
    expect(countered.body).toMatchObject({ status: 'counter_offered' });

    // 5. Покупатель принимает корректировку
    const accepted = await buyerPost(`/bookings/${bookingId}/accept-counter`).send({}).expect(201);
    expect(accepted.body).toMatchObject({ status: 'confirmed', confirmedQuantity: 15 });

    // резерв перестроен: 20 → 15
    const afterAccept = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(afterAccept.quantityReserved).toBe(15);

    // 6. Обе стороны видят бронь в своих списках
    const buyerList = await request(app.getHttpServer())
      .get('/bookings')
      .set('X-User-Id', buyerId)
      .expect(200);
    expect(buyerList.body).toHaveLength(1);
    expect(buyerList.body[0]).toMatchObject({
      id: bookingId,
      status: 'confirmed',
      listingTitle: 'Помидоры розовые',
      listingUnit: 'kg',
    });

    const sellerInbox = await request(app.getHttpServer())
      .get('/bookings')
      .set('X-User-Id', sellerId)
      .expect(200);
    expect(sellerInbox.body).toHaveLength(1);
    expect(sellerInbox.body[0]).toMatchObject({
      id: bookingId,
      buyerName: 'Ларёк «У Ашота»',
    });

    // 7. Журнал: created → counter_offered → accepted_counter
    const events = await prisma.bookingEvent.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual(['created', 'counter_offered', 'accepted_counter']);
  });

  it('подтверждение продавцом без корректировки: requested → confirmed', async () => {
    const listing = await seedListing();
    const booking = await buyerPost('/bookings')
      .send({ listingId: listing.id, requestedQuantity: 10 })
      .expect(201);

    const confirmed = await sellerPost(`/bookings/${booking.body.id}/confirm`).send({}).expect(201);
    expect(confirmed.body).toMatchObject({ status: 'confirmed', confirmedQuantity: 10 });

    // резерв сохраняется у подтверждённой брони
    const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(after.quantityReserved).toBe(10);
  });

  it('запрещённые действия дают 403/409', async () => {
    const listing = await seedListing();

    // buyer не может создать лот
    await buyerPost('/listings')
      .send({
        title: 'Лук',
        category: 'vegetables',
        unit: 'kg',
        pricePerUnit: 10,
        quantityAvailable: 5,
      })
      .expect(403);

    // seller не может создать бронь
    await sellerPost('/bookings').send({ listingId: listing.id, requestedQuantity: 5 }).expect(403);

    // без X-User-Id — 401
    await request(app.getHttpServer())
      .post('/bookings')
      .send({ listingId: listing.id, requestedQuantity: 5 })
      .expect(401);

    const booking = await buyerPost('/bookings')
      .send({ listingId: listing.id, requestedQuantity: 10 })
      .expect(201);
    const bookingId = booking.body.id;

    // buyer не может подтвердить или скорректировать свою бронь
    await buyerPost(`/bookings/${bookingId}/confirm`).send({}).expect(403);
    await buyerPost(`/bookings/${bookingId}/counter-offer`)
      .send({ offeredQuantity: 5 })
      .expect(403);

    // чужой seller не может подтвердить (не владелец лота)
    await request(app.getHttpServer())
      .post(`/bookings/${bookingId}/confirm`)
      .set('X-User-Id', driverId)
      .send({})
      .expect(403);

    // подтверждение из статуса counter_offered напрямую — 409
    await sellerPost(`/bookings/${bookingId}/counter-offer`)
      .send({ offeredQuantity: 8 })
      .expect(201);
    await sellerPost(`/bookings/${bookingId}/confirm`).send({}).expect(409);

    // бронь больше свободного остатка — 409
    await buyerPost('/bookings')
      .send({ listingId: listing.id, requestedQuantity: 999 })
      .expect(409);
  });

  it('отмена покупателем возвращает резерв', async () => {
    const listing = await seedListing();
    const booking = await buyerPost('/bookings')
      .send({ listingId: listing.id, requestedQuantity: 25 })
      .expect(201);

    const cancelled = await buyerPost(`/bookings/${booking.body.id}/cancel`)
      .send({ reason: 'не успел доехать' })
      .expect(201);
    expect(cancelled.body.status).toBe('cancelled');

    const after = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(after.quantityReserved).toBe(0);

    // повторная отмена — 409
    await buyerPost(`/bookings/${booking.body.id}/cancel`).send({}).expect(409);
  });

  it('истечение TTL гасит бронь и возвращает резерв', async () => {
    const listing = await seedListing();
    const booking = await buyerPost('/bookings')
      .send({ listingId: listing.id, requestedQuantity: 30 })
      .expect(201);

    // TTL истёк (короткий TTL эмулируем сдвигом expiresAt в прошлое)
    await prisma.booking.update({
      where: { id: booking.body.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const expired = await bookingsService.expireStale(); // то же, что делает cron каждую минуту
    expect(expired).toBe(1);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.body.id } });
    expect(after.status).toBe('expired');

    const listingAfter = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(listingAfter.quantityReserved).toBe(0);

    // действия над истёкшей бронью отклоняются
    await buyerPost(`/bookings/${booking.body.id}/cancel`).send({}).expect(409);
  });

  it('фильтры ленты: категория и линия', async () => {
    await seedListing(); // овощи, линия 12
    await prisma.listing.create({
      data: {
        sellerId,
        title: 'Яблоки гала',
        category: 'fruits',
        unit: 'kg',
        pricePerUnit: 60,
        quantityAvailable: 50,
        lineNumber: 3,
        status: 'active',
      },
    });
    await prisma.listing.create({
      data: {
        sellerId,
        title: 'Архивный лот',
        category: 'vegetables',
        unit: 'kg',
        pricePerUnit: 10,
        quantityAvailable: 5,
        status: 'archived',
      },
    });

    const all = await request(app.getHttpServer()).get('/listings').expect(200);
    expect(all.body).toHaveLength(2); // архивный не показывается

    const vegetables = await request(app.getHttpServer())
      .get('/listings?category=vegetables')
      .expect(200);
    expect(vegetables.body).toHaveLength(1);
    expect(vegetables.body[0].title).toBe('Помидоры розовые');

    const line = await request(app.getHttpServer()).get('/listings?lineNumber=3').expect(200);
    expect(line.body).toHaveLength(1);
    expect(line.body[0].title).toBe('Яблоки гала');

    const withStatus = await request(app.getHttpServer())
      .get('/listings?status=archived')
      .expect(200);
    expect(withStatus.body).toHaveLength(1);
    expect(withStatus.body[0].title).toBe('Архивный лот');
  });

  it('владелец лота обновляет его, чужой — 403; валидация — 400', async () => {
    const listing = await seedListing();

    await request(app.getHttpServer())
      .patch(`/listings/${listing.id}`)
      .set('X-User-Id', sellerId)
      .send({ pricePerUnit: '90.00' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/listings/${listing.id}`)
      .set('X-User-Id', buyerId)
      .send({ pricePerUnit: '1.00' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/listings/${listing.id}`)
      .set('X-User-Id', sellerId)
      .send({ title: 'x' }) // слишком короткое
      .expect(400);
  });

  it('доставщик видит пустой список броней, а не 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/bookings')
      .set('X-User-Id', driverId)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  /** Быстрый сидинг лота напрямую в БД. */
  async function seedListing() {
    return prisma.listing.create({
      data: {
        sellerId,
        title: 'Помидоры розовые',
        category: 'vegetables',
        unit: 'kg',
        pricePerUnit: 85.5,
        quantityAvailable: 100,
        lineNumber: 12,
        status: 'active',
      },
    });
  }
});

/** Полная очистка таблиц в порядке внешних ключей. */
async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.bookingEvent.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.user.deleteMany();
}

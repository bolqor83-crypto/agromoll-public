/**
 * E2E приёмки confirm-delivery (v0.4.0, подэтап C, ADR-012).
 *
 * Требует DATABASE_URL и применённых миграций — запускается в CI
 * (`pnpm --filter @agromoll/api test:e2e`).
 *
 * Сценарии: полный цикл booking → confirm-delivery → completed
 * (+счётчик продавцу, +уведомление); недостача → автоматический
 * minor_issue; major_issue → disputed + delivery_disputed в журнале +
 * уведомление продавцу + totalDisputes; двойной confirm-delivery → 409;
 * чужой → 403; авто-подтверждение по окну (прямой вызов крона).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BookingsService } from '../src/bookings/bookings.service';
import { authHeader, registerAndLogin } from './auth.helper';
import type { TestUser } from './auth.helper';

describe('Confirm delivery (e2e, HTTP)', () => {
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

  /** Довести флоу до подтверждённой брони: листинг → бронь → confirm. */
  async function makeConfirmedBooking(): Promise<string> {
    const listing = await post(seller, '/listings')
      .send({
        title: 'Помидоры розовые',
        category: 'vegetables',
        unit: 'kg',
        pricePerUnit: 85.5,
        quantityAvailable: 100,
      })
      .expect(201);
    const booking = await post(buyer, '/bookings')
      .send({ listingId: listing.body.id, requestedQuantity: 20 })
      .expect(201);
    await post(seller, `/bookings/${booking.body.id}/confirm`).send({}).expect(201);
    return booking.body.id as string;
  }

  it('полный цикл: подтверждённая бронь → приёмка ok → completed + счётчик + уведомление', async () => {
    const bookingId = await makeConfirmedBooking();

    const confirmed = await post(buyer, `/bookings/${bookingId}/confirm-delivery`)
      .send({ receivedQuantity: 20 })
      .expect(201);
    expect(confirmed.body).toMatchObject({
      status: 'completed',
      qualityFlag: 'ok',
      receivedQuantity: 20,
      deliveryConfirmedAt: expect.any(String),
      confirmedAt: expect.any(String),
    });

    // журнал: delivery_confirmed
    const events = await prisma.bookingEvent.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual(['created', 'confirmed', 'delivery_confirmed']);

    // счётчик продавцу и уведомление
    const sellerProfile = await get(seller, '/users/me').expect(200);
    expect(sellerProfile.body.totalConfirmations).toBe(1);
    const notifications = await get(seller, '/notifications/me').expect(200);
    expect(
      (notifications.body.items as { type: string }[]).some(
        (n) => n.type === 'booking_delivery_confirmed',
      ),
    ).toBe(true);
  });

  it('недостача → completed с автоматическим minor_issue', async () => {
    const bookingId = await makeConfirmedBooking();

    const result = await post(buyer, `/bookings/${bookingId}/confirm-delivery`)
      .send({ receivedQuantity: 15 }) // из 20
      .expect(201);
    expect(result.body).toMatchObject({
      status: 'completed',
      qualityFlag: 'minor_issue',
      receivedQuantity: 15,
    });
  });

  it('major_issue → disputed + журнал + totalDisputes + уведомление продавцу', async () => {
    const bookingId = await makeConfirmedBooking();

    const result = await post(buyer, `/bookings/${bookingId}/confirm-delivery`)
      .send({ receivedQuantity: 20, qualityFlag: 'major_issue', qualityNotes: 'треть ящиков мятая' })
      .expect(201);
    expect(result.body).toMatchObject({
      status: 'disputed',
      qualityFlag: 'major_issue',
      qualityNotes: 'треть ящиков мятая',
    });

    const events = await prisma.bookingEvent.findMany({
      where: { bookingId, action: 'delivery_disputed' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ receivedQuantity: 20, qualityFlag: 'major_issue' });

    const sellerProfile = await get(seller, '/users/me').expect(200);
    expect(sellerProfile.body.totalDisputes).toBe(1);
    expect(sellerProfile.body.totalConfirmations).toBe(0);

    const notifications = await get(seller, '/notifications/me').expect(200);
    expect(
      (notifications.body.items as { type: string }[]).some(
        (n) => n.type === 'booking_delivery_disputed',
      ),
    ).toBe(true);
  });

  it('правила: чужой → 403, дубль → 409, не-confirmed → 409', async () => {
    const bookingId = await makeConfirmedBooking();

    await post(outsider, `/bookings/${bookingId}/confirm-delivery`)
      .send({ receivedQuantity: 20 })
      .expect(403);

    await post(buyer, `/bookings/${bookingId}/confirm-delivery`)
      .send({ receivedQuantity: 20 })
      .expect(201);
    // дубль — терминальный completed, повторная приёмка невозможна
    await post(buyer, `/bookings/${bookingId}/confirm-delivery`)
      .send({ receivedQuantity: 20 })
      .expect(409);
  });

  it('completed терминальный: отмена завершённой брони → 409', async () => {
    const bookingId = await makeConfirmedBooking();
    await post(buyer, `/bookings/${bookingId}/confirm-delivery`)
      .send({ receivedQuantity: 20 })
      .expect(201);

    await post(buyer, `/bookings/${bookingId}/cancel`).send({}).expect(409);
  });

  it('авто-подтверждение: confirmed старше окна → completed + system_auto_confirmed', async () => {
    const bookingId = await makeConfirmedBooking();

    // «Забыл подтвердить»: сдвигаем confirmedAt на 25 часов назад.
    await prisma.booking.update({
      where: { id: bookingId },
      data: { confirmedAt: new Date(Date.now() - 25 * 3_600_000) },
    });

    const confirmed = await bookingsService.autoConfirmStale();
    expect(confirmed).toBe(1);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('completed');
    expect(booking.qualityFlag).toBe('ok');
    expect(booking.receivedQuantity).toBe(20);

    const events = await prisma.bookingEvent.findMany({
      where: { bookingId, action: 'system_auto_confirmed' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBeNull();

    // продавец получил свой счётчик
    const sellerProfile = await get(seller, '/users/me').expect(200);
    expect(sellerProfile.body.totalConfirmations).toBe(1);

    // повторный прогон ничего не закрывает
    expect(await bookingsService.autoConfirmStale()).toBe(0);
  });

  it('идемпотентность: двойной confirm-delivery с одним ключом — один результат', async () => {
    const bookingId = await makeConfirmedBooking();
    const key = 'ccccccc3-0000-4000-8000-000000000003';
    const body = { receivedQuantity: 20 };

    const first = await request(app.getHttpServer())
      .post(`/bookings/${bookingId}/confirm-delivery`)
      .set(authHeader(buyer))
      .set('X-Idempotency-Key', key)
      .send(body)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/bookings/${bookingId}/confirm-delivery`)
      .set(authHeader(buyer))
      .set('X-Idempotency-Key', key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);
    // один delivery_confirmed в журнале
    const events = await prisma.bookingEvent.findMany({
      where: { bookingId, action: 'delivery_confirmed' },
    });
    expect(events).toHaveLength(1);
  });
});

async function cleanDatabase(prisma: PrismaService): Promise<void> {
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

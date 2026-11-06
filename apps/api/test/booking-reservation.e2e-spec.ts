/**
 * E2E подэтапа A (v0.2.0): модель бронирования на реальной БД (Postgres+PostGIS).
 *
 * Требует DATABASE_URL и применённых миграций — запускается в CI
 * (service-контейнер postgis) командой `pnpm --filter @agromoll/api test:e2e`.
 *
 * Сценарий: создание листинга → создание брони → quantityReserved вырос;
 * плюс отмена и гашение по TTL — резерв возвращается.
 */
import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../src/auth/auth.module';
import { BookingsModule } from '../src/bookings/bookings.module';
import { BookingsService } from '../src/bookings/bookings.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Booking reservation (e2e, сервисный уровень)', () => {
  let prisma: PrismaService;
  let bookings: BookingsService;
  let app: INestApplication;

  let buyerId: string;
  let listingId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, BookingsModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    bookings = app.get(BookingsService);
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
    const listing = await prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: 'Помидоры розовые',
        category: 'vegetables',
        unit: 'kg',
        pricePerUnit: 85.5,
        quantityAvailable: 100,
        lineNumber: 12,
        isPerishable: true,
        status: 'active',
      },
    });
    buyerId = buyer.id;
    listingId = listing.id;
  });

  it('создание брони увеличивает quantityReserved листинга', async () => {
    const booking = await bookings.create({
      listingId,
      buyerId,
      requestedQuantity: 10,
    });

    expect(booking.status).toBe('requested');
    expect(booking.requestedQuantity).toBe(10);

    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.quantityReserved).toBe(10);
    expect(listing.quantityAvailable).toBe(100); // доступное не меняется

    const events = await prisma.bookingEvent.findMany({ where: { bookingId: booking.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'created', actorId: buyerId });
  });

  it('не даёт зарезервировать больше свободного остатка', async () => {
    await bookings.create({ listingId, buyerId, requestedQuantity: 60 });

    await expect(
      bookings.create({ listingId, buyerId, requestedQuantity: 50 }),
    ).rejects.toBeInstanceOf(ConflictException);

    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.quantityReserved).toBe(60); // без ухода в минус

    // а 40 — ровно остаток, проходит
    const second = await bookings.create({ listingId, buyerId, requestedQuantity: 40 });
    const after = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(after.quantityReserved).toBe(100);
    expect(second.status).toBe('requested');
  });

  it('отмена брони возвращает quantityReserved листингу', async () => {
    const booking = await bookings.create({ listingId, buyerId, requestedQuantity: 25 });

    const cancelled = await bookings.cancel({
      bookingId: booking.id,
      actorId: buyerId,
      reason: 'передумал',
    });
    expect(cancelled.status).toBe('cancelled');

    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.quantityReserved).toBe(0);

    const events = await prisma.bookingEvent.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual(['created', 'cancelled']);
  });

  it('истечение TTL гасит бронь и возвращает резерв', async () => {
    const booking = await bookings.create({ listingId, buyerId, requestedQuantity: 30 });

    // Имитируем прошедшее время: TTL вышел.
    await prisma.booking.update({
      where: { id: booking.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const expiredCount = await bookings.expireStale();
    expect(expiredCount).toBe(1);

    const expired = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(expired.status).toBe('expired');

    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.quantityReserved).toBe(0);

    const event = await prisma.bookingEvent.findFirst({
      where: { bookingId: booking.id, action: 'expired' },
    });
    expect(event?.actorId).toBeNull(); // системное действие
  });
});

/** Полная очистка таблиц в порядке внешних ключей. */
async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.bookingEvent.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.deliveryEvent.deleteMany();
  await prisma.deliveryRequest.deleteMany();
  await prisma.geoPoint.deleteMany();
  await prisma.user.deleteMany();
}

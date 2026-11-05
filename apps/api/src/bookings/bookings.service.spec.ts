/**
 * Unit-тесты сервиса брони (мок Prisma).
 *
 * Покрывают подэтап A v0.2.0: создание, отмену, корректировку,
 * истечение TTL — плюс атомарность резерва количества.
 * Запрещённые переходы и роли — дополнительно в подэтапе B.
 */
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Booking, Listing } from '@prisma/client';
import { BOOKING_TTL_MINUTES } from './bookings.constants';
import { BookingsService } from './bookings.service';
import { PrismaService } from '../prisma/prisma.service';

/** Минимальный листинг для тестов. */
function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'listing-1',
    sellerId: 'seller-1',
    title: 'Помидоры розовые',
    category: 'vegetables',
    unit: 'kg',
    pricePerUnit: new PrismaDecimal('85.50'),
    quantityAvailable: 100,
    quantityReserved: 0,
    lineNumber: 12,
    isPerishable: true,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Listing;
}

/** PrismaDecimal — заглушка вместо настоящего Prisma.Decimal (достаточно строки). */
class PrismaDecimal extends String {}

/** Минимальная бронь для тестов. */
function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'booking-1',
    listingId: 'listing-1',
    buyerId: 'buyer-1',
    requestedQuantity: 10,
    confirmedQuantity: null,
    status: 'requested',
    expiresAt: new Date(Date.now() + 30 * 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Booking;
}

/** Бронь + включённый листинг (как в BOOKING_WITH_LISTING_INCLUDE). */
function makeBookingWithListing(booking: Booking, listing: Listing) {
  return {
    ...booking,
    listing: {
      id: listing.id,
      sellerId: listing.sellerId,
      title: listing.title,
      unit: listing.unit,
      status: listing.status,
      quantityAvailable: listing.quantityAvailable,
      quantityReserved: listing.quantityReserved,
    },
  };
}

/**
 * Мок PrismaService: $transaction вызывает колбэк с моком tx,
 * все методы tx настраиваются тестом.
 *
 * prismaMock — для настроек в тестах (jest-типы),
 * prisma — тот же объект, приведённый к PrismaService для DI.
 */
function createPrismaMock() {
  const tx = {
    listing: { findUnique: jest.fn() },
    booking: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    bookingEvent: { create: jest.fn(), findFirst: jest.fn() },
    $executeRaw: jest.fn(),
  };
  const prismaMock = {
    booking: { findMany: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return {
    tx,
    prismaMock,
    prisma: prismaMock as unknown as PrismaService,
  };
}

async function createService(prisma: PrismaService, ttlMinutes = 30): Promise<BookingsService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: BOOKING_TTL_MINUTES, useValue: ttlMinutes },
      BookingsService,
    ],
  }).compile();
  return moduleRef.get(BookingsService);
}

describe('BookingsService (unit)', () => {
  describe('create — создание брони', () => {
    it('резервирует количество, создаёт бронь requested и событие created', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.listing.findUnique.mockResolvedValue(makeListing());
      tx.$executeRaw.mockResolvedValue(1);
      tx.booking.create.mockImplementation(async ({ data }) =>
        makeBooking({ id: 'new-booking', ...data }),
      );

      const service = await createService(prisma);
      const booking = await service.create({
        listingId: 'listing-1',
        buyerId: 'buyer-1',
        requestedQuantity: 10,
      });

      expect(booking.status).toBe('requested');
      expect(booking.requestedQuantity).toBe(10);

      // Резерв: атомарный UPDATE с условием остатка
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      const [sql, ...params] = (tx.$executeRaw as jest.Mock).mock.calls[0] as unknown as [
        TemplateStringsArray,
        ...unknown[],
      ];
      expect(String(sql[0])).toContain('"quantityReserved" = "quantityReserved" +');
      expect(String(sql.join('?'))).toContain('"quantityAvailable" - "quantityReserved" >=');
      expect(params).toEqual([10, 'listing-1', 10]);

      // TTL от ENV по умолчанию (30 минут)
      expect(booking.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000 - 1000);
      expect(booking.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);

      // Событие журнала
      expect(tx.bookingEvent.create).toHaveBeenCalledWith({
        data: {
          bookingId: 'new-booking',
          actorId: 'buyer-1',
          action: 'created',
          payload: { requestedQuantity: 10 },
        },
      });
    });

    it('отклоняет бронь, когда свободного количества не хватает (без ухода в минус)', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.listing.findUnique.mockResolvedValue(
        makeListing({ quantityAvailable: 100, quantityReserved: 95 }),
      );
      tx.$executeRaw.mockResolvedValue(0); // UPDATE не затронул строк — остатка не хватило

      const service = await createService(prisma);
      await expect(
        service.create({ listingId: 'listing-1', buyerId: 'buyer-1', requestedQuantity: 10 }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(tx.booking.create).not.toHaveBeenCalled();
      expect(tx.bookingEvent.create).not.toHaveBeenCalled();
    });

    it('отклоняет бронь неактивного лота', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.listing.findUnique.mockResolvedValue(makeListing({ status: 'paused' }));

      const service = await createService(prisma);
      await expect(
        service.create({ listingId: 'listing-1', buyerId: 'buyer-1', requestedQuantity: 10 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('запрещает продавцу бронировать собственный лот', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.listing.findUnique.mockResolvedValue(makeListing({ sellerId: 'seller-1' }));

      const service = await createService(prisma);
      await expect(
        service.create({ listingId: 'listing-1', buyerId: 'seller-1', requestedQuantity: 10 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404, если лот не найден', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.listing.findUnique.mockResolvedValue(null);

      const service = await createService(prisma);
      await expect(
        service.create({ listingId: 'nope', buyerId: 'buyer-1', requestedQuantity: 10 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('counterOffer — корректировка продавцом', () => {
    it('переводит requested → counter_offered и пишет событие с предложением', async () => {
      const { prisma, tx } = createPrismaMock();
      const booking = makeBooking();
      tx.booking.findUnique.mockResolvedValue(makeBookingWithListing(booking, makeListing()));
      tx.booking.update.mockResolvedValue(makeBooking({ status: 'counter_offered' }));

      const service = await createService(prisma);
      const updated = await service.counterOffer({
        bookingId: 'booking-1',
        actorId: 'seller-1',
        offeredQuantity: 8,
        pickupTime: 'после 9:00',
      });

      expect(updated.status).toBe('counter_offered');
      expect(tx.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'booking-1' },
          data: expect.objectContaining({ status: 'counter_offered' }),
        }),
      );
      expect(tx.bookingEvent.create).toHaveBeenCalledWith({
        data: {
          bookingId: 'booking-1',
          actorId: 'seller-1',
          action: 'counter_offered',
          payload: { offeredQuantity: 8, pickupTime: 'после 9:00' },
        },
      });
    });

    it('продлевает TTL при корректировке', async () => {
      const { prisma, tx } = createPrismaMock();
      const booking = makeBooking({ expiresAt: new Date(Date.now() + 60_000) }); // почти истекла
      tx.booking.findUnique.mockResolvedValue(makeBookingWithListing(booking, makeListing()));
      tx.booking.update.mockResolvedValue(makeBooking({ status: 'counter_offered' }));

      const service = await createService(prisma, 30);
      await service.counterOffer({
        bookingId: 'booking-1',
        actorId: 'seller-1',
        offeredQuantity: 8,
      });

      const updateArg = (tx.booking.update as jest.Mock).mock.calls[0][0];
      expect(updateArg.data.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
    });

    it('403, если корректировку предлагает не продавец лота', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.booking.findUnique.mockResolvedValue(
        makeBookingWithListing(makeBooking(), makeListing({ sellerId: 'seller-1' })),
      );

      const service = await createService(prisma);
      await expect(
        service.counterOffer({ bookingId: 'booking-1', actorId: 'stranger', offeredQuantity: 8 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('acceptCounter — покупатель принимает корректировку', () => {
    it('подтверждает бронь с предложенным количеством и перестраивает резерв', async () => {
      const { prisma, tx } = createPrismaMock();
      const booking = makeBooking({ status: 'counter_offered', requestedQuantity: 10 });
      tx.booking.findUnique.mockResolvedValue(makeBookingWithListing(booking, makeListing()));
      tx.bookingEvent.findFirst.mockResolvedValue({
        payload: { offeredQuantity: 6 },
      });
      tx.$executeRaw.mockResolvedValue(1); // резерв уменьшен на 4
      tx.booking.update.mockResolvedValue(
        makeBooking({ status: 'confirmed', confirmedQuantity: 6 }),
      );

      const service = await createService(prisma);
      const updated = await service.acceptCounter({ bookingId: 'booking-1', actorId: 'buyer-1' });

      expect(updated.status).toBe('confirmed');
      expect(updated.confirmedQuantity).toBe(6);

      // Резерв перестроен: 10 → 6, delta = −4 (в SQL параметр количества идёт первым)
      const params = (tx.$executeRaw as jest.Mock).mock.calls[0].slice(1);
      expect(params).toEqual([-4, 'listing-1', -4]);

      expect(tx.bookingEvent.create).toHaveBeenCalledWith({
        data: {
          bookingId: 'booking-1',
          actorId: 'buyer-1',
          action: 'accepted_counter',
          payload: { confirmedQuantity: 6 },
        },
      });
    });

    it('конфликт, если предложенного количества не хватает в наличии', async () => {
      const { prisma, tx } = createPrismaMock();
      const booking = makeBooking({ status: 'counter_offered', requestedQuantity: 10 });
      tx.booking.findUnique.mockResolvedValue(makeBookingWithListing(booking, makeListing()));
      tx.bookingEvent.findFirst.mockResolvedValue({ payload: { offeredQuantity: 15 } });
      tx.$executeRaw.mockResolvedValue(0); // остатка не хватило

      const service = await createService(prisma);
      await expect(
        service.acceptCounter({ bookingId: 'booking-1', actorId: 'buyer-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.booking.update).not.toHaveBeenCalled();
    });

    it('403, если принимает не покупатель', async () => {
      const { prisma, tx } = createPrismaMock();
      const booking = makeBooking({ status: 'counter_offered', buyerId: 'buyer-1' });
      tx.booking.findUnique.mockResolvedValue(makeBookingWithListing(booking, makeListing()));

      const service = await createService(prisma);
      await expect(
        service.acceptCounter({ bookingId: 'booking-1', actorId: 'seller-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('409, если бронь ещё не в статусе counter_offered', async () => {
      const { prisma, tx } = createPrismaMock();
      const booking = makeBooking({ status: 'requested' });
      tx.booking.findUnique.mockResolvedValue(makeBookingWithListing(booking, makeListing()));

      const service = await createService(prisma);
      await expect(
        service.acceptCounter({ bookingId: 'booking-1', actorId: 'buyer-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('confirm — подтверждение продавцом', () => {
    it('переводит requested → confirmed с confirmedQuantity = запрошенному', async () => {
      const { prisma, tx } = createPrismaMock();
      const booking = makeBooking({ requestedQuantity: 10 });
      tx.booking.findUnique.mockResolvedValue(makeBookingWithListing(booking, makeListing()));
      tx.booking.update.mockResolvedValue(
        makeBooking({ status: 'confirmed', confirmedQuantity: 10 }),
      );

      const service = await createService(prisma);
      const updated = await service.confirm({ bookingId: 'booking-1', actorId: 'seller-1' });

      expect(updated.status).toBe('confirmed');
      expect(updated.confirmedQuantity).toBe(10);
      expect(tx.bookingEvent.create).toHaveBeenCalledWith({
        data: {
          bookingId: 'booking-1',
          actorId: 'seller-1',
          action: 'confirmed',
          payload: { confirmedQuantity: 10 },
        },
      });
    });

    it('409 при подтверждении из статуса counter_offered (сначала решение покупателя)', async () => {
      const { prisma, tx } = createPrismaMock();
      const booking = makeBooking({ status: 'counter_offered' });
      tx.booking.findUnique.mockResolvedValue(makeBookingWithListing(booking, makeListing()));

      const service = await createService(prisma);
      await expect(
        service.confirm({ bookingId: 'booking-1', actorId: 'seller-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('cancel — отмена', () => {
    it('покупатель может отменить requested: резерв возвращается', async () => {
      const { prisma, tx } = createPrismaMock();
      const booking = makeBooking({ requestedQuantity: 10 });
      tx.booking.findUnique.mockResolvedValue(makeBookingWithListing(booking, makeListing()));
      tx.$executeRaw.mockResolvedValue(1);
      tx.booking.update.mockResolvedValue(makeBooking({ status: 'cancelled' }));

      const service = await createService(prisma);
      const updated = await service.cancel({
        bookingId: 'booking-1',
        actorId: 'buyer-1',
        reason: 'не успел доехать',
      });

      expect(updated.status).toBe('cancelled');

      // Резерв возвращён: −10 (количество идёт первым в параметрах SQL)
      const params = (tx.$executeRaw as jest.Mock).mock.calls[0].slice(1);
      expect(params).toEqual([10, 'listing-1', 10]);

      expect(tx.bookingEvent.create).toHaveBeenCalledWith({
        data: {
          bookingId: 'booking-1',
          actorId: 'buyer-1',
          action: 'cancelled',
          payload: { reason: 'не успел доехать' },
        },
      });
    });

    it('продавец лота тоже может отменить', async () => {
      const { prisma, tx } = createPrismaMock();
      const booking = makeBooking();
      tx.booking.findUnique.mockResolvedValue(makeBookingWithListing(booking, makeListing()));
      tx.$executeRaw.mockResolvedValue(1);
      tx.booking.update.mockResolvedValue(makeBooking({ status: 'cancelled' }));

      const service = await createService(prisma);
      await expect(
        service.cancel({ bookingId: 'booking-1', actorId: 'seller-1' }),
      ).resolves.toMatchObject({ status: 'cancelled' });
    });

    it('403 для постороннего пользователя', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.booking.findUnique.mockResolvedValue(makeBookingWithListing(makeBooking(), makeListing()));

      const service = await createService(prisma);
      await expect(
        service.cancel({ bookingId: 'booking-1', actorId: 'stranger' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('409 при отмене уже подтверждённой брони', async () => {
      const { prisma, tx } = createPrismaMock();
      const booking = makeBooking({ status: 'confirmed', confirmedQuantity: 10 });
      tx.booking.findUnique.mockResolvedValue(makeBookingWithListing(booking, makeListing()));

      const service = await createService(prisma);
      await expect(
        service.cancel({ bookingId: 'booking-1', actorId: 'buyer-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('expireStale — истечение TTL', () => {
    it('гасит просроченную бронь, возвращает резерв, пишет событие без актёра', async () => {
      const { prisma, tx, prismaMock } = createPrismaMock();
      const stale = makeBooking({
        id: 'booking-1',
        status: 'requested',
        requestedQuantity: 10,
        expiresAt: new Date(Date.now() - 60_000), // TTL уже истёк — как в проде
      });
      prismaMock.booking.findMany.mockResolvedValue([{ id: 'booking-1' }]);
      tx.booking.findUnique.mockResolvedValue(makeBookingWithListing(stale, makeListing()));
      tx.$executeRaw.mockResolvedValue(1);
      tx.booking.update.mockResolvedValue(makeBooking({ status: 'expired' }));

      const service = await createService(prisma);
      const expired = await service.expireStale();

      expect(expired).toBe(1);
      expect(tx.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'booking-1' }, data: { status: 'expired' } }),
      );
      expect(tx.bookingEvent.create).toHaveBeenCalledWith({
        data: { bookingId: 'booking-1', actorId: null, action: 'expired' },
      });

      // Резерв возвращён (количество идёт первым в параметрах SQL)
      const params = (tx.$executeRaw as jest.Mock).mock.calls[0].slice(1);
      expect(params).toEqual([10, 'listing-1', 10]);
    });

    it('не трогает бронь, которую успели изменить между выборкой и транзакцией', async () => {
      const { prisma, tx, prismaMock } = createPrismaMock();
      prismaMock.booking.findMany.mockResolvedValue([{ id: 'booking-1' }]);
      const confirmed = makeBooking({ status: 'confirmed', confirmedQuantity: 10 });
      tx.booking.findUnique.mockResolvedValue(makeBookingWithListing(confirmed, makeListing()));

      const service = await createService(prisma);
      const expired = await service.expireStale();

      expect(expired).toBe(0);
      expect(tx.booking.update).not.toHaveBeenCalled();
      expect(tx.bookingEvent.create).not.toHaveBeenCalled();
    });

    it('не падает целиком, если одна бронь не гасится', async () => {
      const { prisma, tx, prismaMock } = createPrismaMock();
      prismaMock.booking.findMany.mockResolvedValue([{ id: 'bad' }, { id: 'good' }]);

      const stale = makeBooking({
        id: 'good',
        status: 'requested',
        expiresAt: new Date(Date.now() - 60_000),
      });
      tx.booking.findUnique
        .mockRejectedValueOnce(new Error('db hiccup'))
        .mockResolvedValueOnce(makeBookingWithListing(stale, makeListing()));
      tx.$executeRaw.mockResolvedValue(1);
      tx.booking.update.mockResolvedValue(makeBooking({ status: 'expired' }));

      const service = await createService(prisma);
      await expect(service.expireStale()).resolves.toBe(1);
    });

    it('действия над истёкшей бронью отклоняются до крона', async () => {
      const { prisma, tx } = createPrismaMock();
      const stale = makeBooking({ status: 'requested', expiresAt: new Date(Date.now() - 1000) });
      tx.booking.findUnique.mockResolvedValue(makeBookingWithListing(stale, makeListing()));

      const service = await createService(prisma);
      await expect(
        service.cancel({ bookingId: 'booking-1', actorId: 'buyer-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});

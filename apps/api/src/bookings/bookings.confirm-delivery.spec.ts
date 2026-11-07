/**
 * Unit-тесты приёмки confirmDelivery + авто-подтверждения (v0.4.0-C, ADR-012).
 *
 * Переходы: ok → completed (+счётчик продавцу, уведомление), недостача →
 * completed с minor_issue, major_issue → disputed (+totalDisputes,
 * уведомление продавцу), чужой → 403, не-confirmed → 409, дубль → 409,
 * авто-подтверждение по окну 24 ч (system_auto_confirmed, actor NULL).
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Booking } from '@prisma/client';
import { BookingsService } from './bookings.service';
import {
  BOOKING_AUTO_CONFIRM_HOURS,
  BOOKING_TTL_MINUTES,
} from './bookings.constants';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkHoursService } from '../work-hours/work-hours.service';
import { ReputationService } from '../reputation/reputation.service';
import { DisputesService } from '../disputes/disputes.service';

const BUYER = 'buyer-1';
const SELLER = 'seller-1';

type BookingWithListing = Booking & {
  listing: {
    id: string;
    sellerId: string;
    title: string;
    unit: 'kg';
    status: 'active';
    quantityAvailable: number;
    quantityReserved: number;
  };
};

function makeConfirmedBooking(overrides: Partial<Booking> = {}): BookingWithListing {
  return {
    id: 'booking-1',
    listingId: 'listing-1',
    buyerId: BUYER,
    requestedQuantity: 20,
    confirmedQuantity: 20,
    status: 'confirmed',
    expiresAt: new Date(Date.now() + 60 * 60_000),
    confirmedAt: new Date(Date.now() - 3_600_000),
    deliveryConfirmedAt: null,
    receivedQuantity: null,
    qualityNotes: null,
    qualityFlag: 'ok',
    createdAt: new Date(),
    updatedAt: new Date(),
    listing: {
      id: 'listing-1',
      sellerId: SELLER,
      title: 'Помидоры',
      unit: 'kg',
      status: 'active',
      quantityAvailable: 100,
      quantityReserved: 10,
    },
    ...overrides,
  } as BookingWithListing;
}

function createPrismaMock() {
  const tx = {
    listing: { findUnique: jest.fn() },
    booking: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn(), update: jest.fn() },
    bookingEvent: { create: jest.fn(), findFirst: jest.fn() },
    user: { update: jest.fn() },
    $executeRaw: jest.fn(),
  };
  const prismaMock = {
    booking: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    workSession: { findFirst: jest.fn() },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { tx, prismaMock, prisma: prismaMock as unknown as PrismaService };
}

async function createService(
  prisma: PrismaService,
  notifications: { send: jest.Mock },
  autoConfirmHours = 24,
): Promise<BookingsService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: BOOKING_TTL_MINUTES, useValue: 30 },
      { provide: BOOKING_AUTO_CONFIRM_HOURS, useValue: autoConfirmHours },
      { provide: NotificationsService, useValue: notifications },
      { provide: WorkHoursService, useValue: { endSession: jest.fn() } },
      { provide: ReputationService, useValue: { safeOnBookingDelivery: jest.fn() } },
      {
        provide: DisputesService,
        useValue: {
          assertNoActiveDispute: jest.fn().mockResolvedValue(undefined),
          hasActiveDispute: jest.fn().mockResolvedValue(false),
        },
      },
      BookingsService,
    ],
  }).compile();
  return moduleRef.get(BookingsService);
}

describe('BookingsService.confirmDelivery (unit, v0.4.0-C)', () => {
  let notifications: { send: jest.Mock };

  beforeEach(() => {
    notifications = { send: jest.fn().mockResolvedValue(undefined) };
  });

  it('ok → completed: deliveryConfirmedAt, событие, счётчик и уведомление продавцу', async () => {
    const { prisma, tx, prismaMock } = createPrismaMock();
    tx.booking.findUnique.mockResolvedValue(makeConfirmedBooking());
    tx.booking.update.mockImplementation(async ({ data }) =>
      makeConfirmedBooking({ ...data, status: 'completed' } as Partial<Booking>),
    );
    prismaMock.booking.findUniqueOrThrow.mockResolvedValue({
      listing: { sellerId: SELLER },
    });

    const service = await createService(prisma, notifications);
    const booking = await service.confirmDelivery({
      bookingId: 'booking-1',
      actorId: BUYER,
      receivedQuantity: 20,
      qualityFlag: 'ok',
    });

    expect(booking.status).toBe('completed');
    expect(booking.qualityFlag).toBe('ok');
    expect(tx.bookingEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'delivery_confirmed', actorId: BUYER }),
      }),
    );
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SELLER },
        data: { totalConfirmations: { increment: 1 } },
      }),
    );
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SELLER, type: 'booking_delivery_confirmed' }),
    );
  });

  it('недостача → completed с автоматическим minor_issue', async () => {
    const { prisma, tx, prismaMock } = createPrismaMock();
    tx.booking.findUnique.mockResolvedValue(makeConfirmedBooking());
    tx.booking.update.mockImplementation(async ({ data }) =>
      makeConfirmedBooking({ ...data, status: 'completed' } as Partial<Booking>),
    );
    prismaMock.booking.findUniqueOrThrow.mockResolvedValue({ listing: { sellerId: SELLER } });

    const service = await createService(prisma, notifications);
    const booking = await service.confirmDelivery({
      bookingId: 'booking-1',
      actorId: BUYER,
      receivedQuantity: 15, // получил 15 из 20
      qualityFlag: 'ok', // забыл переключить — сервер поправит
    });

    expect(booking.status).toBe('completed');
    expect(booking.qualityFlag).toBe('minor_issue');
    expect(booking.receivedQuantity).toBe(15);
  });

  it('major_issue → disputed: событие delivery_disputed, totalDisputes, уведомление', async () => {
    const { prisma, tx, prismaMock } = createPrismaMock();
    tx.booking.findUnique.mockResolvedValue(makeConfirmedBooking());
    tx.booking.update.mockImplementation(async ({ data }) =>
      makeConfirmedBooking({ ...data, status: 'disputed' } as Partial<Booking>),
    );
    prismaMock.booking.findUniqueOrThrow.mockResolvedValue({ listing: { sellerId: SELLER } });

    const service = await createService(prisma, notifications);
    const booking = await service.confirmDelivery({
      bookingId: 'booking-1',
      actorId: BUYER,
      receivedQuantity: 20,
      qualityFlag: 'major_issue',
      qualityNotes: 'треть ящиков мятая',
    });

    expect(booking.status).toBe('disputed');
    expect(tx.bookingEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'delivery_disputed' }),
      }),
    );
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SELLER },
        data: { totalDisputes: { increment: 1 } },
      }),
    );
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SELLER, type: 'booking_delivery_disputed' }),
    );
  });

  it('чужой пользователь → 403; не-confirmed → 409', async () => {
    const { prisma, tx } = createPrismaMock();
    tx.booking.findUnique.mockResolvedValue(makeConfirmedBooking());
    const service = await createService(prisma, notifications);

    await expect(
      service.confirmDelivery({ bookingId: 'booking-1', actorId: 'outsider', receivedQuantity: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    tx.booking.findUnique.mockResolvedValue(makeConfirmedBooking({ status: 'requested' }));
    await expect(
      service.confirmDelivery({ bookingId: 'booking-1', actorId: BUYER, receivedQuantity: 20 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('закрывает открытую смену покупателя-водителя у продавца лота', async () => {
    const { prisma, tx, prismaMock } = createPrismaMock();
    tx.booking.findUnique.mockResolvedValue(makeConfirmedBooking());
    tx.booking.update.mockImplementation(async ({ data }) =>
      makeConfirmedBooking({ ...data, status: 'completed' } as Partial<Booking>),
    );
    prismaMock.booking.findUniqueOrThrow.mockResolvedValue({
      buyerId: BUYER,
      listing: { sellerId: SELLER },
    });
    prismaMock.workSession.findFirst.mockResolvedValue({ id: 'ws-1', endedAt: null });

    const workHours = { endSession: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: BOOKING_TTL_MINUTES, useValue: 30 },
        { provide: BOOKING_AUTO_CONFIRM_HOURS, useValue: 24 },
        { provide: NotificationsService, useValue: notifications },
        { provide: WorkHoursService, useValue: workHours },
        { provide: ReputationService, useValue: { safeOnBookingDelivery: jest.fn() } },
        {
          provide: DisputesService,
          useValue: {
            assertNoActiveDispute: jest.fn().mockResolvedValue(undefined),
            hasActiveDispute: jest.fn().mockResolvedValue(false),
          },
        },
        BookingsService,
      ],
    }).compile();
    const service = moduleRef.get(BookingsService);

    await service.confirmDelivery({
      bookingId: 'booking-1',
      actorId: BUYER,
      receivedQuantity: 20,
    });

    expect(workHours.endSession).toHaveBeenCalledWith('ws-1', BUYER);
  });
});

describe('BookingsService.autoConfirmStale (unit, v0.4.0-C)', () => {
  it('confirmed старше окна → completed + system_auto_confirmed + счётчик', async () => {
    const { prisma, tx, prismaMock } = createPrismaMock();
    prismaMock.booking.findMany.mockResolvedValue([{ id: 'booking-1' }]);
    tx.booking.findUnique.mockResolvedValue(
      makeConfirmedBooking({ confirmedAt: new Date(Date.now() - 25 * 3_600_000) }),
    );
    tx.booking.update.mockImplementation(async ({ data }) =>
      makeConfirmedBooking({ ...data, status: 'completed' } as Partial<Booking>),
    );
    tx.booking.findUniqueOrThrow.mockResolvedValue({ listing: { sellerId: SELLER } });

    const notifications = { send: jest.fn() };
    const service = await createService(prisma, notifications, 24);
    const confirmed = await service.autoConfirmStale();

    expect(confirmed).toBe(1);
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'completed', qualityFlag: 'ok' }),
      }),
    );
    expect(tx.bookingEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'system_auto_confirmed', actorId: null }),
      }),
    );
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { totalConfirmations: { increment: 1 } } }),
    );
  });

  it('молодая confirmed-бронь не закрывается', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    prismaMock.booking.findMany.mockResolvedValue([]); // окно ничего не нашло

    const service = await createService(prisma, { send: jest.fn() }, 24);
    expect(await service.autoConfirmStale()).toBe(0);
  });
});

/**
 * Unit-тесты сервиса арбитража (v0.6.0-C, ADR-033) — мок Prisma.
 *
 * Покрывают: открытие спора (стороны, дубликат 409, гонка P2002),
 * видимость служебных заметок, заморозку объектов, решения арбитра
 * и судьбу брони/долга в транзакции решения. Полный HTTP-цикл —
 * в test/disputes.e2e-spec.ts (реальная БД, CI).
 */
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { DisputesService } from './disputes.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReputationService } from '../reputation/reputation.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const BUYER = 'user-buyer';
const SELLER = 'user-seller';
const ARBITRATOR = 'user-arbitrator';

/** Просмотрщик-арбитрator (роль из JWT + БД). */
function viewer(id: string, role: AuthenticatedUser['role']): AuthenticatedUser {
  return { id, role, displayName: 'Тест', phone: '+79990000000' } as AuthenticatedUser;
}

/** Минимальный кейс со связями (как DISPUTE_VIEW_INCLUDE). */
function makeDispute(overrides: Record<string, unknown> = {}) {
  const party = (id: string, role: string) => ({
    id,
    displayName: `Партия ${id}`,
    role,
  });
  return {
    id: 'dispute-1',
    type: 'booking' as const,
    referenceId: 'booking-1',
    subject: 'Бронь: Помидоры',
    status: 'open' as const,
    firstPartyId: BUYER,
    secondPartyId: SELLER,
    openedById: BUYER,
    openedAt: new Date(),
    assignedToId: null,
    assignedAt: null,
    resolution: null,
    resolvedById: null,
    resolvedAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    firstParty: party(BUYER, 'buyer'),
    secondParty: party(SELLER, 'seller'),
    openedBy: party(BUYER, 'buyer'),
    assignedTo: null,
    messages: [],
    evidence: [],
    ...overrides,
  };
}

/** Мок Prisma: $transaction вызывает колбэк с tx (как в bookings spec). */
function createPrismaMock() {
  const tx = {
    disputeCase: { create: jest.fn(), update: jest.fn() },
    booking: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    bookingEvent: { create: jest.fn() },
    debt: { findUnique: jest.fn(), update: jest.fn() },
    debtEvent: { create: jest.fn() },
    deliveryRequest: { findUnique: jest.fn(), update: jest.fn() },
    deliveryEvent: { create: jest.fn() },
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const prismaMock = {
    booking: { findUnique: jest.fn() },
    debt: { findUnique: jest.fn() },
    deliveryRequest: { findUnique: jest.fn() },
    disputeCase: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    disputeMessage: { create: jest.fn() },
    disputeEvidence: { create: jest.fn() },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return {
    tx,
    prismaMock,
    prisma: prismaMock as unknown as PrismaService,
  };
}

async function createService(prisma: PrismaService): Promise<DisputesService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: NotificationsService, useValue: { send: jest.fn().mockResolvedValue(undefined) } },
      {
        provide: ReputationService,
        useValue: {
          safeOnDisputeResolved: jest.fn(),
          safeOnBookingDelivery: jest.fn(),
          safeOnDebtChanged: jest.fn(),
          recalculate: jest.fn(),
        },
      },
      DisputesService,
    ],
  }).compile();
  return moduleRef.get(DisputesService);
}

describe('DisputesService (unit, v0.6.0-C)', () => {
  describe('open — открытие спора', () => {
    it('бронь: стороны из листинга, причина — первое сообщение, оппонент уведомлён', async () => {
      const { prisma, tx, prismaMock } = createPrismaMock();
      prismaMock.booking.findUnique.mockResolvedValue({
        buyerId: BUYER,
        listing: { sellerId: SELLER, title: 'Помидоры' },
      });
      prismaMock.disputeCase.findFirst.mockResolvedValue(null);
      tx.disputeCase.create.mockImplementation(async ({ data }) => ({
        ...makeDispute(),
        id: 'dispute-new',
        ...data,
      }));

      const service = await createService(prisma);
      const dto = await service.open(BUYER, {
        type: 'booking',
        referenceId: 'booking-1',
        reason: 'Привезли помидоры в разбитых ящиках',
      });

      expect(dto.type).toBe('booking');
      expect(dto.status).toBe('open');
      // Стороны зафиксированы: покупатель/продавец листинга
      expect(tx.disputeCase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstPartyId: BUYER,
            secondPartyId: SELLER,
            subject: 'Бронь: Помидоры',
          }),
        }),
      );
      // Причина — первое сообщение переписки
      const createData = tx.disputeCase.create.mock.calls[0][0].data;
      expect(createData.messages.create).toEqual({
        authorId: BUYER,
        body: 'Привезли помидоры в разбитых ящиках',
        isInternal: false,
      });
    });

    it('не-сторона сделки не может открыть спор (403)', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.booking.findUnique.mockResolvedValue({
        buyerId: BUYER,
        listing: { sellerId: SELLER, title: 'Помидоры' },
      });
      const service = await createService(prisma);
      await expect(
        service.open('user-outsider', {
          type: 'booking',
          referenceId: 'booking-1',
          reason: 'Мне просто не нравятся помидоры',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('объект не найден — 404', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.booking.findUnique.mockResolvedValue(null);
      const service = await createService(prisma);
      await expect(
        service.open(BUYER, {
          type: 'booking',
          referenceId: 'booking-404',
          reason: 'Бронь исчезла из списка',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('повторное открытие активного спора — 409', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.booking.findUnique.mockResolvedValue({
        buyerId: BUYER,
        listing: { sellerId: SELLER, title: 'Помидоры' },
      });
      prismaMock.disputeCase.findFirst.mockResolvedValue({ id: 'dispute-existing' });
      const service = await createService(prisma);
      await expect(
        service.open(BUYER, {
          type: 'booking',
          referenceId: 'booking-1',
          reason: 'Хочу открыть второй спор',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('гонка двух открытий ловит unique-индекс: P2002 → 409', async () => {
      const { prisma, tx, prismaMock } = createPrismaMock();
      prismaMock.booking.findUnique.mockResolvedValue({
        buyerId: BUYER,
        listing: { sellerId: SELLER, title: 'Помидоры' },
      });
      prismaMock.disputeCase.findFirst.mockResolvedValue(null);
      tx.disputeCase.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      const service = await createService(prisma);
      await expect(
        service.open(BUYER, {
          type: 'booking',
          referenceId: 'booking-1',
          reason: 'Гонка одновременных открытий',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('доставка без водителя: «продавец» — владелец точки забора', async () => {
      const { prisma, tx, prismaMock } = createPrismaMock();
      prismaMock.deliveryRequest.findUnique.mockResolvedValue({
        buyerId: BUYER,
        assignedDriverId: null,
        pickupPoint: { ownerId: SELLER },
        dropoffPoint: { label: 'Ларёк у Ашота', address: null },
      });
      prismaMock.disputeCase.findFirst.mockResolvedValue(null);
      tx.disputeCase.create.mockResolvedValue(makeDispute({ type: 'delivery' }));

      const service = await createService(prisma);
      await service.open(BUYER, {
        type: 'delivery',
        referenceId: 'delivery-1',
        reason: 'Товар так и не забрали со линии',
      });
      expect(tx.disputeCase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            firstPartyId: BUYER,
            secondPartyId: SELLER,
          }),
        }),
      );
    });
  });

  describe('findOne / postMessage — доступ и заметки', () => {
    it('сторона не видит служебные заметки арбитра', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.disputeCase.findUnique.mockResolvedValue(
        makeDispute({
          status: 'under_review',
          messages: [
            { id: 'm1', author: { id: BUYER, displayName: 'Б', role: 'buyer' }, body: 'Открыл спор', isInternal: false, createdAt: new Date() },
            { id: 'm2', author: { id: ARBITRATOR, displayName: 'А', role: 'arbitrator' }, body: 'Служебная заметка', isInternal: true, createdAt: new Date() },
          ],
        }),
      );
      const service = await createService(prisma);
      const detail = await service.findOne(viewer(BUYER, 'buyer'), 'dispute-1');
      expect(detail.messages).toHaveLength(1);
      expect(detail.messages[0].id).toBe('m1');
    });

    it('арбитр видит служебные заметки', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.disputeCase.findUnique.mockResolvedValue(
        makeDispute({
          status: 'under_review',
          messages: [
            { id: 'm2', author: { id: ARBITRATOR, displayName: 'А', role: 'arbitrator' }, body: 'Служебная заметка', isInternal: true, createdAt: new Date() },
          ],
        }),
      );
      const service = await createService(prisma);
      const detail = await service.findOne(viewer(ARBITRATOR, 'arbitrator'), 'dispute-1');
      expect(detail.messages).toHaveLength(1);
      expect(detail.messages[0].isInternal).toBe(true);
    });

    it('посторонний кейс не видит: 404, а не 403 — не раскрываем факт спора', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.disputeCase.findUnique.mockResolvedValue(makeDispute());
      const service = await createService(prisma);
      await expect(
        service.findOne(viewer('user-outsider', 'buyer'), 'dispute-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('isInternal — только арбитр (стороне 403)', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.disputeCase.findUnique.mockResolvedValue(makeDispute({ status: 'under_review' }));
      const service = await createService(prisma);
      await expect(
        service.postMessage(viewer(BUYER, 'buyer'), 'dispute-1', {
          body: 'Моя служебная заметка',
          isInternal: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('закрытый кейс — переписка недоступна (409)', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.disputeCase.findUnique.mockResolvedValue(
        makeDispute({ status: 'resolved', resolution: 'favor_buyer' }),
      );
      const service = await createService(prisma);
      await expect(
        service.postMessage(viewer(BUYER, 'buyer'), 'dispute-1', {
          body: 'Опоздал с сообщением',
          isInternal: false,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('assign — взятие в работу', () => {
    it('open → under_review с арбитром', async () => {
      const { tx, prismaMock } = createPrismaMock();
      tx.$queryRaw.mockResolvedValue([
        { id: 'dispute-1', status: 'open', type: 'booking', referenceId: 'booking-1', assignedToId: null },
      ]);
      tx.disputeCase.update.mockResolvedValue(
        makeDispute({ status: 'under_review', assignedToId: ARBITRATOR }),
      );
      const service = await createService(prismaMock as unknown as PrismaService);
      const dto = await service.assign(ARBITRATOR, 'dispute-1');
      expect(dto.status).toBe('under_review');
      expect(tx.disputeCase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'under_review',
            assignedToId: ARBITRATOR,
          }),
        }),
      );
    });

    it('повторное назначение — 409', async () => {
      const { tx, prismaMock } = createPrismaMock();
      tx.$queryRaw.mockResolvedValue([
        { id: 'dispute-1', status: 'under_review', type: 'booking', referenceId: 'booking-1', assignedToId: ARBITRATOR },
      ]);
      const service = await createService(prismaMock as unknown as PrismaService);
      await expect(service.assign(ARBITRATOR, 'dispute-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('resolve — решение арбитра', () => {
    function underReviewTx(tx: ReturnType<typeof createPrismaMock>['tx']) {
      tx.$queryRaw.mockResolvedValue([
        {
          id: 'dispute-1',
          status: 'under_review',
          type: 'booking',
          referenceId: 'booking-1',
          assignedToId: ARBITRATOR,
        },
      ]);
      tx.disputeCase.update.mockImplementation(async ({ data }) =>
        makeDispute({
          status: data.status,
          resolution: data.resolution,
          assignedToId: ARBITRATOR,
          ...data,
        }),
      );
    }

    it('без assign решать нельзя (409)', async () => {
      const { tx, prismaMock } = createPrismaMock();
      tx.$queryRaw.mockResolvedValue([
        { id: 'dispute-1', status: 'open', type: 'booking', referenceId: 'booking-1', assignedToId: null },
      ]);
      const service = await createService(prismaMock as unknown as PrismaService);
      await expect(
        service.resolve(ARBITRATOR, 'dispute-1', { outcome: 'favor_buyer' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('чужой арбитр не решает (403)', async () => {
      const { tx, prismaMock } = createPrismaMock();
      underReviewTx(tx);
      const service = await createService(prismaMock as unknown as PrismaService);
      await expect(
        service.resolve('user-arbitrator-2', 'dispute-1', { outcome: 'favor_buyer' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('бронь favor_buyer + cancel: бронь отменена, резерв возвращён, событие в журнал', async () => {
      const { tx, prismaMock } = createPrismaMock();
      underReviewTx(tx);
      tx.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        status: 'confirmed',
        listingId: 'listing-1',
        requestedQuantity: 10,
        confirmedQuantity: 8,
      });
      tx.$executeRaw.mockResolvedValue(1);
      tx.booking.update.mockResolvedValue({});
      tx.bookingEvent.create.mockResolvedValue({});

      const service = await createService(prismaMock as unknown as PrismaService);
      const detail = await service.resolve(ARBITRATOR, 'dispute-1', {
        outcome: 'favor_buyer',
        bookingOutcome: 'cancel',
        notes: 'Товар не соответствовал заказу',
      });

      expect(detail.status).toBe('resolved');
      expect(detail.resolution).toBe('favor_buyer');
      // Резерв возвращён по подтверждённому количеству
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(tx.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'cancelled' } }),
      );
      expect(tx.bookingEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'cancelled',
            payload: expect.objectContaining({ byArbitration: true }),
          }),
        }),
      );
    });

    it('бронь favor_seller + complete: completed с ok и delivery_confirmed', async () => {
      const { tx, prismaMock } = createPrismaMock();
      underReviewTx(tx);
      tx.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        status: 'disputed',
        listingId: 'listing-1',
        requestedQuantity: 10,
        confirmedQuantity: 10,
      });

      const service = await createService(prismaMock as unknown as PrismaService);
      await service.resolve(ARBITRATOR, 'dispute-1', {
        outcome: 'favor_seller',
        bookingOutcome: 'complete',
      });

      expect(tx.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'completed',
            qualityFlag: 'ok',
            receivedQuantity: 10,
          }),
        }),
      );
      expect(tx.bookingEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'delivery_confirmed' }),
        }),
      );
    });

    it('долг compromise + settle_adjusted: сумма снижена, спор снят, settled в журнал', async () => {
      const { tx, prismaMock } = createPrismaMock();
      tx.$queryRaw.mockResolvedValue([
        {
          id: 'dispute-2',
          status: 'under_review',
          type: 'debt',
          referenceId: 'debt-1',
          assignedToId: ARBITRATOR,
        },
      ]);
      tx.disputeCase.update.mockImplementation(async ({ data }) =>
        makeDispute({ type: 'debt', referenceId: 'debt-1', ...data }),
      );
      tx.debt.findUnique.mockResolvedValue({
        id: 'debt-1',
        status: 'disputed',
        amount: { toNumber: () => 10000, toString: () => '10000' },
      });
      tx.debt.update.mockResolvedValue({});
      tx.debtEvent.create.mockResolvedValue({});

      const service = await createService(prismaMock as unknown as PrismaService);
      const detail = await service.resolve(ARBITRATOR, 'dispute-2', {
        outcome: 'compromise',
        debtOutcome: 'settle_adjusted',
        adjustedAmount: 6000,
      });

      expect(detail.status).toBe('resolved');
      expect(detail.resolution).toBe('compromise');
      // Спорный статус снят + сумма снижена
      expect(tx.debt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'settled', amount: 6000 }),
        }),
      );
      // Диспут нейтрализован (resolve_confirmed) + погашение (settled)
      const actions = tx.debtEvent.create.mock.calls.map((c) => c[0].data.action);
      expect(actions).toEqual(expect.arrayContaining(['resolve_confirmed', 'settled']));
    });

    it('долг settle_adjusted с суммой больше исходной — 400 (это не скидка)', async () => {
      const { tx, prismaMock } = createPrismaMock();
      tx.$queryRaw.mockResolvedValue([
        {
          id: 'dispute-2',
          status: 'under_review',
          type: 'debt',
          referenceId: 'debt-1',
          assignedToId: ARBITRATOR,
        },
      ]);
      tx.disputeCase.update.mockImplementation(async ({ data }) =>
        makeDispute({ type: 'debt', referenceId: 'debt-1', ...data }),
      );
      tx.debt.findUnique.mockResolvedValue({
        id: 'debt-1',
        status: 'active',
        amount: { toNumber: () => 5000, toString: () => '5000' },
      });

      const service = await createService(prismaMock as unknown as PrismaService);
      await expect(
        service.resolve(ARBITRATOR, 'dispute-2', {
          outcome: 'favor_buyer',
          debtOutcome: 'settle_adjusted',
          adjustedAmount: 6000,
        }),
      ).rejects.toBeInstanceOf(Error);
    });

    it('решение триггерит пересчёт репутации обеих сторон', async () => {
      const { tx, prismaMock } = createPrismaMock();
      underReviewTx(tx);
      tx.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        status: 'confirmed',
        listingId: 'listing-1',
        requestedQuantity: 10,
        confirmedQuantity: 8,
      });
      tx.$executeRaw.mockResolvedValue(1);

      const service = await createService(prismaMock as unknown as PrismaService);
      await service.resolve(ARBITRATOR, 'dispute-1', {
        outcome: 'favor_buyer',
        bookingOutcome: 'cancel',
      });

      // safe-триггеры вызваны (моки из createService)
      const reputation = (service as unknown as { reputation: ReputationService }).reputation;
      expect(reputation.safeOnDisputeResolved).toHaveBeenCalledTimes(1);
      expect(reputation.safeOnBookingDelivery).toHaveBeenCalledWith('booking-1');
    });
  });

  describe('заморозка объектов', () => {
    it('assertNoActiveDispute бросает 409 при активном споре', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.disputeCase.findFirst.mockResolvedValue({ id: 'dispute-1' });
      const service = await createService(prisma);
      await expect(
        service.assertNoActiveDispute('booking', 'booking-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('hasActiveDispute: false без спора, true при активном', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.disputeCase.findFirst.mockResolvedValueOnce(null);
      const service = await createService(prisma);
      await expect(service.hasActiveDispute('debt', 'debt-1')).resolves.toBe(false);
      prismaMock.disputeCase.findFirst.mockResolvedValueOnce({ id: 'd' });
      await expect(service.hasActiveDispute('debt', 'debt-1')).resolves.toBe(true);
    });
  });
});

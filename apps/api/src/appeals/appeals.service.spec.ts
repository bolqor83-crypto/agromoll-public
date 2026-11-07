/**
 * Unit-тесты сервиса апелляций на блокировки 289-ФЗ (v0.6.0-E, ADR-035)
 * — мок Prisma.
 *
 * Покрывают: открытие (только сторона пары, дубликат 409, гонка P2002,
 * обжалование снятой блокировки → 404), чтения (mine/queue/детали с
 * месяцами часов), assign (статусная машина), resolve (unblock снимает
 * блокировку в той же транзакции, reject — нет, чужой арбитр → 403).
 * Полный HTTP-цикл — в test/appeals.e2e-spec.ts (реальная БД, CI).
 */
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AppealsService } from './appeals.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const DRIVER = 'user-driver';
const SELLER = 'user-seller';
const OUTSIDER = 'user-buyer';
const ARBITRATOR = 'user-arbitrator';
const BLOCK = 'block-1';

/** Просмотрщик (роль из JWT + БД). */
function viewer(id: string, role: AuthenticatedUser['role']): AuthenticatedUser {
  return { id, role, displayName: 'Тест', phone: '+79990000000' } as AuthenticatedUser;
}

/** Минимальный кейс со связями (как APPEAL_VIEW_INCLUDE). */
function makeAppeal(overrides: Record<string, unknown> = {}) {
  const party = (id: string, role: string) => ({
    id,
    displayName: `Партия ${id}`,
    role,
  });
  return {
    id: 'appeal-1',
    blockedPairId: BLOCK,
    driverId: DRIVER,
    sellerId: SELLER,
    appellantId: DRIVER,
    reason: 'Часы задвоились из-за отменённых доставок',
    status: 'open' as const,
    openedAt: new Date(),
    assignedToId: null,
    assignedAt: null,
    resolvedById: null,
    resolvedAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    driver: party(DRIVER, 'driver'),
    seller: party(SELLER, 'seller'),
    appellant: party(DRIVER, 'driver'),
    assignedTo: null,
    ...overrides,
  };
}

/** Строка FOR UPDATE (сырой SELECT в loadAppealForUpdate). */
function appealRow(overrides: Record<string, unknown> = {}) {
  return [
    {
      id: 'appeal-1',
      blockedPairId: BLOCK,
      driverId: DRIVER,
      sellerId: SELLER,
      status: 'open',
      assignedToId: null,
      ...overrides,
    },
  ];
}

/** Мок Prisma: $transaction вызывает колбэк с tx. */
function createPrismaMock() {
  const tx = {
    appealCase: { update: jest.fn() },
    blockedPair: { update: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const prismaMock = {
    blockedPair: { findFirst: jest.fn() },
    appealCase: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    monthlyPairTotal: { findMany: jest.fn() },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return {
    tx,
    prismaMock,
    prisma: prismaMock as unknown as PrismaService,
  };
}

async function createService(prisma: PrismaService): Promise<AppealsService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      { provide: PrismaService, useValue: prisma },
      {
        provide: NotificationsService,
        useValue: { send: jest.fn().mockResolvedValue(undefined) },
      },
      AppealsService,
    ],
  }).compile();
  return moduleRef.get(AppealsService);
}

describe('AppealsService (unit, v0.6.0-E)', () => {
  const openInput = {
    blockedPairId: BLOCK,
    reason: 'Часы считались неверно: смены задваивались',
  };

  describe('open', () => {
    it('водитель пары открывает апелляцию на активную блокировку', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.blockedPair.findFirst.mockResolvedValue({
        id: BLOCK,
        driverId: DRIVER,
        sellerId: SELLER,
      });
      prismaMock.appealCase.findFirst.mockResolvedValue(null);
      prismaMock.appealCase.create.mockImplementation(async ({ data }) => makeAppeal({ ...data }));

      const service = await createService(prisma);
      const appeal = await service.open(DRIVER, openInput);

      expect(appeal.status).toBe('open');
      expect(appeal.appellant.id).toBe(DRIVER);
      expect(prismaMock.appealCase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            blockedPairId: BLOCK,
            driverId: DRIVER,
            sellerId: SELLER,
            appellantId: DRIVER,
          }),
        }),
      );
    });

    it('посторонний не может обжаловать (404 — не раскрываем факт)', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.blockedPair.findFirst.mockResolvedValue({
        id: BLOCK,
        driverId: DRIVER,
        sellerId: SELLER,
      });

      const service = await createService(prisma);
      await expect(service.open(OUTSIDER, openInput)).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.appealCase.create).not.toHaveBeenCalled();
    });

    it('несуществующая или снятая блокировка → 404', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.blockedPair.findFirst.mockResolvedValue(null);

      const service = await createService(prisma);
      await expect(service.open(DRIVER, openInput)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('дубликат активной апелляции → 409', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.blockedPair.findFirst.mockResolvedValue({
        id: BLOCK,
        driverId: DRIVER,
        sellerId: SELLER,
      });
      prismaMock.appealCase.findFirst.mockResolvedValue({ id: 'appeal-1' });

      const service = await createService(prisma);
      await expect(service.open(DRIVER, openInput)).rejects.toBeInstanceOf(ConflictException);
    });

    it('гонка двух подач (P2002 частичного индекса) → 409', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.blockedPair.findFirst.mockResolvedValue({
        id: BLOCK,
        driverId: DRIVER,
        sellerId: SELLER,
      });
      prismaMock.appealCase.findFirst.mockResolvedValue(null);
      prismaMock.appealCase.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const service = await createService(prisma);
      await expect(service.open(DRIVER, openInput)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('чтения', () => {
    it('findMine: и водитель, и продавец пары видят кейс', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.appealCase.findMany.mockResolvedValue([makeAppeal()]);

      const service = await createService(prisma);
      const mine = await service.findMine(SELLER);

      expect(mine.items).toHaveLength(1);
      expect(prismaMock.appealCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ appellantId: SELLER }, { driverId: SELLER }, { sellerId: SELLER }],
          },
        }),
      );
    });

    it('findOne: арбитру — детали с месяцами часов (доказательство)', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.appealCase.findUnique.mockResolvedValue(makeAppeal());
      prismaMock.monthlyPairTotal.findMany.mockResolvedValue([
        { month: '2026-11', totalMinutes: 3600, monthCounted: true },
        { month: '2026-10', totalMinutes: 3600, monthCounted: true },
      ]);

      const service = await createService(prisma);
      const detail = await service.findOne(viewer(ARBITRATOR, 'arbitrator'), 'appeal-1');

      expect(detail.months).toHaveLength(2);
      expect(detail.months[0]).toEqual({
        month: '2026-11',
        totalMinutes: 3600,
        monthCounted: true,
      });
    });

    it('findOne: постороннему — 404 (не раскрываем факт)', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.appealCase.findUnique.mockResolvedValue(makeAppeal());

      const service = await createService(prisma);
      await expect(service.findOne(viewer(OUTSIDER, 'buyer'), 'appeal-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('findQueue: активные кейсы, старые сверху', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.appealCase.findMany.mockResolvedValue([makeAppeal()]);

      const service = await createService(prisma);
      const queue = await service.findQueue();

      expect(queue.items).toHaveLength(1);
      expect(prismaMock.appealCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { in: ['open', 'under_review'] } },
          orderBy: { openedAt: 'asc' },
        }),
      );
    });
  });

  describe('assign', () => {
    it('open → under_review, арбитр закрепляется', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.$queryRaw.mockResolvedValue(appealRow());
      tx.appealCase.update.mockImplementation(async ({ data }) => makeAppeal(data));

      const service = await createService(prisma);
      const appeal = await service.assign(ARBITRATOR, 'appeal-1');

      expect(appeal.status).toBe('under_review');
      expect(tx.appealCase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'under_review',
            assignedToId: ARBITRATOR,
          }),
        }),
      );
    });

    it('повторный assign → 409', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.$queryRaw.mockResolvedValue(appealRow({ status: 'under_review' }));

      const service = await createService(prisma);
      await expect(service.assign(ARBITRATOR, 'appeal-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('resolve', () => {
    it('unblock: кейс закрыт И блокировка снята в одной транзакции', async () => {
      const { prisma, prismaMock, tx } = createPrismaMock();
      tx.$queryRaw.mockResolvedValue(
        appealRow({ status: 'under_review', assignedToId: ARBITRATOR }),
      );
      tx.appealCase.update.mockImplementation(async ({ data }) =>
        makeAppeal({ status: 'unblocked', ...data }),
      );
      prismaMock.monthlyPairTotal.findMany.mockResolvedValue([
        { month: '2026-11', totalMinutes: 3600, monthCounted: true },
      ]);

      const service = await createService(prisma);
      const resolved = await service.resolve(ARBITRATOR, 'appeal-1', {
        decision: 'unblock',
        notes: 'Часы действительно задвоились',
      });

      expect(resolved.status).toBe('unblocked');
      expect(resolved.months).toHaveLength(1);
      // Блокировка снята В ТОЙ ЖЕ транзакции, что и закрытие кейса.
      expect(tx.blockedPair.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: BLOCK },
          data: expect.objectContaining({
            unblockedAt: expect.any(Date),
            unblockedById: ARBITRATOR,
            unblockReason: 'Часы действительно задвоились',
          }),
        }),
      );
    });

    it('reject: блокировка остаётся (blockedPair не трогаем)', async () => {
      const { prisma, prismaMock, tx } = createPrismaMock();
      tx.$queryRaw.mockResolvedValue(
        appealRow({ status: 'under_review', assignedToId: ARBITRATOR }),
      );
      tx.appealCase.update.mockImplementation(async ({ data }) =>
        makeAppeal({ status: 'rejected', ...data }),
      );
      prismaMock.monthlyPairTotal.findMany.mockResolvedValue([]);

      const service = await createService(prisma);
      const resolved = await service.resolve(ARBITRATOR, 'appeal-1', {
        decision: 'reject',
      });

      expect(resolved.status).toBe('rejected');
      expect(tx.blockedPair.update).not.toHaveBeenCalled();
    });

    it('чужой арбитр → 403', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.$queryRaw.mockResolvedValue(
        appealRow({ status: 'under_review', assignedToId: 'user-other-arbitrator' }),
      );

      const service = await createService(prisma);
      await expect(
        service.resolve(ARBITRATOR, 'appeal-1', { decision: 'unblock' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resolve без assign (из open) → 409', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.$queryRaw.mockResolvedValue(appealRow({ status: 'open' }));

      const service = await createService(prisma);
      await expect(
        service.resolve(ARBITRATOR, 'appeal-1', { decision: 'unblock' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});

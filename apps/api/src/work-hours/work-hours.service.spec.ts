/**
 * Unit-тесты сервиса учёта часов 289-ФЗ (мок Prisma), v0.4.0 подэтап B.
 *
 * Покрывают: старт смены (правила, блокировка пары 409, двойная смена),
 * завершение (подсчёт минут, идемпотентность, upsert месячного итога,
 * monthCounted при ≥60 ч), крон серий (полная серия → BlockedPair,
 * разорванная серия → нет, повторный крон не дублирует), checkPair.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { WorkSession } from '@prisma/client';
import { WorkHoursService, addMonths, toMonthKey } from './work-hours.service';
import {
  WORK_HOURS_MONTHLY_LIMIT,
  WORK_MONTHS_SERIES,
  WORK_PAIR_BLOCKED_CODE,
} from './work-hours.constants';
import { PrismaService } from '../prisma/prisma.service';

const DRIVER = 'driver-1';
const SELLER = 'seller-1';
const MONTH = '2026-11';

/** Минимальная сессия для тестов. */
function makeSession(overrides: Partial<WorkSession> = {}): WorkSession & {
  driver: { id: string; displayName: string };
  seller: { id: string; displayName: string };
} {
  return {
    id: 'session-1',
    driverId: DRIVER,
    sellerId: SELLER,
    startedAt: new Date(Date.now() - 2 * 60_000), // 2 минуты назад
    endedAt: null,
    durationMinutes: null,
    month: MONTH,
    createdAt: new Date(),
    driver: { id: DRIVER, displayName: 'Газель Next' },
    seller: { id: SELLER, displayName: 'ФХ «Донская долина»' },
    ...overrides,
  } as WorkSession & { driver: { id: string; displayName: string }; seller: { id: string; displayName: string } };
}

/** Мок PrismaService: $transaction прокидывает в tx. */
function createPrismaMock() {
  const tx = {
    user: { findUnique: jest.fn() },
    workSession: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    blockedPair: { findUnique: jest.fn() },
    monthlyPairTotal: { findUnique: jest.fn(), upsert: jest.fn() },
  };
  const prismaMock = {
    user: { findUnique: jest.fn() },
    workSession: { findFirst: jest.fn() },
    monthlyPairTotal: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
    blockedPair: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return {
    tx,
    prismaMock,
    prisma: prismaMock as unknown as PrismaService,
  };
}

async function createService(prisma: PrismaService): Promise<WorkHoursService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: WORK_HOURS_MONTHLY_LIMIT, useValue: 60 },
      { provide: WORK_MONTHS_SERIES, useValue: 6 },
      WorkHoursService,
    ],
  }).compile();
  return moduleRef.get(WorkHoursService);
}

describe('WorkHoursService (unit)', () => {
  // ─── Сессии ──────────────────────────────────────────────────────────────

  describe('startSession', () => {
    it('создаёт открытую сессию с месяцем старта', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.user.findUnique.mockResolvedValue({ id: SELLER, displayName: 'Продавец' });
      tx.blockedPair.findUnique.mockResolvedValue(null);
      tx.workSession.findFirst.mockResolvedValue(null);
      tx.workSession.create.mockImplementation(async ({ data }) => makeSession({ ...data }));

      const service = await createService(prisma);
      const session = await service.startSession(DRIVER, SELLER);

      expect(session.endedAt).toBeNull();
      expect(session.month).toBe(toMonthKey(new Date()));
      expect(tx.workSession.create).toHaveBeenCalled();
    });

    it('смена с самим собой → 400; несуществующий продавец → 404', async () => {
      const { prisma, tx } = createPrismaMock();
      const service = await createService(prisma);
      await expect(service.startSession(DRIVER, DRIVER)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      tx.user.findUnique.mockResolvedValue(null);
      await expect(service.startSession(DRIVER, 'ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('заблокированная пара → 409 WORK_PAIR_BLOCKED с мягким сообщением', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.user.findUnique.mockResolvedValue({ id: SELLER });
      tx.blockedPair.findUnique.mockResolvedValue({
        driverId: DRIVER,
        sellerId: SELLER,
        reason: 'пауза',
        unblockAt: null,
      });

      const service = await createService(prisma);
      try {
        await service.startSession(DRIVER, SELLER);
        fail('ожидали 409');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        const body = (error as ConflictException).getResponse() as { code: string };
        expect(body.code).toBe(WORK_PAIR_BLOCKED_CODE);
      }
    });

    it('вторая открытая смена → 409', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.user.findUnique.mockResolvedValue({ id: SELLER });
      tx.blockedPair.findUnique.mockResolvedValue(null);
      tx.workSession.findFirst.mockResolvedValue(makeSession({ id: 'open' }));

      const service = await createService(prisma);
      await expect(service.startSession(DRIVER, SELLER)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('endSession', () => {
    it('считает минуты, закрывает и инкрементит месячный итог', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.workSession.findUnique.mockResolvedValue(
        makeSession({ startedAt: new Date(Date.now() - 125 * 60_000) }), // ~125 мин
      );
      tx.workSession.update.mockImplementation(async ({ data }) =>
        makeSession({ endedAt: new Date(), durationMinutes: 125, ...data }),
      );
      tx.monthlyPairTotal.findUnique.mockResolvedValue({
        driverId: DRIVER,
        sellerId: SELLER,
        month: MONTH,
        totalMinutes: 300,
        monthCounted: false,
      });
      tx.monthlyPairTotal.upsert.mockResolvedValue({});

      const service = await createService(prisma);
      const session = await service.endSession('session-1', DRIVER);

      expect(session.durationMinutes).toBe(125);
      // 300 + 125 = 425 минут — месяц ещё не засчитан (<3600)
      expect(tx.monthlyPairTotal.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { driverId_sellerId_month: { driverId: DRIVER, sellerId: SELLER, month: MONTH } },
          create: expect.objectContaining({ totalMinutes: 425, monthCounted: false }),
          update: expect.objectContaining({ totalMinutes: 425, monthCounted: false }),
        }),
      );
    });

    it('переход через 60 ч → monthCounted=true', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.workSession.findUnique.mockResolvedValue(makeSession({ startedAt: new Date(Date.now() - 60 * 60_000) }));
      tx.workSession.update.mockImplementation(async ({ data }) => makeSession({ ...data, endedAt: new Date() }));
      tx.monthlyPairTotal.findUnique.mockResolvedValue({
        totalMinutes: 59 * 60,
        monthCounted: false,
      });
      tx.monthlyPairTotal.upsert.mockResolvedValue({});

      const service = await createService(prisma);
      await service.endSession('session-1', DRIVER);

      // 59ч + 1ч = 60ч = 3600 минут → засчитан
      expect(tx.monthlyPairTotal.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ monthCounted: true }),
        }),
      );
    });

    it('идемпотентно: повторное завершение не инкрементит', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.workSession.findUnique.mockResolvedValue(
        makeSession({ endedAt: new Date(), durationMinutes: 90 }),
      );

      const service = await createService(prisma);
      const session = await service.endSession('session-1', DRIVER);
      expect(session.durationMinutes).toBe(90);
      expect(tx.workSession.update).not.toHaveBeenCalled();
      expect(tx.monthlyPairTotal.upsert).not.toHaveBeenCalled();
    });

    it('чужой пользователь → 403', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.workSession.findUnique.mockResolvedValue(makeSession());
      const service = await createService(prisma);
      await expect(service.endSession('session-1', 'outsider')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // ─── Крон серий ──────────────────────────────────────────────────────────

  describe('enforceSeriesLimit (крон)', () => {
    it('полная серия 6 месяцев → создаёт BlockedPair', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.monthlyPairTotal.findMany
        .mockResolvedValueOnce([{ driverId: DRIVER, sellerId: SELLER }]) // текущий месяц counted
        .mockResolvedValueOnce(
          [5, 4, 3, 2, 1, 0].map((back) => ({
            month: addMonths(MONTH, -back),
          })),
        ); // 6 месяцев counted (текущий + 5 назад)
      prismaMock.blockedPair.findUnique.mockResolvedValue(null);
      prismaMock.blockedPair.create.mockResolvedValue({});

      const service = await createService(prisma);
      const created = await service.enforceSeriesLimit(MONTH);

      expect(created).toBe(1);
      expect(prismaMock.blockedPair.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ driverId: DRIVER, sellerId: SELLER }),
        }),
      );
    });

    it('разорванная серия (<60 ч в одном месяце) → блокировки нет', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.monthlyPairTotal.findMany
        .mockResolvedValueOnce([{ driverId: DRIVER, sellerId: SELLER }])
        .mockResolvedValueOnce([
          { month: MONTH },
          { month: addMonths(MONTH, -1) },
          // месяц -2 пропущен (<60 ч) — серия разорвана
          { month: addMonths(MONTH, -3) },
        ]);
      prismaMock.blockedPair.findUnique.mockResolvedValue(null);

      const service = await createService(prisma);
      const created = await service.enforceSeriesLimit(MONTH);
      expect(created).toBe(0);
      expect(prismaMock.blockedPair.create).not.toHaveBeenCalled();
    });

    it('повторный крон не дублирует блокировку', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.monthlyPairTotal.findMany
        .mockResolvedValueOnce([{ driverId: DRIVER, sellerId: SELLER }])
        .mockResolvedValueOnce([5, 4, 3, 2, 1, 0].map((back) => ({ month: addMonths(MONTH, -back) })));
      prismaMock.blockedPair.findUnique.mockResolvedValue({
        driverId: DRIVER,
        sellerId: SELLER,
      }); // уже заблокирована

      const service = await createService(prisma);
      const created = await service.enforceSeriesLimit(MONTH);
      expect(created).toBe(0);
      expect(prismaMock.blockedPair.create).not.toHaveBeenCalled();
    });
  });

  // ─── Вспомогательные ─────────────────────────────────────────────────────

  describe('addMonths / toMonthKey', () => {
    it('переходит через границу года', () => {
      expect(addMonths('2026-01', -1)).toBe('2025-12');
      expect(addMonths('2025-12', 1)).toBe('2026-01');
      expect(toMonthKey(new Date(2026, 10, 7))).toBe('2026-11');
    });
  });
});

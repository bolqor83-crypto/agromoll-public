/**
 * Unit-тесты сервиса долгов (мок Prisma), v0.4.0 подэтап A.
 *
 * Покрывают: создание (правила «не самому себе», несуществующий дебитор,
 * несуществующий лот), settle (обе стороны, чужой — 403, повтор — 409),
 * dispute, обоюдный resolve (два подтверждения разных сторон), напоминание
 * (кулдаун 24 ч → 429 с nextReminderAt, не-кредитор — 403) и сводку
 * (активные суммы + просрочка 30+ дней).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Debt } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { DebtsService } from './debts.service';
import { DEBT_REMINDER_COOLDOWN_HOURS } from './debts.constants';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReputationService } from '../reputation/reputation.service';
import { DisputesService } from '../disputes/disputes.service';

const CREDITOR = 'creditor-1';
const DEBTOR = 'debtor-1';
const OUTSIDER = 'outsider-1';

/** Минимальный долг для тестов (с включёнными сторонами). */
function makeDebt(overrides: Partial<Debt> = {}): Debt & {
  creditor: { id: string; displayName: string };
  debtor: { id: string; displayName: string };
} {
  const base = {
    id: 'debt-1',
    creditorId: CREDITOR,
    debtorId: DEBTOR,
    amount: new Prisma.Decimal('12500.00'),
    currency: 'RUB',
    description: null,
    listingId: null,
    bookingId: null,
    status: 'active',
    resolveRequestedBy: null,
    createdAt: new Date(Date.now() - 3 * 86_400_000), // 3 дня назад — не просрочен
    updatedAt: new Date(),
    settledAt: null,
    creditor: { id: CREDITOR, displayName: 'ФХ «Донская долина»' },
    debtor: { id: DEBTOR, displayName: 'Ларёк «У Ашота»' },
    ...overrides,
  } as Debt & { creditor: { id: string; displayName: string }; debtor: { id: string; displayName: string } };
  return base;
}

/** Мок PrismaService: $transaction вызывает колбэк с моком tx. */
function createPrismaMock() {
  const tx = {
    user: { findUnique: jest.fn() },
    listing: { findUnique: jest.fn() },
    booking: { findUnique: jest.fn() },
    debt: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    debtEvent: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  };
  const prismaMock = {
    debt: { findMany: jest.fn(), aggregate: jest.fn(), count: jest.fn() },
    booking: { findMany: jest.fn() },
    debtEvent: { findMany: jest.fn() },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return {
    tx,
    prismaMock,
    prisma: prismaMock as unknown as PrismaService,
  };
}

async function createService(
  prisma: PrismaService,
  notifications: { send: jest.Mock },
  cooldownHours = 24,
): Promise<DebtsService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: NotificationsService, useValue: notifications },
      { provide: ReputationService, useValue: { safeOnDebtChanged: jest.fn() } },
      {
        provide: DisputesService,
        useValue: {
          assertNoActiveDispute: jest.fn().mockResolvedValue(undefined),
          hasActiveDispute: jest.fn().mockResolvedValue(false),
        },
      },
      { provide: DEBT_REMINDER_COOLDOWN_HOURS, useValue: cooldownHours },
      DebtsService,
    ],
  }).compile();
  return moduleRef.get(DebtsService);
}

describe('DebtsService (unit)', () => {
  let notifications: { send: jest.Mock };

  beforeEach(() => {
    notifications = { send: jest.fn().mockResolvedValue(undefined) };
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create — создание долга', () => {
    it('создаёт active-долг и событие created', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.user.findUnique.mockResolvedValue({ id: DEBTOR, displayName: 'Дебитор' });
      tx.debt.create.mockImplementation(async ({ data }) => makeDebt({ ...data, id: 'new-debt' }));

      const service = await createService(prisma, notifications);
      const debt = await service.create({
        creditorId: CREDITOR,
        debtorId: DEBTOR,
        amount: 12_500,
        currency: 'RUB',
      });

      expect(debt.status).toBe('active');
      expect(debt.creditorId).toBe(CREDITOR);
      expect(debt.debtorId).toBe(DEBTOR);
      expect(debt.canRemind).toBe(true);
      expect(debt.isOverdue).toBe(false);
      expect(tx.debtEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'created', actorId: CREDITOR }),
        }),
      );
    });

    it('долг самому себе → 400', async () => {
      const { prisma } = createPrismaMock();
      const service = await createService(prisma, notifications);
      await expect(
        service.create({ creditorId: CREDITOR, debtorId: CREDITOR, amount: 100, currency: 'RUB' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('несуществующий дебитор → 404', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.user.findUnique.mockResolvedValue(null);
      const service = await createService(prisma, notifications);
      await expect(
        service.create({ creditorId: CREDITOR, debtorId: 'ghost', amount: 100, currency: 'RUB' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('несуществующий лот → 404', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.user.findUnique.mockResolvedValue({ id: DEBTOR });
      tx.listing.findUnique.mockResolvedValue(null);
      const service = await createService(prisma, notifications);
      await expect(
        service.create({
          creditorId: CREDITOR,
          debtorId: DEBTOR,
          amount: 100,
          currency: 'RUB',
          listingId: 'ghost-listing',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── settle ──────────────────────────────────────────────────────────────

  describe('settle — погашение', () => {
    it('дебитор гасит active → settled + settledAt + событие + уведомление кредитору', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.debt.findUnique.mockResolvedValue(makeDebt());
      tx.debt.update.mockImplementation(async ({ data }) => makeDebt({ ...data, status: 'settled' }));

      const service = await createService(prisma, notifications);
      const debt = await service.settle({ debtId: 'debt-1', actorId: DEBTOR });

      expect(debt.status).toBe('settled');
      expect(debt.settledAt).not.toBeNull();
      expect(tx.debtEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'settled', actorId: DEBTOR }),
        }),
      );
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ userId: CREDITOR, type: 'debt_reminder' }),
      );
    });

    it('чужой пользователь → 403', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.debt.findUnique.mockResolvedValue(makeDebt());
      const service = await createService(prisma, notifications);
      await expect(service.settle({ debtId: 'debt-1', actorId: OUTSIDER })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('повторный settle (уже settled) → 409', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.debt.findUnique.mockResolvedValue(makeDebt({ status: 'settled' }));
      const service = await createService(prisma, notifications);
      await expect(
        service.settle({ debtId: 'debt-1', actorId: CREDITOR }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ─── dispute / resolve ───────────────────────────────────────────────────

  describe('dispute и обоюдный resolve', () => {
    it('спор: active → disputed, событие с причиной, уведомление второй стороне', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.debt.findUnique.mockResolvedValue(makeDebt());
      tx.debt.update.mockImplementation(async ({ data }) => makeDebt({ ...data, status: 'disputed' }));

      const service = await createService(prisma, notifications);
      const debt = await service.dispute({ debtId: 'debt-1', actorId: DEBTOR, reason: 'уже отдал' });

      expect(debt.status).toBe('disputed');
      expect(tx.debtEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'disputed', payload: { reason: 'уже отдал' } }),
        }),
      );
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ userId: CREDITOR }),
      );
    });

    it('первое «Согласен» фиксирует resolveRequestedBy, спор остаётся открытым', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.debt.findUnique.mockResolvedValue(makeDebt({ status: 'disputed' }));
      tx.debt.update.mockImplementation(
        async ({ data }) => makeDebt({ ...data, status: 'disputed', resolveRequestedBy: CREDITOR }),
      );

      const service = await createService(prisma, notifications);
      const debt = await service.resolve({ debtId: 'debt-1', actorId: CREDITOR });

      expect(debt.status).toBe('disputed');
      expect(debt.resolveRequestedById).toBe(CREDITOR);
      expect(tx.debtEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'resolve_requested', actorId: CREDITOR }),
        }),
      );
    });

    it('второе «Согласен» другой стороной → settled (обоюдно)', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.debt.findUnique.mockResolvedValue(
        makeDebt({ status: 'disputed', resolveRequestedBy: CREDITOR }),
      );
      tx.debt.update.mockImplementation(
        async ({ data }) => makeDebt({ ...data, status: 'settled', resolveRequestedBy: null }),
      );

      const service = await createService(prisma, notifications);
      const debt = await service.resolve({ debtId: 'debt-1', actorId: DEBTOR });

      expect(debt.status).toBe('settled');
      expect(debt.settledAt).not.toBeNull();
      expect(tx.debtEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'resolve_confirmed',
            payload: { firstBy: CREDITOR, confirmedBy: DEBTOR },
          }),
        }),
      );
    });

    it('повторное «Согласен» той же стороной → 409', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.debt.findUnique.mockResolvedValue(
        makeDebt({ status: 'disputed', resolveRequestedBy: CREDITOR }),
      );
      const service = await createService(prisma, notifications);
      await expect(service.resolve({ debtId: 'debt-1', actorId: CREDITOR })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  // ─── reminder ────────────────────────────────────────────────────────────

  describe('reminder — напоминание с кулдауном', () => {
    it('кредитор напоминает: событие + уведомление дебитору + nextReminderAt', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.debt.findUnique.mockResolvedValue(makeDebt());
      tx.debtEvent.findFirst.mockResolvedValue(null);

      const service = await createService(prisma, notifications, 24);
      const result = await service.remind({ debtId: 'debt-1', actorId: CREDITOR });

      expect(result.sentAt).toBeDefined();
      expect(result.nextReminderAt).toBeDefined();
      expect(tx.debtEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'reminder_sent', actorId: CREDITOR }),
        }),
      );
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ userId: DEBTOR, type: 'debt_reminder' }),
      );
    });

    it('не-кредитор → 403', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.debt.findUnique.mockResolvedValue(makeDebt());
      const service = await createService(prisma, notifications);
      await expect(service.remind({ debtId: 'debt-1', actorId: DEBTOR })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('второе напоминание в течение 24 ч → 429 с nextReminderAt', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.debt.findUnique.mockResolvedValue(makeDebt());
      tx.debtEvent.findFirst.mockResolvedValue({
        debtId: 'debt-1',
        createdAt: new Date(Date.now() - 2 * 3_600_000), // 2 часа назад
      });

      const service = await createService(prisma, notifications, 24);
      try {
        await service.remind({ debtId: 'debt-1', actorId: CREDITOR });
        fail('ожидали 429');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        expect(httpError.getStatus()).toBe(429);
        const body = httpError.getResponse() as { code: string; nextReminderAt: string };
        expect(body.code).toBe('DEBT_REMINDER_COOLDOWN');
        expect(body.nextReminderAt).toBeDefined();
      }
    });

    it('после истечения кулдауна напоминание проходит', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.debt.findUnique.mockResolvedValue(makeDebt());
      tx.debtEvent.findFirst.mockResolvedValue({
        debtId: 'debt-1',
        createdAt: new Date(Date.now() - 25 * 3_600_000), // 25 часов назад
      });

      const service = await createService(prisma, notifications, 24);
      const result = await service.remind({ debtId: 'debt-1', actorId: CREDITOR });
      expect(result.sentAt).toBeDefined();
    });

    it('напоминание по settled-долгу → 409', async () => {
      const { prisma, tx } = createPrismaMock();
      tx.debt.findUnique.mockResolvedValue(makeDebt({ status: 'settled' }));
      const service = await createService(prisma, notifications);
      await expect(service.remind({ debtId: 'debt-1', actorId: CREDITOR })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  // ─── DTO-вычисления ──────────────────────────────────────────────────────

  describe('сводка и DTO', () => {
    it('findMine помечает просрочку (active старше 30 дней) и кулдаун напоминаний', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      const overdue = makeDebt({
        id: 'old-debt',
        createdAt: new Date(Date.now() - 31 * 86_400_000),
      });
      const fresh = makeDebt({ id: 'fresh-debt', createdAt: new Date(Date.now() - 86_400_000) });
      prismaMock.debt.findMany.mockResolvedValue([overdue, fresh]);
      prismaMock.debtEvent.findMany.mockResolvedValue([
        { debtId: 'fresh-debt', createdAt: new Date(Date.now() - 3_600_000) },
      ]);

      const service = await createService(prisma, notifications, 24);
      const debts = await service.findMine({ userId: CREDITOR });

      expect(debts).toHaveLength(2);
      const oldDto = debts.find((d) => d.id === 'old-debt');
      const freshDto = debts.find((d) => d.id === 'fresh-debt');
      expect(oldDto?.isOverdue).toBe(true);
      expect(oldDto?.canRemind).toBe(true);
      expect(freshDto?.isOverdue).toBe(false);
      expect(freshDto?.canRemind).toBe(false); // напоминание час назад
      expect(freshDto?.nextReminderAt).toBeDefined();
    });

    it('summary считает активные суммы и просрочку', async () => {
      const { prisma, prismaMock } = createPrismaMock();
      prismaMock.debt.aggregate.mockImplementation(async ({ where }) => ({
        _sum: { amount: new Prisma.Decimal(where.creditorId ? '12500.00' : '4200.00') },
        _count: where.creditorId ? 2 : 1,
      }));
      prismaMock.debt.count.mockResolvedValue(1);

      const service = await createService(prisma, notifications);
      const summary = await service.summary(CREDITOR);

      expect(summary.owedToMe.total).toBe('12500');
      expect(summary.owedToMe.count).toBe(2);
      expect(summary.owedToMe.overdueCount).toBe(1);
      expect(summary.iOwe.count).toBe(1);
    });
  });
});

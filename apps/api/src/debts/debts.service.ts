/**
 * Сервис долгов (v0.4.0, ADR-010) — ядро подэтапа A.
 *
 * Долг — записанная договорённость «товар отпущен в долг». Платформа
 * НЕ является платёжным агентом: деньги стороны передают напрямую,
 * здесь — только учёт и журнал.
 *
 * Машина состояний:
 *
 *   active ──(settle, любая сторона)──► settled
 *      │
 *      ├──(dispute, любая сторона)──► disputed
 *      │                                  │
 *      │                     (resolve «Согласен», сторона 1)
 *      │                                  │  resolveRequestedBy = actor
 *      │                     (resolve «Согласен», сторона 2)
 *      │                                  ▼
 *      └───────────────────────────► settled (обоюдное разрешение)
 *
 * cancelled — зарезервирован на будущее, перехода в v0.4.0 нет.
 *
 * Правила:
 *  - дать в долг самому себе нельзя (400);
 *  - сумма 0 < S ≤ 1 000 000 ₽ (zod на входе, защита от опечаток);
 *  - settle/dispute — только из active, иначе 409 (конфликт состояний);
 *  - resolve — обоюдный: два разных подтверждения закрывают спор;
 *  - напоминание — только кредитор, только active, не чаще раза
 *    в 24 ч (429 DEBT_REMINDER_COOLDOWN с моментом следующей попытки);
 *  - каждый переход — строка в append-only DebtEvent (оттуда в v0.5.0
 *    считается «надёжность оплаты»);
 *  - просрочка = active и старше 30 дней — isOverdue в DTO (янтарный
 *    акцент в виджете и карточке).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
// ВАЖНО: value-import, а не `import type` — PrismaService участвует в DI
// (constructor(prisma: PrismaService)); type-only стирает класс в рантайме
// и Nest падает с «argument Function at index [0]» (как с Reflector в v0.3.0).
import { PrismaService } from '../prisma/prisma.service';
import type {
  CounterpartyDto,
  DebtDto,
  DebtsSummaryDto,
  DebtStatus,
  ReminderResultDto,
} from '@agromoll/types';
import { DEBT_OVERDUE_DAYS } from './debts.constants';
import { DEBT_REMINDER_COOLDOWN_HOURS } from './debts.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { ReputationService } from '../reputation/reputation.service';

type TransactionClient = Prisma.TransactionClient;

/** Загрузка долга с именами сторон — для карточек и уведомлений. */
const DEBT_VIEW_INCLUDE = {
  creditor: {
    select: {
      id: true,
      displayName: true,
      reputation: { select: { score: true, dealsCount: true } },
    },
  },
  debtor: {
    select: {
      id: true,
      displayName: true,
      reputation: { select: { score: true, dealsCount: true } },
    },
  },
} as const satisfies Prisma.DebtInclude;

type DebtWithParties = Prisma.DebtGetPayload<{ include: typeof DEBT_VIEW_INCLUDE }>;

/** Снимок рейтинга → сводка для бейджа (ADR-013). NULL-скоры не показываем. */
function toRatingSummary(
  snapshot: { score: number | null; dealsCount: number } | null,
): { score: number; dealsCount: number } | null {
  return snapshot && snapshot.score !== null ? { score: snapshot.score, dealsCount: snapshot.dealsCount } : null;
}

export interface CreateDebtParams {
  /** Кто дал в долг — текущий пользователь (кредитор). */
  creditorId: string;
  debtorId: string;
  amount: number;
  currency: string;
  description?: string;
  listingId?: string;
  bookingId?: string;
}

export interface DebtActorParams {
  debtId: string;
  /** Кредитор или дебитор (для settle/dispute — любая сторона). */
  actorId: string;
}

export interface DisputeDebtParams extends DebtActorParams {
  reason?: string;
}

export interface ReminderParams extends DebtActorParams {
  /** Переопределить кулдаун (для тестов). */
  cooldownHours?: number;
}

export interface FindMineParams {
  userId: string;
  status?: DebtStatus;
  dateFrom?: Date;
  dateTo?: Date;
}

/** Верх списка долгов — как у броней: рынок живёт «последними» записями. */
const LIST_LIMIT = 200;

@Injectable()
export class DebtsService {
  private readonly logger = new Logger(DebtsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly reputation: ReputationService,
    @Inject(DEBT_REMINDER_COOLDOWN_HOURS) private readonly defaultCooldownHours: number,
  ) {}

  // ─── Создание ─────────────────────────────────────────────────────────────

  /** Кредитор фиксирует «отпустил в долг». Пишет DebtEvent(created). */
  async create(params: CreateDebtParams): Promise<DebtDto> {
    const { creditorId, debtorId } = params;
    if (creditorId === debtorId) {
      throw new BadRequestException('Нельзя оформить долг на самого себя');
    }

    return this.prisma.$transaction(async (tx) => {
      const debtor = await tx.user.findUnique({
        where: { id: debtorId },
        select: { id: true, displayName: true },
      });
      if (!debtor) {
        throw new NotFoundException('Пользователь не найден');
      }
      if (params.listingId !== undefined) {
        const listing = await tx.listing.findUnique({
          where: { id: params.listingId },
          select: { id: true },
        });
        if (!listing) {
          throw new NotFoundException('Лот не найден');
        }
      }
      if (params.bookingId !== undefined) {
        const booking = await tx.booking.findUnique({
          where: { id: params.bookingId },
          select: { id: true },
        });
        if (!booking) {
          throw new NotFoundException('Бронь не найдена');
        }
      }

      const debt = await tx.debt.create({
        data: {
          creditorId,
          debtorId,
          amount: new Prisma.Decimal(params.amount),
          currency: params.currency,
          description: params.description,
          listingId: params.listingId,
          bookingId: params.bookingId,
          status: 'active',
        },
        include: DEBT_VIEW_INCLUDE,
      });

      await tx.debtEvent.create({
        data: {
          debtId: debt.id,
          actorId: creditorId,
          action: 'created',
          payload: { amount: debt.amount.toString(), currency: debt.currency },
        },
      });

      this.logger.log({ debtId: debt.id, creditorId, debtorId, amount: params.amount }, 'debt:created');
      return this.toDto(debt, null);
    });
  }

  // ─── Чтения ───────────────────────────────────────────────────────────────

  /** Мои долги обеих сторон («мне должны» / «я должен» фильтрует клиент). */
  async findMine(params: FindMineParams): Promise<DebtDto[]> {
    const where: Prisma.DebtWhereInput = {
      OR: [{ creditorId: params.userId }, { debtorId: params.userId }],
    };
    if (params.status !== undefined) {
      where.status = params.status;
    }
    if (params.dateFrom !== undefined || params.dateTo !== undefined) {
      where.createdAt = {
        ...(params.dateFrom !== undefined ? { gte: params.dateFrom } : {}),
        ...(params.dateTo !== undefined ? { lte: params.dateTo } : {}),
      };
    }

    const debts = await this.prisma.debt.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
      include: DEBT_VIEW_INCLUDE,
    });

    // Последние напоминания — одним запросом, чтобы считать canRemind
    // без N+1 (ADR-010: кулдаун 24 ч на долг).
    const lastReminders = await this.findLastReminderAt(
      this.prisma,
      debts.map((d) => d.id),
    );
    return debts.map((debt) => this.toDto(debt, lastReminders.get(debt.id) ?? null));
  }

  /** Сводка для виджета: сколько должны мне / должен я (+просроченные). */
  async summary(userId: string): Promise<DebtsSummaryDto> {
    const overdueBefore = new Date(Date.now() - DEBT_OVERDUE_DAYS * 24 * 60 * 60_000);

    const [owedToMe, owedToMeOverdue, iOwe, iOweOverdue] = await Promise.all([
      this.prisma.debt.aggregate({
        where: { creditorId: userId, status: 'active' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.debt.count({
        where: { creditorId: userId, status: 'active', createdAt: { lt: overdueBefore } },
      }),
      this.prisma.debt.aggregate({
        where: { debtorId: userId, status: 'active' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.debt.count({
        where: { debtorId: userId, status: 'active', createdAt: { lt: overdueBefore } },
      }),
    ]);

    return {
      owedToMe: {
        total: (owedToMe._sum.amount ?? new Prisma.Decimal(0)).toString(),
        count: owedToMe._count,
        overdueCount: owedToMeOverdue,
      },
      iOwe: {
        total: (iOwe._sum.amount ?? new Prisma.Decimal(0)).toString(),
        count: iOwe._count,
        overdueCount: iOweOverdue,
      },
    };
  }

  /**
   * Контрагенты для формы создания долга: пользователи, с которыми уже
   * были сделки (брони в обе стороны). «Рынок доверяет тем, с кем уже
   * работал» — новый контрагент без общей истории в списке не появится
   * (защита от долгов «в пустоту», ADR-010).
   */
  async counterparties(userId: string): Promise<CounterpartyDto[]> {
    const [asBuyer, asSeller] = await Promise.all([
      this.prisma.booking.findMany({
        where: { buyerId: userId },
        select: {
          createdAt: true,
          listing: { select: { sellerId: true, seller: { select: { displayName: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
      }),
      this.prisma.booking.findMany({
        where: { listing: { sellerId: userId } },
        select: { createdAt: true, buyer: { select: { id: true, displayName: true } } },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
      }),
    ]);

    // Последняя сделка с каждым контрагентом (сортировка уже desc —
    // первая встреча в Map и есть самая свежая).
    const byId = new Map<string, CounterpartyDto>();
    for (const row of asBuyer) {
      const { sellerId, seller } = row.listing;
      if (!sellerId || sellerId === userId) continue;
      if (!byId.has(sellerId)) {
        byId.set(sellerId, {
          id: sellerId,
          displayName: seller?.displayName ?? 'Контрагент',
          lastDealAt: row.createdAt.toISOString(),
        });
      }
    }
    for (const row of asSeller) {
      if (row.buyer.id === userId) continue;
      if (!byId.has(row.buyer.id)) {
        byId.set(row.buyer.id, {
          id: row.buyer.id,
          displayName: row.buyer.displayName,
          lastDealAt: row.createdAt.toISOString(),
        });
      }
    }

    return [...byId.values()]
      .sort((a, b) => b.lastDealAt.localeCompare(a.lastDealAt))
      .slice(0, 50);
  }

  // ─── Переходы статусов ────────────────────────────────────────────────────

  /** Погашение: любая сторона подтверждает. active → settled. */
  async settle(params: DebtActorParams): Promise<DebtDto> {
    const { debtId, actorId } = params;
    const debt = await this.prisma.$transaction(async (tx) => {
      const current = await loadDebtForUpdate(tx, debtId);
      assertIsParty(current, actorId, 'Погасить долг может только кредитор или дебитор');
      assertStatus(current, ['active'], 'settle');

      const updated = await tx.debt.update({
        where: { id: debtId },
        data: { status: 'settled', settledAt: new Date() },
        include: DEBT_VIEW_INCLUDE,
      });

      await tx.debtEvent.create({
        data: { debtId, actorId, action: 'settled', payload: { by: actorId } },
      });

      this.logTransition(debtId, actorId, current.status, 'settled');
      return updated;
    });

    // Вторая сторона видит закрытие записи — прозрачность журнала (in-app).
    await this.notifications.send({
      userId: debt.creditorId === actorId ? debt.debtorId : debt.creditorId,
      type: 'debt_reminder',
      title: 'Долг погашен',
      body: `Долг ${debt.amount.toString()} ₽ отмечен погашенным. Запись в журнале обновлена.`,
      data: { debtId: debt.id },
    });

    // Триггер ADR-013: погашение — плюс к надёжности дебитора.
    await this.reputation.safeOnDebtChanged(debtId);
    return this.toDto(debt, null);
  }

  /** Спор: любая сторона. active → disputed. Причина — в журнал. */
  async dispute(params: DisputeDebtParams): Promise<DebtDto> {
    const { debtId, actorId, reason } = params;
    const debt = await this.prisma.$transaction(async (tx) => {
      const current = await loadDebtForUpdate(tx, debtId);
      assertIsParty(current, actorId, 'Открыть спор может только кредитор или дебитор');
      assertStatus(current, ['active'], 'dispute');

      const updated = await tx.debt.update({
        where: { id: debtId },
        data: { status: 'disputed' },
        include: DEBT_VIEW_INCLUDE,
      });

      await tx.debtEvent.create({
        data: {
          debtId,
          actorId,
          action: 'disputed',
          ...(reason !== undefined ? { payload: { reason } } : {}),
        },
      });

      this.logTransition(debtId, actorId, current.status, 'disputed');
      return updated;
    });

    // Вторая сторона должна узнать о споре как можно скорее.
    await this.notifications.send({
      userId: debt.creditorId === actorId ? debt.debtorId : debt.creditorId,
      type: 'debt_reminder',
      title: 'Открыт спор по долгу',
      body: `По долгу ${debt.amount.toString()} ₽ открыт спор. Откройте карточку, чтобы разрешить его вместе.`,
      data: { debtId: debt.id },
    });

    // Триггер ADR-013: спор по долгу — минус к надёжности дебитора.
    await this.reputation.safeOnDebtChanged(debtId);
    return this.toDto(debt, null);
  }

  /**
   * Разрешение спора — обоюдное (ADR-010). Первое «Согласен» фиксирует
   * resolveRequestedBy, второе — ДРУГОЙ стороной — закрывает спор:
   * status → settled. Одностороннего выхода из спора нет: спор — это
   * разногласие, снимается только согласием обеих сторон.
   */
  async resolve(params: DebtActorParams): Promise<DebtDto> {
    const { debtId, actorId } = params;
    const debt = await this.prisma.$transaction(async (tx) => {
      const current = await loadDebtForUpdate(tx, debtId);
      assertIsParty(current, actorId, 'Разрешить спор может только кредитор или дебитор');
      assertStatus(current, ['disputed'], 'resolve');

      if (current.resolveRequestedBy === null) {
        // Первое подтверждение: ждём вторую сторону.
        const updated = await tx.debt.update({
          where: { id: debtId },
          data: { resolveRequestedBy: actorId },
          include: DEBT_VIEW_INCLUDE,
        });
        await tx.debtEvent.create({
          data: { debtId, actorId, action: 'resolve_requested' },
        });
        this.logger.log({ debtId, actorId }, 'debt:resolve_requested');
        return updated;
      }

      if (current.resolveRequestedBy === actorId) {
        // Та же сторона подтверждает повторно — это не обоюдность.
        throw new ConflictException(
          'Вы уже подтвердили разрешение. Ждём подтверждения второй стороны.',
        );
      }

      // Вторая сторона подтвердила — спор закрыт обоюдно.
      const firstBy = current.resolveRequestedBy;
      const updated = await tx.debt.update({
        where: { id: debtId },
        data: { status: 'settled', settledAt: new Date(), resolveRequestedBy: null },
        include: DEBT_VIEW_INCLUDE,
      });
      await tx.debtEvent.create({
        data: {
          debtId,
          actorId,
          action: 'resolve_confirmed',
          payload: { firstBy, confirmedBy: actorId },
        },
      });
      this.logTransition(debtId, actorId, 'disputed', 'settled');
      return updated;
    });

    if (debt.status === 'settled') {
      await this.notifications.send({
        userId: debt.creditorId === actorId ? debt.debtorId : debt.creditorId,
        type: 'debt_reminder',
        title: 'Спор по долгу закрыт',
        body: `Обе стороны согласились: долг ${debt.amount.toString()} ₽ отмечен погашенным.`,
        data: { debtId: debt.id },
      });
    } else {
      await this.notifications.send({
        userId: debt.creditorId === actorId ? debt.debtorId : debt.creditorId,
        type: 'debt_reminder',
        title: 'Предложение закрыть спор',
        body: `Вторая сторона предлагает закрыть спор по долгу ${debt.amount.toString()} ₽. Подтвердите, если согласны.`,
        data: { debtId: debt.id },
      });
    }

    // Триггер ADR-013: обоюдное разрешение — нейтральное событие рейтинга.
    await this.reputation.safeOnDebtChanged(debtId);
    return this.toDto(debt, null);
  }

  // ─── Напоминание ──────────────────────────────────────────────────────────

  /**
   * Напоминание дебитору: только кредитор, только active, не чаще
   * одного раза в 24 ч на долг (429 с моментом следующей попытки).
   * Пишет DebtEvent(reminder_sent) и отправляет уведомление.
   */
  async remind(params: ReminderParams): Promise<ReminderResultDto> {
    const { debtId, actorId } = params;
    const cooldownHours = params.cooldownHours ?? this.defaultCooldownHours;
    const cooldownMs = cooldownHours * 60 * 60_000;

    const debt = await this.prisma.$transaction(async (tx) => {
      const current = await loadDebtForUpdate(tx, debtId);
      if (current.creditorId !== actorId) {
        throw new ForbiddenException('Напомнить может только кредитор');
      }
      assertStatus(current, ['active'], 'reminder');

      const last = await tx.debtEvent.findFirst({
        where: { debtId, action: 'reminder_sent' },
        orderBy: { createdAt: 'desc' },
      });
      if (last) {
        const elapsed = Date.now() - last.createdAt.getTime();
        if (elapsed < cooldownMs) {
          const nextReminderAt = new Date(last.createdAt.getTime() + cooldownMs);
          throw new HttpException(
            {
              code: 'DEBT_REMINDER_COOLDOWN',
              message: 'Напоминание уже отправляли — не чаще раза в сутки',
              nextReminderAt: nextReminderAt.toISOString(),
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }

      await tx.debtEvent.create({
        data: { debtId, actorId, action: 'reminder_sent' },
      });
      this.logger.log({ debtId, actorId }, 'debt:reminder_sent');
      return current;
    });

    const sentAt = new Date();
    await this.notifications.send({
      userId: debt.debtorId,
      type: 'debt_reminder',
      title: 'Напоминание о долге',
      body: `${debt.creditor.displayName} напоминает: долг ${debt.amount.toString()} ₽. Уточните возврат напрямую с кредитором.`,
      data: { debtId: debt.id },
    });

    return {
      sentAt: sentAt.toISOString(),
      nextReminderAt: new Date(sentAt.getTime() + cooldownMs).toISOString(),
    };
  }

  // ─── Внутреннее ───────────────────────────────────────────────────────────

  /** Последнее напоминание по каждому долгу из списка (одним запросом). */
  private async findLastReminderAt(
    db: Prisma.TransactionClient | PrismaService,
    debtIds: string[],
  ): Promise<Map<string, Date>> {
    if (debtIds.length === 0) {
      return new Map();
    }
    const events = await db.debtEvent.findMany({
      where: { debtId: { in: debtIds }, action: 'reminder_sent' },
      orderBy: { createdAt: 'desc' },
      select: { debtId: true, createdAt: true },
    });
    const map = new Map<string, Date>();
    for (const event of events) {
      if (!map.has(event.debtId)) {
        map.set(event.debtId, event.createdAt);
      }
    }
    return map;
  }

  /** Prisma-модель → DTO: вычисляем просрочку и доступность напоминания. */
  private toDto(debt: DebtWithParties, lastReminderAt: Date | null): DebtDto {
    const overdueBefore = Date.now() - DEBT_OVERDUE_DAYS * 24 * 60 * 60_000;
    const isOverdue = debt.status === 'active' && debt.createdAt.getTime() <= overdueBefore;

    const cooldownMs = this.defaultCooldownHours * 60 * 60_000;
    const cooldownPassed =
      lastReminderAt === null || Date.now() - lastReminderAt.getTime() >= cooldownMs;
    const canRemind = debt.status === 'active' && cooldownPassed;
    const nextReminderAt =
      debt.status === 'active' && !cooldownPassed && lastReminderAt
        ? new Date(lastReminderAt.getTime() + cooldownMs).toISOString()
        : null;

    return {
      id: debt.id,
      creditorId: debt.creditorId,
      creditorName: debt.creditor.displayName,
      creditorRating: toRatingSummary(debt.creditor.reputation),
      debtorId: debt.debtorId,
      debtorName: debt.debtor.displayName,
      debtorRating: toRatingSummary(debt.debtor.reputation),
      amount: debt.amount.toString(),
      currency: debt.currency,
      description: debt.description,
      listingId: debt.listingId,
      bookingId: debt.bookingId,
      status: debt.status,
      isOverdue,
      canRemind,
      nextReminderAt,
      resolveRequestedById: debt.resolveRequestedBy,
      createdAt: debt.createdAt.toISOString(),
      updatedAt: debt.updatedAt.toISOString(),
      settledAt: debt.settledAt?.toISOString() ?? null,
    };
  }

  private logTransition(
    debtId: string,
    actorId: string | null,
    fromStatus: string,
    toStatus: string,
  ): void {
    this.logger.log({ debtId, actorId, fromStatus, toStatus }, 'debt:status');
  }
}

/* ────────────────────────── Внутренние помощники ────────────────────────── */

/** Загружает долг с именами сторон; 404 если нет. */
async function loadDebtForUpdate(tx: TransactionClient, debtId: string): Promise<DebtWithParties> {
  const debt = await tx.debt.findUnique({ where: { id: debtId }, include: DEBT_VIEW_INCLUDE });
  if (!debt) {
    throw new NotFoundException('Долг не найден');
  }
  return debt;
}

/** Действие доступно только сторонам долга. */
function assertIsParty(debt: DebtWithParties, actorId: string, message: string): void {
  if (debt.creditorId !== actorId && debt.debtorId !== actorId) {
    throw new ForbiddenException(message);
  }
}

/** Строгая проверка перехода: текущий статус ∈ allowed. */
function assertStatus(
  debt: DebtWithParties,
  allowed: DebtStatus[],
  action: string,
): void {
  if (!allowed.includes(debt.status)) {
    throw new ConflictException(
      `Действие «${action}» невозможно из статуса «${debt.status}»`,
    );
  }
}

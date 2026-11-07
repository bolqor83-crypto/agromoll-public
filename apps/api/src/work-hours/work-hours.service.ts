/**
 * Сервис учёта рабочих часов пар «водитель — продавец» (v0.4.0, ADR-011).
 *
 * Это НЕ биллинг и НЕ зарплата — юридическая страховка платформы:
 * самозанятый водитель, работающий 60+ часов в месяц с одним продавцом
 * 6 месяцев подряд, — признак трудовых отношений (289-ФЗ, штраф
 * до 500 тыс. ₽). Платформа считает часы и требует паузу.
 *
 * Модель:
 *  - WorkSession — сырые сессии (start при взятии доставки/задания,
 *    end при подтверждении приёмки, отмене или вручную);
 *  - MonthlyPairTotal — материализованный помесячный счётчик пары
 *    (unique driver+seller+month), monthCounted = ≥ лимита часов;
 *  - BlockedPair — активная блокировка пары: новые сессии → 409
 *    с мягким сообщением (без «вы нарушили закон»). Снятая арбитром
 *    блокировка не удаляется, а помечается unblockedAt — история
 *    разблоков и апелляции — в AppealCase (v0.6.0-E, ADR-035).
 *
 * Серия: цепочка месяцев подряд с monthCounted=true, включая текущий.
 * <60 ч в месяце — серия сбрасывается (история не пересчитывается —
 * старые месяцы уже зафиксированы, ADR-011).
 *
 * Часы атрибутируются месяцу СТАРТА сессии: сессия через границу
 * месяца (23:50 → 00:10) не расщепляется — простота важнее точности
 * на границе, погрешность ≤ одной сессии в месяц.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
// value-import: Prisma.PrismaClientKnownRequestError участвует в instanceof
// (ловим P2002 гонки крона, ADR-035); типы — Prisma.TransactionClient.
import { Prisma } from '@prisma/client';
// value-import: класс участвует в DI (см. ADR-008/v0.3.0 — Function at index).
import { PrismaService } from '../prisma/prisma.service';
import type {
  AppealShortDto,
  WorkHoursCheckDto,
  WorkHoursPairDto,
  WorkHoursSessionDto,
} from '@agromoll/types';
import {
  WORK_HOURS_MONTHLY_LIMIT,
  WORK_MONTHS_SERIES,
  WORK_PAIR_BLOCKED_CODE,
  WORK_PAIR_BLOCKED_MESSAGE,
} from './work-hours.constants';

type TransactionClient = Prisma.TransactionClient;

/** Загрузка сессии с именами сторон. */
const SESSION_VIEW_INCLUDE = {
  driver: { select: { id: true, displayName: true } },
  seller: { select: { id: true, displayName: true } },
} as const satisfies Prisma.WorkSessionInclude;

type SessionWithParties = Prisma.WorkSessionGetPayload<{
  include: typeof SESSION_VIEW_INCLUDE;
}>;

/** «YYYY-MM» по дате (локальное время сервера — МСК ритм рынка). */
export function toMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Сдвиг месяца на delta: addMonths('2026-01', -1) → '2025-12'. */
export function addMonths(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return toMonthKey(new Date(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Текущий месяц сервера. */
function currentMonth(): string {
  return toMonthKey(new Date());
}

@Injectable()
export class WorkHoursService {
  private readonly logger = new Logger(WorkHoursService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WORK_HOURS_MONTHLY_LIMIT) private readonly monthlyLimitHours: number,
    @Inject(WORK_MONTHS_SERIES) private readonly monthsSeries: number,
  ) {}

  private get monthlyLimitMinutes(): number {
    return this.monthlyLimitHours * 60;
  }

  // ─── Сессии ───────────────────────────────────────────────────────────────

  /**
   * Водитель начинает работу с продавцом. Одна открытая сессия на
   * водителя (рынок физически не даёт работать с двумя стендами сразу);
   * заблокированная пара — 409 WORK_PAIR_BLOCKED с мягким сообщением.
   */
  async startSession(driverId: string, sellerId: string): Promise<WorkHoursSessionDto> {
    if (driverId === sellerId) {
      throw new BadRequestException('Нельзя начать смену с самим собой');
    }

    return this.prisma.$transaction(async (tx) => {
      const seller = await tx.user.findUnique({
        where: { id: sellerId },
        select: { id: true, displayName: true },
      });
      if (!seller) {
        throw new NotFoundException('Продавец не найден');
      }

      await assertPairNotBlocked(tx, driverId, sellerId);

      const open = await tx.workSession.findFirst({
        where: { driverId, endedAt: null },
      });
      if (open) {
        throw new ConflictException('У вас уже есть открытая смена — сначала завершите её');
      }

      const now = new Date();
      const session = await tx.workSession.create({
        data: {
          driverId,
          sellerId,
          startedAt: now,
          month: toMonthKey(now),
        },
        include: SESSION_VIEW_INCLUDE,
      });

      this.logger.log({ sessionId: session.id, driverId, sellerId }, 'work-hours:session:start');
      return toSessionDto(session);
    });
  }

  /**
   * Завершение сессии (водитель или продавец пары; подтверждение
   * приёмки в подэтапе C вызывает тот же метод). Идемпотентно:
   * повторное завершение возвращает уже закрытую сессию без ошибок —
   * защита от двойного тапа и гонки «ручное закрытие + приёмка».
   */
  async endSession(sessionId: string, actorId: string): Promise<WorkHoursSessionDto> {
    const session = await this.prisma.$transaction(async (tx) => {
      const current = await tx.workSession.findUnique({
        where: { id: sessionId },
        include: SESSION_VIEW_INCLUDE,
      });
      if (!current) {
        throw new NotFoundException('Сессия не найдена');
      }
      if (current.driverId !== actorId && current.sellerId !== actorId) {
        throw new ForbiddenException('Завершить смену может только водитель или продавец пары');
      }
      if (current.endedAt !== null) {
        return current; // идемпотентность: уже закрыта
      }

      const endedAt = new Date();
      // Любая начатая работа — минимум минута (30-секундная сессия
      // не должна исчезать из статистики).
      const durationMinutes = Math.max(
        1,
        Math.round((endedAt.getTime() - current.startedAt.getTime()) / 60_000),
      );

      const updated = await tx.workSession.update({
        where: { id: sessionId },
        data: { endedAt, durationMinutes },
        include: SESSION_VIEW_INCLUDE,
      });

      await this.addMinutesToPairTotal(
        tx,
        current.driverId,
        current.sellerId,
        current.month,
        durationMinutes,
      );

      this.logger.log(
        { sessionId, driverId: current.driverId, sellerId: current.sellerId, durationMinutes },
        'work-hours:session:end',
      );
      return updated;
    });

    return toSessionDto(session);
  }

  /** Инкремент помесячного счётчика пары + пересчёт monthCounted. */
  private async addMinutesToPairTotal(
    tx: TransactionClient,
    driverId: string,
    sellerId: string,
    month: string,
    minutes: number,
  ): Promise<void> {
    const existing = await tx.monthlyPairTotal.findUnique({
      where: { driverId_sellerId_month: { driverId, sellerId, month } },
    });
    const totalMinutes = (existing?.totalMinutes ?? 0) + minutes;

    await tx.monthlyPairTotal.upsert({
      where: { driverId_sellerId_month: { driverId, sellerId, month } },
      create: {
        driverId,
        sellerId,
        month,
        totalMinutes,
        monthCounted: totalMinutes >= this.monthlyLimitMinutes,
      },
      update: { totalMinutes, monthCounted: totalMinutes >= this.monthlyLimitMinutes },
    });
  }

  /** Открытая сессия пользователя (для экрана «Мои часы»). */
  async findOpenSession(driverId: string): Promise<WorkHoursSessionDto | null> {
    const session = await this.prisma.workSession.findFirst({
      where: { driverId, endedAt: null },
      include: SESSION_VIEW_INCLUDE,
    });
    return session ? toSessionDto(session) : null;
  }

  // ─── Чтения ───────────────────────────────────────────────────────────────

  /**
   * Мои часы за текущий месяц: driver — по каждому продавцу,
   * seller — по каждому водителю. Только просмотр, никаких денег.
   */
  async findMine(userId: string): Promise<WorkHoursPairDto[]> {
    const month = currentMonth();
    const isDriver = await this.hasRole(userId, 'driver');

    const totals = await this.prisma.monthlyPairTotal.findMany({
      where: isDriver ? { driverId: userId, month } : { sellerId: userId, month },
      include: {
        driver: { select: { id: true, displayName: true } },
        seller: { select: { id: true, displayName: true } },
      },
    });

    if (totals.length === 0) {
      return [];
    }

    // Серия месяцев подряд (включая текущий) — одним запросом на все пары.
    const history = await this.prisma.monthlyPairTotal.findMany({
      where: isDriver
        ? { driverId: userId, monthCounted: true }
        : { sellerId: userId, monthCounted: true },
      select: { driverId: true, sellerId: true, month: true },
    });
    const countedMonths = new Map<string, Set<string>>();
    for (const row of history) {
      const key = pairKey(row.driverId, row.sellerId);
      const set = countedMonths.get(key) ?? new Set<string>();
      set.add(row.month);
      countedMonths.set(key, set);
    }

    const blocked = await this.prisma.blockedPair.findMany({
      where: {
        unblockedAt: null,
        ...(isDriver ? { driverId: userId } : { sellerId: userId }),
      },
      select: { id: true, driverId: true, sellerId: true },
    });
    const blockByPair = new Map(blocked.map((b) => [pairKey(b.driverId, b.sellerId), b] as const));

    // Активные апелляции на эти блокировки (ADR-035): бейдж «обжалуется»
    // в строке пары + блокировка кнопки повторной подачи.
    const appealByBlockId = new Map<string, AppealShortDto>();
    if (blocked.length > 0) {
      const appeals = await this.prisma.appealCase.findMany({
        where: {
          blockedPairId: { in: blocked.map((b) => b.id) },
          status: { in: ['open', 'under_review'] },
        },
        select: { id: true, blockedPairId: true, status: true },
        orderBy: { openedAt: 'desc' },
      });
      for (const appeal of appeals) {
        if (!appealByBlockId.has(appeal.blockedPairId)) {
          appealByBlockId.set(appeal.blockedPairId, {
            id: appeal.id,
            status: appeal.status,
          });
        }
      }
    }

    const openSession = await this.prisma.workSession.findFirst({
      where: isDriver ? { driverId: userId, endedAt: null } : { sellerId: userId, endedAt: null },
      select: { id: true, driverId: true, sellerId: true },
    });

    return totals.map((total) => {
      const counterpart = isDriver ? total.seller : total.driver;
      const key = pairKey(total.driverId, total.sellerId);
      const openForPair =
        openSession && pairKey(openSession.driverId, openSession.sellerId) === key;
      const block = blockByPair.get(key) ?? null;
      return {
        counterpartId: counterpart.id,
        counterpartName: counterpart.displayName,
        month,
        totalMinutes: total.totalMinutes,
        monthCounted: total.monthCounted,
        series: countSeries(countedMonths.get(key), month),
        blocked: block !== null,
        blockedPairId: block?.id ?? null,
        appeal: block ? (appealByBlockId.get(block.id) ?? null) : null,
        activeSessionId: openForPair ? openSession.id : null,
      };
    });
  }

  /**
   * Можно ли паре работать (перед взятием доставки/задания):
   * блокировка + текущие часы + серия — всё, что нужно UI для мягких
   * предупреждений («близки к лимиту»).
   */
  async checkPair(driverId: string, sellerId: string): Promise<WorkHoursCheckDto> {
    const month = currentMonth();
    const [total, blocked] = await Promise.all([
      this.prisma.monthlyPairTotal.findUnique({
        where: { driverId_sellerId_month: { driverId, sellerId, month } },
      }),
      // Активная блокировка: снятая арбитром (ADR-035) не считается.
      this.prisma.blockedPair.findFirst({
        where: { driverId, sellerId, unblockedAt: null },
      }),
    ]);

    const counted = await this.prisma.monthlyPairTotal.findMany({
      where: { driverId, sellerId, monthCounted: true },
      select: { month: true },
    });

    return {
      driverId,
      sellerId,
      blocked: blocked !== null,
      reason: blocked?.reason ?? null,
      unblockAt: blocked?.unblockAt?.toISOString() ?? null,
      totalMinutesCurrent: total?.totalMinutes ?? 0,
      monthCounted: total?.monthCounted ?? false,
      series: countSeries(new Set(counted.map((c) => c.month)), month),
    };
  }

  // ─── Крон серии ───────────────────────────────────────────────────────────

  /**
   * Ежедневная проверка серий (03:00): пары с monthCounted=true в текущем
   * месяце, у которых SERIES−1 предыдущих месяцев тоже counted, —
   * блокируются. Вызывается кроном; тесты дергают напрямую с фиксированным
   * месяцем. Возвращает количество созданных блокировок.
   */
  async enforceSeriesLimit(monthArg?: string): Promise<number> {
    const month = monthArg ?? currentMonth();
    const currentCounted = await this.prisma.monthlyPairTotal.findMany({
      where: { month, monthCounted: true },
      select: { driverId: true, sellerId: true },
    });

    let created = 0;
    for (const pair of currentCounted) {
      const months = await this.prisma.monthlyPairTotal.findMany({
        where: { driverId: pair.driverId, sellerId: pair.sellerId, monthCounted: true },
        select: { month: true },
      });
      const countedSet = new Set(months.map((m) => m.month));
      if (!isSeriesComplete(countedSet, month, this.monthsSeries)) {
        continue;
      }

      // Активная блокировка одна на пару (частичный unique, ADR-035).
      const blockedNow = await this.blockPairIfNotBlocked(pair.driverId, pair.sellerId);
      if (blockedNow) {
        created += 1;
        this.logger.warn(
          { driverId: pair.driverId, sellerId: pair.sellerId, month, series: this.monthsSeries },
          'work-hours:pair blocked (289-ФЗ, серия месяцев закрыта)',
        );
      }
    }

    if (created > 0) {
      this.logger.log({ month, created }, 'work-hours:series enforced');
    }
    return created;
  }

  /**
   * Проверка серии 289-ФЗ для ОДНОЙ пары (v0.5.0-C, ADR-015):
   * вызывается после закрытия смены при завершении/отмене доставки,
   * чтобы блокировка создавалась сразу, не дожидаясь крона 03:00.
   * Возвращает true, если блокировка создана.
   */
  async enforceSeriesForPair(driverId: string, sellerId: string): Promise<boolean> {
    const month = currentMonth();
    const current = await this.prisma.monthlyPairTotal.findUnique({
      where: { driverId_sellerId_month: { driverId, sellerId, month } },
      select: { monthCounted: true },
    });
    if (!current?.monthCounted) {
      return false;
    }
    const months = await this.prisma.monthlyPairTotal.findMany({
      where: { driverId, sellerId, monthCounted: true },
      select: { month: true },
    });
    if (!isSeriesComplete(new Set(months.map((m) => m.month)), month, this.monthsSeries)) {
      return false;
    }
    const blockedNow = await this.blockPairIfNotBlocked(driverId, sellerId);
    if (blockedNow) {
      this.logger.warn(
        { driverId, sellerId, month, series: this.monthsSeries },
        'work-hours:pair blocked after delivery (289-ФЗ, серия закрыта)',
      );
    }
    return blockedNow;
  }

  /**
   * Заблокировать пару, если активной блокировки нет (крон серий и
   * закрывающая проверка доставки). Возвращает true, если пара стала
   * заблокированной СЕЙЧАС.
   *
   * Снятая арбитром блокировка (ADR-035) «оживляется»: та же строка
   * получает свежий blockedAt/reason, unblockedAt сбрасывается —
   * истории разблоков в AppealCase ничего не теряется. Если строки
   * нет вовсе — создаём. Гонку двух параллельных кронов ловит
   * частичный unique-индекс (P2002 → «уже заблокирована», не ошибка).
   */
  private async blockPairIfNotBlocked(driverId: string, sellerId: string): Promise<boolean> {
    const active = await this.prisma.blockedPair.findFirst({
      where: { driverId, sellerId, unblockedAt: null },
      select: { id: true },
    });
    if (active) {
      return false;
    }

    const latest = await this.prisma.blockedPair.findFirst({
      where: { driverId, sellerId },
      orderBy: { blockedAt: 'desc' },
      select: { id: true },
    });
    const data = {
      unblockedAt: null,
      unblockedById: null,
      unblockReason: null,
      blockedAt: new Date(),
      reason: WORK_PAIR_BLOCKED_MESSAGE,
    };

    try {
      if (latest) {
        await this.prisma.blockedPair.update({ where: { id: latest.id }, data });
      } else {
        await this.prisma.blockedPair.create({
          data: { driverId, sellerId, reason: WORK_PAIR_BLOCKED_MESSAGE },
        });
      }
      return true;
    } catch (error) {
      // Параллельный крон заблокировал пару мгновением раньше —
      // это успех, а не ошибка (крон идемпотентен).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }

  /** Есть ли у пользователя роль (роли переключаемые — смотрим текущую). */
  private async hasRole(userId: string, role: 'driver' | 'seller'): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return user?.role === role;
  }
}

/* ────────────────────────── Внутренние помощники ────────────────────────── */

/** Ключ пары для множеств. */
function pairKey(driverId: string, sellerId: string): string {
  return `${driverId}:${sellerId}`;
}

/**
 * Длина цепочки месяцев подряд с counted=true, заканчивающейся в month
 * (включая сам month, если он counted). <60 ч в месяце — цепочка
 * обрывается: серия сброшена.
 */
function countSeries(counted: Set<string> | undefined, month: string): number {
  if (!counted) {
    return 0;
  }
  let series = 0;
  let cursor = month;
  while (counted.has(cursor)) {
    series += 1;
    cursor = addMonths(cursor, -1);
  }
  return series;
}

/** Полная ли серия: month и SERIES−1 предыдущих — все counted. */
function isSeriesComplete(counted: Set<string>, month: string, seriesLength: number): boolean {
  let cursor = month;
  for (let i = 0; i < seriesLength; i += 1) {
    if (!counted.has(cursor)) {
      return false;
    }
    cursor = addMonths(cursor, -1);
  }
  return true;
}

/** Пара заблокирована? → 409 с кодом и мягким сообщением (fail-closed).
 *  Считаем только АКТИВНУЮ блокировку: снятая арбитром (ADR-035)
 *  пару работать не мешает. */
async function assertPairNotBlocked(
  tx: TransactionClient,
  driverId: string,
  sellerId: string,
): Promise<void> {
  const blocked = await tx.blockedPair.findFirst({
    where: { driverId, sellerId, unblockedAt: null },
  });
  if (blocked && (blocked.unblockAt === null || blocked.unblockAt.getTime() > Date.now())) {
    throw new ConflictException({
      code: WORK_PAIR_BLOCKED_CODE,
      message: blocked.reason || WORK_PAIR_BLOCKED_MESSAGE,
    });
  }
}

/** Prisma-модель сессии → DTO (ISO-даты). */
function toSessionDto(session: SessionWithParties): WorkHoursSessionDto {
  return {
    id: session.id,
    driverId: session.driverId,
    driverName: session.driver.displayName,
    sellerId: session.sellerId,
    sellerName: session.seller.displayName,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    durationMinutes: session.durationMinutes,
    month: session.month,
  };
}

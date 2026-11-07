/**
 * Сервис публичного рейтинга (v0.5.0, подэтап A, ADR-013).
 *
 * Рейтинг — производная величина от append-only журналов BookingEvent
 * и DebtEvent (источник правды). ReputationSnapshot — материализованный
 * снимок для быстрого чтения, ReputationEvent — человекочитаемый аудит.
 *
 * Формула (простая и объяснимая):
 *
 *   score = 5 × (Σpositive − Σnegative) / Σevents,   кламп в [0, 5]
 *
 * Каждое учтённое событие — одна единица данных в знаменателе;
 * Σevents ≥ RATING_MIN_DEALS — иначе score = null (новичков не
 * наказываем отсутствием цифры).
 * Веса (ENV, значения по умолчанию — спецификация v0.5.0-A):
 *   - сделка ok              → +1.0 (явное подтверждение приёмки)
 *   - сделка minor_issue     → +0.5
 *   - авто-подтверждение     → +0.3 (покупатель не участвовал)
 *   - спор                   → −1.0
 *   - спор разрешён обоюдно  → 0 (нейтрально: события спора исключаются)
 *   - погашенный долг        → +1.0 (надёжность оплаты дебитора)
 *
 * Анти-накрутка: если пара «покупатель — продавец» совершила больше
 * RATING_MAX_PAIR_DEALS сделок за RATING_PAIR_WINDOW_DAYS дней, все
 * сделки пары в окне считаются с весом RATING_PAIR_CAP_WEIGHT —
 * «дружеские» накрутки почти не двигают score.
 *
 * Порог: если суммарный вес событий < RATING_MIN_DEALS — score = null
 * (новичков не наказываем отсутствием рейтинга).
 *
 * Пересчёт НЕ блокирует бизнес-операцию (ADR-013): триггеры вызывают
 * safeOnBookingDelivery / safeOnDebtChanged ПОСЛЕ фиксации транзакции
 * сделки; упавший пересчёт логируется и догоняется следующим событием
 * (пересчёт идемпотентен — пересчитывает историю целиком).
 */
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { BookingEvent, DebtEvent } from '@prisma/client';
import type { MyReputationDto, ReputationDto, ReputationEventDto } from '@agromoll/types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { REPUTATION_PUSH_THRESHOLD } from '../notifications/notifications.constants';
import {
  RATING_MAX_PAIR_DEALS,
  RATING_MIN_DEALS,
  RATING_MIN_DEALS_REASON,
  RATING_PAIR_CAP_WEIGHT,
  RATING_PAIR_WINDOW_DAYS,
  RATING_WEIGHT_ARBITRATION_COMPROMISE,
  RATING_WEIGHT_ARBITRATION_LOSS,
  RATING_WEIGHT_AUTO,
  RATING_WEIGHT_DISPUTE,
  RATING_WEIGHT_MINOR,
  RATING_WEIGHT_OK,
} from './reputation.constants';

/** Результат вычисления рейтинга из журналов (без записи в БД). */
export interface RatingComputation {
  score: number | null;
  dealsCount: number;
  disputesCount: number;
  autoConfirmedCount: number;
  /** Число учтённых событий (порог RATING_MIN_DEALS). */
  totalWeight: number;
}

/** Внутреннее представление учтённого события с весами. */
interface WeightedEvent {
  /** Положительная часть веса (0…1): вклад в числитель score. */
  positive: number;
  /** Абсолютная отрицательная часть веса (0…1). */
  negative: number;
  kind: 'deal' | 'auto' | 'dispute';
  /** Ключ пары «buyerId|sellerId» — для анти-накрутки. */
  pairKey: string;
  createdAt: Date;
}

/** Закрытый кейс арбитража для расчёта штрафа (v0.6.0-C, ADR-033). */
export interface ArbitrationCaseView {
  resolution: 'favor_buyer' | 'favor_seller' | 'compromise' | 'no_fault' | null;
  firstPartyId: string;
  secondPartyId: string;
  resolvedAt: Date | null;
}

/** Штраф арбитража для конкретного пользователя (0 — не затронут). */
export function arbitrationPenalty(
  userId: string,
  arbitrationCase: ArbitrationCaseView,
  weightLoss: number,
  weightCompromise: number,
): number {
  const { resolution } = arbitrationCase;
  if (resolution === 'favor_buyer') {
    return arbitrationCase.secondPartyId === userId ? weightLoss : 0;
  }
  if (resolution === 'favor_seller') {
    return arbitrationCase.firstPartyId === userId ? weightLoss : 0;
  }
  if (resolution === 'compromise') {
    return (
      arbitrationCase.firstPartyId === userId || arbitrationCase.secondPartyId === userId
        ? weightCompromise
        : 0
    );
  }
  // no_fault / dismissed — вины нет, штрафа нет.
  return 0;
}

/** Число учитываемых событий журнала в ответе /reputation/me. */
const MY_EVENTS_TAKE = 20;

/** Округление score до 0.1 — «4.7» на бейдже, без хвостов float. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

@Injectable()
export class ReputationService {
  private readonly logger = new Logger(ReputationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(RATING_MIN_DEALS) private readonly minDeals: number,
    @Inject(RATING_MAX_PAIR_DEALS) private readonly maxPairDeals: number,
    @Inject(RATING_PAIR_WINDOW_DAYS) private readonly pairWindowDays: number,
    @Inject(RATING_WEIGHT_OK) private readonly weightOk: number,
    @Inject(RATING_WEIGHT_MINOR) private readonly weightMinor: number,
    @Inject(RATING_WEIGHT_AUTO) private readonly weightAuto: number,
    @Inject(RATING_WEIGHT_DISPUTE) private readonly weightDispute: number,
    @Inject(RATING_PAIR_CAP_WEIGHT) private readonly pairCapWeight: number,
    @Inject(RATING_WEIGHT_ARBITRATION_LOSS) private readonly weightArbitrationLoss: number,
    @Inject(RATING_WEIGHT_ARBITRATION_COMPROMISE)
    private readonly weightArbitrationCompromise: number,
  ) {}

  // ─── Вычисление из журналов (чистая функция над загруженными событиями) ──

  /**
   * Пересчитать рейтинг пользователя из BookingEvent + DebtEvent.
   * Не пишет в БД — используется и для снимка, и для чтения «на лету».
   */
  async computeForUser(userId: string): Promise<RatingComputation> {
    const [bookingEvents, debtEvents, arbitrationCases] = await Promise.all([
      this.prisma.bookingEvent.findMany({
        where: {
          action: { in: ['delivery_confirmed', 'delivery_disputed', 'system_auto_confirmed'] },
          booking: { OR: [{ buyerId: userId }, { listing: { sellerId: userId } }] },
        },
        include: { booking: { include: { listing: { select: { sellerId: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.debtEvent.findMany({
        where: {
          action: { in: ['settled', 'disputed', 'resolve_confirmed'] },
          debt: { debtorId: userId },
        },
        orderBy: { createdAt: 'asc' },
      }),
      // Решения арбитража против пользователя (v0.6.0-C, ADR-033).
      this.prisma.disputeCase.findMany({
        where: {
          status: 'resolved',
          resolution: { in: ['favor_buyer', 'favor_seller', 'compromise'] },
          OR: [{ firstPartyId: userId }, { secondPartyId: userId }],
        },
        select: { resolution: true, firstPartyId: true, secondPartyId: true, resolvedAt: true },
        orderBy: { resolvedAt: 'asc' },
      }),
    ]);

    return this.computeFromEvents(userId, bookingEvents, debtEvents, arbitrationCases);
  }

  /** Чистое вычисление по загруженным событиям — ядро, тестируется unit-ами. */
  computeFromEvents(
    userId: string,
    bookingEvents: Array<
      BookingEvent & { booking: { buyerId: string; listing: { sellerId: string } } }
    >,
    debtEvents: Array<Pick<DebtEvent, 'debtId' | 'action'>>,
    arbitrationCases: Array<ArbitrationCaseView> = [],
  ): RatingComputation {
    const weighted: WeightedEvent[] = [];

    for (const event of bookingEvents) {
      const isSeller = event.booking.listing.sellerId === userId;
      const pairKey = `${event.booking.buyerId}|${event.booking.listing.sellerId}`;
      const flag = (event.payload as { qualityFlag?: string } | null)?.qualityFlag ?? 'ok';

      if (event.action === 'delivery_disputed') {
        // Спор по качеству — претензия к продавцу. Покупатель нейтрален:
        // он заявил проблему, участие в сделке ему не в зачёт и не в минус.
        if (isSeller) {
          weighted.push({
            positive: 0,
            negative: this.weightDispute,
            kind: 'dispute',
            pairKey,
            createdAt: event.createdAt,
          });
        }
        continue;
      }

      if (event.action === 'system_auto_confirmed') {
        // Авто-подтверждение: обе стороны завершили сделку пассивно.
        weighted.push({
          positive: this.weightAuto,
          negative: 0,
          kind: 'auto',
          pairKey,
          createdAt: event.createdAt,
        });
        continue;
      }

      // delivery_confirmed: продавцу — вес по качеству поставки,
      // покупателю — полный вес (сделку довёл до конца, подтвердил).
      weighted.push({
        positive: isSeller
          ? flag === 'minor_issue'
            ? this.weightMinor
            : this.weightOk
          : this.weightOk,
        negative: 0,
        kind: 'deal',
        pairKey,
        createdAt: event.createdAt,
      });
    }

    // Анти-накрутка: сделки одной пары в окне сверх лимита — вес 0.3.
    const windowStart = Date.now() - this.pairWindowDays * 24 * 3_600_000;
    const pairCounts = new Map<string, number>();
    for (const event of weighted) {
      if (event.kind !== 'dispute' && event.createdAt.getTime() >= windowStart) {
        pairCounts.set(event.pairKey, (pairCounts.get(event.pairKey) ?? 0) + 1);
      }
    }
    for (const event of weighted) {
      if (
        event.kind !== 'dispute' &&
        event.createdAt.getTime() >= windowStart &&
        (pairCounts.get(event.pairKey) ?? 0) > this.maxPairDeals
      ) {
        event.positive = Math.min(event.positive, this.pairCapWeight);
      }
    }

    // Долги: надёжность оплаты дебитора. Спор, разрешённый обоюдно,
    // нейтрален — исключаем его отрицательный вес (стороны договорились).
    const resolvedDebtIds = new Set(
      debtEvents.filter((e) => e.action === 'resolve_confirmed').map((e) => e.debtId),
    );

    let positive = 0;
    let negative = 0;
    let total = 0;
    let dealsCount = 0;
    let disputesCount = 0;
    let autoConfirmedCount = 0;

    for (const event of weighted) {
      positive += event.positive;
      negative += event.negative;
      // Каждое учтённое событие — одна «единица данных»: порог
      // RATING_MIN_DEALS считает события, а не сумму весов (ADR-013).
      total += 1;
      if (event.kind === 'deal') dealsCount += 1;
      if (event.kind === 'auto') autoConfirmedCount += 1;
      if (event.kind === 'dispute') disputesCount += 1;
    }

    for (const event of debtEvents) {
      if (event.action === 'settled') {
        // Погашение без спора — дебитор надёжен.
        positive += this.weightOk;
        total += 1;
      } else if (event.action === 'disputed' && !resolvedDebtIds.has(event.debtId)) {
        // Незакрытый спор по долгу — минус дебитору.
        negative += this.weightDispute;
        total += 1;
        disputesCount += 1;
      }
      // resolve_confirmed — нейтрально: спор снят согласием сторон.
    }

    // Решения арбитража (v0.6.0-C, ADR-033): штраф виновному. Кейс —
    // одна единица данных в знаменателе, как и другие события спора.
    for (const arbitrationCase of arbitrationCases) {
      const penalty = arbitrationPenalty(
        userId,
        arbitrationCase,
        this.weightArbitrationLoss,
        this.weightArbitrationCompromise,
      );
      if (penalty > 0) {
        negative += penalty;
        total += 1;
        disputesCount += 1;
      }
    }

    const score =
      total < this.minDeals
        ? null
        : round1(Math.min(5, Math.max(0, (5 * (positive - negative)) / total)));

    return { score, dealsCount, disputesCount, autoConfirmedCount, totalWeight: total };
  }

  // ─── Снимок ───────────────────────────────────────────────────────────────

  /** Пересчитать и сохранить снимок (атомарный upsert, отдельная транзакция). */
  async recalculate(userId: string): Promise<RatingComputation> {
    const computed = await this.computeForUser(userId);
    // Порог для мягкого уведомления (ADR-031): пересечение 3.0 сверху вниз.
    // Сравниваем ДО upsert — прошлый снимок ещё в БД.
    const previous = await this.prisma.reputationSnapshot.findUnique({
      where: { userId },
      select: { score: true },
    });
    await this.prisma.reputationSnapshot.upsert({
      where: { userId },
      create: {
        userId,
        score: computed.score,
        dealsCount: computed.dealsCount,
        disputesCount: computed.disputesCount,
        autoConfirmedCount: computed.autoConfirmedCount,
        lastCalculatedAt: new Date(),
      },
      update: {
        score: computed.score,
        dealsCount: computed.dealsCount,
        disputesCount: computed.disputesCount,
        autoConfirmedCount: computed.autoConfirmedCount,
        lastCalculatedAt: new Date(),
      },
    });

    // Мягкое «Обратите внимание на качество» — только при ПЕРЕСЕЧЕНИИ
    // порога (было ≥ 3.0, стало < 3.0): дальнейшие падения молчат,
    // повторные уведомления — спам (ADR-031).
    const previousScore = previous?.score ?? null;
    if (
      computed.score !== null &&
      computed.score < REPUTATION_PUSH_THRESHOLD &&
      previousScore !== null &&
      previousScore >= REPUTATION_PUSH_THRESHOLD
    ) {
      await this.notifications.send({
        userId,
        type: 'reputation_score_dropped',
        title: 'Рейтинг снизился',
        body: `Ваш рейтинг опустился ниже ${REPUTATION_PUSH_THRESHOLD.toFixed(1)}. Обратите внимание на качество сделок — как его поднять, смотрите в «Моём рейтинге».`,
        data: {},
      });
    }
    return computed;
  }

  // ─── Триггеры (вызываются ПОСЛЕ фиксации бизнес-транзакции) ───────────────

  /**
   * Приёмка состоялась (delivery_confirmed / delivery_disputed /
   * system_auto_confirmed): записать события журнала рейтинга обеим
   * сторонам и пересчитать снимки. НЕ бросает — сбой пересчёта не
   * откатывает сделку (ADR-013).
   */
  async safeOnBookingDelivery(bookingId: string): Promise<void> {
    try {
      const booking = await this.prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: {
          buyerId: true,
          listing: { select: { sellerId: true } },
          events: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      const last = booking.events[0];
      if (!last) {
        return;
      }
      const sellerId = booking.listing.sellerId;
      const buyerId = booking.buyerId;
      const flag = (last.payload as { qualityFlag?: string } | null)?.qualityFlag ?? 'ok';

      if (last.action === 'delivery_disputed') {
        await this.prisma.reputationEvent.create({
          data: {
            userId: sellerId,
            action: 'dispute_opened',
            delta: -this.weightDispute,
            reason: 'delivery_disputed',
          },
        });
      } else if (last.action === 'system_auto_confirmed') {
        for (const userId of [sellerId, buyerId]) {
          await this.prisma.reputationEvent.create({
            data: {
              userId,
              action: 'auto_confirmed',
              delta: this.weightAuto,
              reason: 'auto_confirm',
            },
          });
        }
      } else if (last.action === 'delivery_confirmed') {
        await this.prisma.reputationEvent.create({
          data: {
            userId: sellerId,
            action: 'deal_confirmed',
            delta: flag === 'minor_issue' ? this.weightMinor : this.weightOk,
            reason: flag,
          },
        });
        await this.prisma.reputationEvent.create({
          data: {
            userId: buyerId,
            action: 'deal_confirmed',
            delta: this.weightOk,
            reason: 'buyer_accepted',
          },
        });
      }

      // Анти-накрутка: фиксируем в журнале, что пара превысила лимит
      // сделок в окне — её сделки считаются с пониженным весом.
      const pairCount = await this.countPairDealsInWindow(buyerId, sellerId);
      if (pairCount > this.maxPairDeals) {
        for (const userId of [sellerId, buyerId]) {
          await this.prisma.reputationEvent.create({
            data: {
              userId,
              action: 'penalty_applied',
              delta: this.pairCapWeight - this.weightOk,
              reason: 'pair_deals_capped',
            },
          });
        }
      }

      await this.recalculate(sellerId);
      await this.recalculate(buyerId);
    } catch (error) {
      this.logger.error(
        { bookingId, err: error },
        'reputation: пересчёт после приёмки не удался (сделка не затронута)',
      );
    }
  }

  /**
   * Изменился долг (settled / disputed / resolve_confirmed): события
   * журнала рейтинга дебитору + пересчёт его снимка. НЕ бросает (ADR-013).
   */
  async safeOnDebtChanged(debtId: string): Promise<void> {
    try {
      const debt = await this.prisma.debt.findUniqueOrThrow({
        where: { id: debtId },
        select: {
          debtorId: true,
          events: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      const last = debt.events[0];
      if (!last) {
        return;
      }

      if (last.action === 'settled') {
        await this.prisma.reputationEvent.create({
          data: {
            userId: debt.debtorId,
            action: 'deal_confirmed',
            delta: this.weightOk,
            reason: 'debt_settled',
          },
        });
      } else if (last.action === 'disputed') {
        await this.prisma.reputationEvent.create({
          data: {
            userId: debt.debtorId,
            action: 'dispute_opened',
            delta: -this.weightDispute,
            reason: 'debt_disputed',
          },
        });
      } else if (last.action === 'resolve_confirmed') {
        await this.prisma.reputationEvent.create({
          data: {
            userId: debt.debtorId,
            action: 'dispute_resolved',
            delta: 0,
            reason: 'debt_resolved_mutually',
          },
        });
      }

      await this.recalculate(debt.debtorId);
    } catch (error) {
      this.logger.error(
        { debtId, err: error },
        'reputation: пересчёт после события долга не удался (долг не затронут)',
      );
    }
  }

  /**
   * Кейс арбитража закрыт (v0.6.0-C, ADR-033): записать штрафы в журнал
   * рейтинга и пересчитать снимки сторон. Вызывается DisputesService
   * ПОСЛЕ транзакции решения; НЕ бросает — сбой пересчёта не откатывает
   * решение арбитра (счёт догонит следующий триггер, штрафы считаются
   * из закрытых кейсов идемпотентно).
   */
  async safeOnDisputeResolved(arbitrationCase: ArbitrationCaseView & { id: string }): Promise<void> {
    const affected = [arbitrationCase.firstPartyId, arbitrationCase.secondPartyId];
    try {
      for (const userId of affected) {
        const penalty = arbitrationPenalty(
          userId,
          arbitrationCase,
          this.weightArbitrationLoss,
          this.weightArbitrationCompromise,
        );
        if (penalty > 0) {
          await this.prisma.reputationEvent.create({
            data: {
              userId,
              action: 'penalty_applied',
              delta: -penalty,
              reason: `arbitration:${arbitrationCase.resolution}`,
            },
          });
        }
        await this.recalculate(userId);
      }
    } catch (error) {
      this.logger.error(
        { disputeId: arbitrationCase.id, err: error },
        'reputation: пересчёт после решения арбитража не удался (решение не затронуто)',
      );
    }
  }

  /** Сколько завершённых сделок у пары за окно анти-накрутки. */
  private async countPairDealsInWindow(buyerId: string, sellerId: string): Promise<number> {
    const windowStart = new Date(Date.now() - this.pairWindowDays * 24 * 3_600_000);
    return this.prisma.bookingEvent.count({
      where: {
        action: { in: ['delivery_confirmed', 'system_auto_confirmed'] },
        createdAt: { gte: windowStart },
        booking: { buyerId, listing: { sellerId } },
      },
    });
  }

  // ─── Чтение (API) ─────────────────────────────────────────────────────────

  /** Публичный профиль рейтинга: снимок, при отсутствии — расчёт на лету. */
  async getPublicProfile(userId: string): Promise<ReputationDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    const snapshot = await this.prisma.reputationSnapshot.findUnique({ where: { userId } });
    if (snapshot) {
      return {
        userId,
        score: snapshot.score,
        ...(snapshot.score === null ? { reason: RATING_MIN_DEALS_REASON } : {}),
        dealsCount: snapshot.dealsCount,
        disputesCount: snapshot.disputesCount,
        autoConfirmedCount: snapshot.autoConfirmedCount,
        lastCalculatedAt: snapshot.lastCalculatedAt.toISOString(),
      };
    }

    // Снимка ещё нет (события не триггерили пересчёт) — считаем без записи.
    const computed = await this.computeForUser(userId);
    return {
      userId,
      score: computed.score,
      ...(computed.score === null ? { reason: RATING_MIN_DEALS_REASON } : {}),
      dealsCount: computed.dealsCount,
      disputesCount: computed.disputesCount,
      autoConfirmedCount: computed.autoConfirmedCount,
      lastCalculatedAt: null,
    };
  }

  /** Мой рейтинг: свежий расчёт + подсказка прогресса + журнал (ADR-013). */
  async getMyProfile(userId: string): Promise<MyReputationDto> {
    const [computed, events] = await Promise.all([
      this.computeForUser(userId),
      this.prisma.reputationEvent.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: MY_EVENTS_TAKE,
      }),
    ]);

    const dealsToRating =
      computed.score === null ? Math.max(0, Math.ceil(this.minDeals - computed.totalWeight)) : 0;

    return {
      userId,
      score: computed.score,
      ...(computed.score === null ? { reason: RATING_MIN_DEALS_REASON } : {}),
      dealsCount: computed.dealsCount,
      disputesCount: computed.disputesCount,
      autoConfirmedCount: computed.autoConfirmedCount,
      lastCalculatedAt: new Date().toISOString(),
      dealsToRating,
      events: events.map(toReputationEventDto),
    };
  }
}

/** Prisma-строка журнала → DTO. */
export function toReputationEventDto(event: {
  id: string;
  action:
    'deal_confirmed' | 'dispute_opened' | 'dispute_resolved' | 'auto_confirmed' | 'penalty_applied';
  delta: number;
  reason: string | null;
  createdAt: Date;
}): ReputationEventDto {
  return {
    id: event.id,
    action: event.action,
    delta: event.delta,
    reason: event.reason,
    createdAt: event.createdAt.toISOString(),
  };
}

/**
 * Сервис брони — доменное ядро v0.2.0; v0.4.0-C — приёмка (ADR-012).
 *
 * Здесь живёт машина состояний брони (см. docs/adr/ADR-004 + ADR-012):
 *
 *   requested ──(seller)──► counter_offered ──(buyer)──► confirmed ──(buyer, confirm-delivery)──► completed
 *      │  │                       │  │                       │
 *      │  └──(seller)──► confirmed│  └─(любая сторона)─► cancelled  └─(buyer, major_issue)─► disputed
 *      └─(любая сторона)─► cancelled
 *
 *   requested / counter_offered ──(cron, истёк TTL)──► expired
 *   confirmed ──(cron, 24 ч без приёмки, ADR-012)──► completed (system_auto_confirmed)
 *
 * completed — терминальный: отменить нельзя. disputed — спор по качеству
 * (арбитраж — v0.5.0). Правила целостности остатков — ниже (ADR-004).
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
import type { Booking, Prisma } from '@prisma/client';
import type { BookingDto, BookingStatus, QualityFlag } from '@agromoll/types';
import { PrismaService } from '../prisma/prisma.service';
import { toBookingDto } from '../common/serialization';
import { BOOKING_TTL_MINUTES } from './bookings.constants';
import { BOOKING_AUTO_CONFIRM_HOURS } from './bookings.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkHoursService } from '../work-hours/work-hours.service';
import { ReputationService } from '../reputation/reputation.service';

type TransactionClient = Prisma.TransactionClient;

/** Include для списков броней: название/единица лота, имя покупателя
 *  и рейтинги сторон для бейджа контрагента (ADR-013). */
const BOOKING_LIST_VIEW_INCLUDE = {
  listing: {
    select: {
      title: true,
      unit: true,
      seller: { select: { reputation: { select: { score: true, dealsCount: true } } } },
    },
  },
  buyer: {
    select: {
      displayName: true,
      reputation: { select: { score: true, dealsCount: true } },
    },
  },
} as const satisfies Prisma.BookingInclude;

/** Загрузка брони вместе с лотами — для проверок ролей и остатков. */
const BOOKING_WITH_LISTING_INCLUDE = {
  listing: {
    select: {
      id: true,
      sellerId: true,
      title: true,
      unit: true,
      status: true,
      quantityAvailable: true,
      quantityReserved: true,
    },
  },
} as const satisfies Prisma.BookingInclude;

type BookingWithListing = Prisma.BookingGetPayload<{
  include: typeof BOOKING_WITH_LISTING_INCLUDE;
}>;

export interface CreateBookingParams {
  listingId: string;
  buyerId: string;
  requestedQuantity: number;
  /** Переопределить TTL для этой брони (в минутах). По умолчанию — из ENV. */
  ttlMinutes?: number;
}

export interface CounterOfferParams {
  bookingId: string;
  /** Только продавец лота, связанного с бронью. */
  actorId: string;
  /** Предлагаемое количество (может отличаться от запрошенного). */
  offeredQuantity?: number;
  /** Предлагаемое время/условия выкупа — свободной строкой. */
  pickupTime?: string;
  note?: string;
}

export interface AcceptCounterParams {
  bookingId: string;
  /** Только покупатель, создавший бронь. */
  actorId: string;
}

export interface ConfirmParams {
  bookingId: string;
  /** Только продавец лота. */
  actorId: string;
}

export interface CancelParams {
  bookingId: string;
  /** Покупатель брони или продавец лота. */
  actorId: string;
  reason?: string;
}

export interface ConfirmDeliveryParams {
  bookingId: string;
  /** Только покупатель брони (ADR-012). */
  actorId: string;
  /** Фактически полученное количество. */
  receivedQuantity: number;
  qualityFlag?: QualityFlag;
  qualityNotes?: string;
}

/** Поле payload корректировки в журнале. */
interface CounterOfferPayload {
  offeredQuantity?: number;
  pickupTime?: string;
  note?: string;
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BOOKING_TTL_MINUTES) private readonly defaultTtlMinutes: number,
    @Inject(BOOKING_AUTO_CONFIRM_HOURS) private readonly autoConfirmHours: number,
    private readonly notifications: NotificationsService,
    private readonly workHours: WorkHoursService,
    private readonly reputation: ReputationService,
  ) {}

  /** Покупатель запрашивает бронь. Резервирует количество атомарно. */
  async create(params: CreateBookingParams): Promise<Booking> {
    const { listingId, buyerId, requestedQuantity } = params;
    if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) {
      throw new BadRequestException('Количество должно быть целым положительным числом');
    }

    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.listing.findUnique({ where: { id: listingId } });
      if (!listing) {
        throw new NotFoundException('Лот не найден');
      }
      if (listing.sellerId === buyerId) {
        throw new ForbiddenException('Нельзя бронировать собственный лот');
      }
      if (listing.status !== 'active') {
        throw new ConflictException('Лот не активен');
      }

      const available = listing.quantityAvailable - listing.quantityReserved;
      const reservedNow = await reserveQuantity(tx, listingId, requestedQuantity);
      if (reservedNow === 0) {
        throw new ConflictException(
          `Недостаточно товара: свободно ${available}, запрошено ${requestedQuantity}`,
        );
      }

      const ttlMinutes = params.ttlMinutes ?? this.defaultTtlMinutes;
      const booking = await tx.booking.create({
        data: {
          listingId,
          buyerId,
          requestedQuantity,
          status: 'requested',
          expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
        },
      });

      await tx.bookingEvent.create({
        data: {
          bookingId: booking.id,
          actorId: buyerId,
          action: 'created',
          payload: { requestedQuantity },
        },
      });

      this.logTransition(booking.id, buyerId, null, 'requested');
      return booking;
    });
  }

  /** Продавец предлагает корректировку: другое количество, время или условия. */
  async counterOffer(params: CounterOfferParams): Promise<Booking> {
    const { bookingId, actorId, offeredQuantity } = params;
    if (
      offeredQuantity !== undefined &&
      (!Number.isInteger(offeredQuantity) || offeredQuantity <= 0)
    ) {
      throw new BadRequestException(
        'Предложенное количество должно быть целым положительным числом',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const booking = await loadBookingForUpdate(tx, bookingId);
      assertActorIsSeller(booking, actorId);
      assertTransition(booking, 'requested', 'counter_offered');

      // Переговоры не должны умирать по таймеру посреди разговора:
      // корректировка продлевает TTL на полный срок заново (см. ADR-004).
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'counter_offered',
          expiresAt: new Date(Date.now() + this.defaultTtlMinutes * 60_000),
        },
      });

      // Prisma JSON-поля не принимают undefined — собираем только заданные ключи.
      const payload: Record<string, string | number> = {};
      if (offeredQuantity !== undefined) payload.offeredQuantity = offeredQuantity;
      if (params.pickupTime !== undefined) payload.pickupTime = params.pickupTime;
      if (params.note !== undefined) payload.note = params.note;

      await tx.bookingEvent.create({
        data: { bookingId, actorId, action: 'counter_offered', payload },
      });

      this.logTransition(bookingId, actorId, 'requested', 'counter_offered');
      return updated;
    });
  }

  /** Покупатель принимает корректировку. Резерв перестраивается под предложенный объём. */
  async acceptCounter(params: AcceptCounterParams): Promise<Booking> {
    const { bookingId, actorId } = params;

    return this.prisma.$transaction(async (tx) => {
      const booking = await loadBookingForUpdate(tx, bookingId);
      if (booking.buyerId !== actorId) {
        throw new ForbiddenException('Принять корректировку может только покупатель');
      }
      assertTransition(booking, 'counter_offered', 'confirmed');

      const offer = await findLatestCounterOffer(tx, bookingId);
      const confirmedQuantity = offer?.offeredQuantity ?? booking.requestedQuantity;

      const delta = confirmedQuantity - booking.requestedQuantity;
      if (delta !== 0) {
        const adjusted = await adjustReservation(tx, booking.listingId, delta);
        if (adjusted === 0) {
          throw new ConflictException(
            `Недостаточно товара для корректировки: запрошено ${confirmedQuantity}, ` +
              `свободно ${booking.listing.quantityAvailable - booking.listing.quantityReserved + booking.requestedQuantity}`,
          );
        }
      }

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'confirmed', confirmedQuantity, confirmedAt: new Date() },
      });

      await tx.bookingEvent.create({
        data: {
          bookingId,
          actorId,
          action: 'accepted_counter',
          payload: { confirmedQuantity },
        },
      });

      this.logTransition(bookingId, actorId, 'counter_offered', 'confirmed');
      return updated;
    });
  }

  /** Продавец подтверждает запрос как есть. */
  async confirm(params: ConfirmParams): Promise<Booking> {
    const { bookingId, actorId } = params;

    return this.prisma.$transaction(async (tx) => {
      const booking = await loadBookingForUpdate(tx, bookingId);
      assertActorIsSeller(booking, actorId);
      assertTransition(booking, 'requested', 'confirmed');

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'confirmed',
          confirmedQuantity: booking.requestedQuantity,
          confirmedAt: new Date(),
        },
      });

      await tx.bookingEvent.create({
        data: {
          bookingId,
          actorId,
          action: 'confirmed',
          payload: { confirmedQuantity: booking.requestedQuantity },
        },
      });

      this.logTransition(bookingId, actorId, 'requested', 'confirmed');
      return updated;
    });
  }

  /** Отмена. Покупатель или продавец лота. Резерв возвращается листингу. */
  async cancel(params: CancelParams): Promise<Booking> {
    const { bookingId, actorId, reason } = params;

    return this.prisma.$transaction(async (tx) => {
      const booking = await loadBookingForUpdate(tx, bookingId);
      const isBuyer = booking.buyerId === actorId;
      const isSeller = booking.listing.sellerId === actorId;
      if (!isBuyer && !isSeller) {
        throw new ForbiddenException('Отменить бронь может только её покупатель или продавец лота');
      }
      if (booking.status !== 'requested' && booking.status !== 'counter_offered') {
        throw new ConflictException(
          `Отмена невозможна из статуса «${booking.status}» (разрешено из requested/counter_offered)`,
        );
      }

      await releaseReservation(tx, booking.listingId, booking.requestedQuantity);

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'cancelled' },
      });

      await tx.bookingEvent.create({
        data: {
          bookingId,
          actorId,
          action: 'cancelled',
          payload: reason !== undefined ? { reason } : undefined,
        },
      });

      this.logTransition(bookingId, actorId, booking.status, 'cancelled');
      return updated;
    });
  }

  /**
   * Покупатель подтверждает приёмку: confirmed → completed (v0.4.0-C, ADR-012).
   *
   * Правила:
   *  - только покупатель брони (403), только из статуса confirmed (409);
   *  - receivedQuantity < confirmedQuantity → qualityFlag = minor_issue
   *    (автоматически, если покупатель не указал major явно);
   *  - major_issue → status = disputed + BookingEvent(delivery_disputed) +
   *    уведомление продавцу + totalDisputes++ (арбитраж — v0.5.0);
   *  - иначе → completed + deliveryConfirmedAt + BookingEvent(delivery_confirmed)
   *    + totalConfirmations++ продавцу;
   *  - если покупатель — водитель с открытой сменой у продавца лота —
   *    смена закрывается (триггер из ADR-012, сценарий самовывоза).
   */
  async confirmDelivery(params: ConfirmDeliveryParams): Promise<Booking> {
    const { bookingId, actorId } = params;
    const booking = await this.prisma.$transaction(async (tx) => {
      const current = await loadBookingForUpdate(tx, bookingId);
      if (current.buyerId !== actorId) {
        throw new ForbiddenException('Подтвердить приёмку может только покупатель брони');
      }
      if (current.status !== 'confirmed') {
        throw new ConflictException(
          `Приёмка невозможна из статуса «${current.status}» (нужен confirmed)`,
        );
      }
      const confirmedQuantity = current.confirmedQuantity ?? current.requestedQuantity;

      // Недостача — минимум minor_issue, даже если покупатель забыл переключить.
      let qualityFlag: QualityFlag = params.qualityFlag ?? 'ok';
      if (params.receivedQuantity < confirmedQuantity && qualityFlag === 'ok') {
        qualityFlag = 'minor_issue';
      }

      if (qualityFlag === 'major_issue') {
        const updated = await tx.booking.update({
          where: { id: bookingId },
          data: {
            status: 'disputed',
            deliveryConfirmedAt: new Date(),
            receivedQuantity: params.receivedQuantity,
            qualityFlag,
            qualityNotes: params.qualityNotes,
          },
        });
        await tx.bookingEvent.create({
          data: {
            bookingId,
            actorId,
            action: 'delivery_disputed',
            payload: {
              receivedQuantity: params.receivedQuantity,
              qualityFlag,
              ...(params.qualityNotes !== undefined ? { qualityNotes: params.qualityNotes } : {}),
            },
          },
        });
        await tx.user.update({
          where: { id: current.listing.sellerId },
          data: { totalDisputes: { increment: 1 } },
        });
        this.logTransition(bookingId, actorId, 'confirmed', 'disputed');
        return updated;
      }

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'completed',
          deliveryConfirmedAt: new Date(),
          receivedQuantity: params.receivedQuantity,
          qualityFlag,
          qualityNotes: params.qualityNotes,
        },
      });
      await tx.bookingEvent.create({
        data: {
          bookingId,
          actorId,
          action: 'delivery_confirmed',
          payload: {
            receivedQuantity: params.receivedQuantity,
            qualityFlag,
            ...(params.qualityNotes !== undefined ? { qualityNotes: params.qualityNotes } : {}),
          },
        },
      });
      await tx.user.update({
        where: { id: current.listing.sellerId },
        data: { totalConfirmations: { increment: 1 } },
      });
      this.logTransition(bookingId, actorId, 'confirmed', 'completed');
      return updated;
    });

    // После фиксации транзакции — уведомление продавцу и закрытие смены
    // (вспомогательные каналы не откатывают бизнес-операцию, ADR-012).
    const sellerId = await this.prisma.booking
      .findUniqueOrThrow({
        where: { id: bookingId },
        select: { listing: { select: { sellerId: true } } },
      })
      .then((b) => b.listing.sellerId);

    if (booking.status === 'disputed') {
      await this.notifications.send({
        userId: sellerId,
        type: 'booking_delivery_disputed',
        title: 'Спор по приёмке',
        body: `Покупатель заявил серьёзную проблему по брони. Откройте «Входящие», чтобы увидеть детали.`,
        data: { bookingId },
      });
    } else {
      await this.notifications.send({
        userId: sellerId,
        type: 'booking_delivery_confirmed',
        title: 'Приёмка подтверждена',
        body: 'Покупатель получил товар и подтвердил приёмку. Сделка завершена.',
        data: { bookingId },
      });
    }

    // Триггер ADR-012: покупатель-водитель с открытой сменой у этого
    // продавца — смену закрыть (сценарий самовывоза водителем).
    await this.closeRelatedWorkSession(bookingId);

    // Триггер ADR-013: пересчёт рейтинга обеих сторон. Не блокирует
    // сделку — сбой пересчёта логируется и догоняется следующим событием.
    await this.reputation.safeOnBookingDelivery(bookingId);

    return booking;
  }

  /**
   * Авто-подтверждение приёмки (cron): confirmed → completed через
   * BOOKING_AUTO_CONFIRM_HOURS (по умолчанию 24) после подтверждения
   * брони — защита от «забыл подтвердить». qualityFlag=ok,
   * BookingEvent(system_auto_confirmed), actorId NULL.
   * Возвращает количество закрытых броней.
   */
  async autoConfirmStale(): Promise<number> {
    const deadline = new Date(Date.now() - this.autoConfirmHours * 3_600_000);
    const stale = await this.prisma.booking.findMany({
      where: { status: 'confirmed', confirmedAt: { lt: deadline } },
      select: { id: true },
    });

    let confirmed = 0;
    for (const { id } of stale) {
      try {
        const done = await this.prisma.$transaction(async (tx) => {
          const booking = await tx.booking.findUnique({ where: { id } });
          if (!booking || booking.status !== 'confirmed') {
            return false; // изменилась между findMany и транзакцией
          }
          await tx.booking.update({
            where: { id },
            data: {
              status: 'completed',
              deliveryConfirmedAt: new Date(),
              receivedQuantity: booking.confirmedQuantity ?? booking.requestedQuantity,
              qualityFlag: 'ok',
            },
          });
          await tx.bookingEvent.create({
            data: { bookingId: id, actorId: null, action: 'system_auto_confirmed' },
          });
          await tx.user.update({
            where: { id: (await tx.booking.findUniqueOrThrow({ where: { id }, select: { listing: { select: { sellerId: true } } } })).listing.sellerId },
            data: { totalConfirmations: { increment: 1 } },
          });
          this.logTransition(id, null, 'confirmed', 'completed');
          return true;
        });
        if (done) {
          confirmed++;
          // Пересчёт рейтинга после авто-подтверждения (ADR-013),
          // не блокирует закрытие брони.
          await this.reputation.safeOnBookingDelivery(id);
        }
      } catch (error) {
        this.logger.error({ bookingId: id, err: error }, 'auto-confirm: не удалось закрыть бронь');
      }
    }
    if (confirmed > 0) {
      this.logger.log({ confirmed }, 'booking:auto-confirm closed stale bookings');
    }
    return confirmed;
  }

  /** Закрыть открытую смену «покупатель-водитель ↔ продавец лота» (ADR-012). */
  private async closeRelatedWorkSession(bookingId: string): Promise<void> {
    try {
      const booking = await this.prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: {
          buyerId: true,
          listing: { select: { sellerId: true } },
        },
      });
      const open = await this.prisma.workSession.findFirst({
        where: { driverId: booking.buyerId, sellerId: booking.listing.sellerId, endedAt: null },
      });
      if (open) {
        await this.workHours.endSession(open.id, booking.buyerId);
      }
    } catch (error) {
      this.logger.warn({ bookingId, err: error }, 'confirm-delivery: смену закрыть не удалось');
    }
  }

  /**
   * Гашение просроченных броней (cron). Возвращает количество истёкших.
   * Системное действие: actorId в журнале — NULL.
   */
  async expireStale(): Promise<number> {
    const stale = await this.prisma.booking.findMany({
      where: {
        status: { in: ['requested', 'counter_offered'] },
        expiresAt: { lt: new Date() },
      },
      select: { id: true },
    });

    let expired = 0;
    for (const { id } of stale) {
      try {
        const done = await this.prisma.$transaction(async (tx) => {
          // Без TTL-защиты loadBookingForUpdate: крона работает именно
          // с просроченными бронями, это не действие пользователя.
          const booking = await loadBooking(tx, id);
          if (booking.status !== 'requested' && booking.status !== 'counter_offered') {
            return false; // кто-то успел изменить бронь между findMany и транзакцией
          }
          await releaseReservation(tx, booking.listingId, booking.requestedQuantity);
          await tx.booking.update({ where: { id }, data: { status: 'expired' } });
          await tx.bookingEvent.create({
            data: { bookingId: id, actorId: null, action: 'expired' },
          });
          this.logTransition(id, null, booking.status, 'expired');
          return true;
        });
        if (done) expired++;
      } catch (error) {
        // Одна битая бронь не должна останавливать весь цикл гашения.
        this.logger.error(
          { bookingId: id, err: error },
          `Не удалось погасить просроченную бронь ${id}`,
        );
      }
    }
    if (expired > 0) {
      this.logger.log({ expired }, 'booking:ttl expired stale bookings');
    }
    return expired;
  }

  /** Мои брони покупателя — «Мои брони» в приложении. */
  async findByBuyer(buyerId: string, status?: BookingStatus): Promise<BookingDto[]> {
    const bookings = await this.prisma.booking.findMany({
      where: { buyerId, status },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
      include: BOOKING_LIST_VIEW_INCLUDE,
    });
    return bookings.map(toBookingDto);
  }

  /** Входящие брони по листингам продавца — «Входящие» в приложении. */
  async findIncomingForSeller(sellerId: string, status?: BookingStatus): Promise<BookingDto[]> {
    const bookings = await this.prisma.booking.findMany({
      where: { listing: { sellerId }, status },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
      include: BOOKING_LIST_VIEW_INCLUDE,
    });
    return bookings.map(toBookingDto);
  }

  private logTransition(
    bookingId: string,
    actorId: string | null,
    fromStatus: string | null,
    toStatus: string,
  ): void {
    // nestjs-pino пробрасывает объект первым аргументом как structured-поля.
    this.logger.log({ bookingId, actorId, fromStatus, toStatus }, 'booking:status');
  }
}

/* ────────────────────────── Внутренние помощники ────────────────────────── */

/** Загружает бронь с лотом; 404 если нет. Без TTL-защиты (для крона и чтения). */
async function loadBooking(tx: TransactionClient, bookingId: string): Promise<BookingWithListing> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: BOOKING_WITH_LISTING_INCLUDE,
  });
  if (!booking) {
    throw new NotFoundException('Бронь не найдена');
  }
  return booking;
}

/** Загружает бронь с лотом; 404 если нет; конфликт, если TTL уже истёк. */
async function loadBookingForUpdate(
  tx: TransactionClient,
  bookingId: string,
): Promise<BookingWithListing> {
  const booking = await loadBooking(tx, bookingId);
  if (
    (booking.status === 'requested' || booking.status === 'counter_offered') &&
    booking.expiresAt.getTime() <= Date.now()
  ) {
    throw new ConflictException('Срок действия брони истёк');
  }
  return booking;
}

/** Действие доступно только продавцу лота, связанного с бронью. */
function assertActorIsSeller(booking: BookingWithListing, actorId: string): void {
  if (booking.listing.sellerId !== actorId) {
    throw new ForbiddenException('Действие доступно только продавцу лота');
  }
}

/** Строгая проверка перехода: откуда → куда. Иначе — конфликт состояний. */
function assertTransition(
  booking: BookingWithListing,
  from: 'requested' | 'counter_offered',
  to: 'confirmed' | 'cancelled' | 'counter_offered',
): void {
  if (booking.status !== from) {
    throw new ConflictException(
      `Переход ${from} → ${to} невозможен: текущий статус «${booking.status}»`,
    );
  }
}

/** Последняя корректировка брони — та, что на столе у покупателя. */
async function findLatestCounterOffer(
  tx: TransactionClient,
  bookingId: string,
): Promise<CounterOfferPayload | null> {
  const event = await tx.bookingEvent.findFirst({
    where: { bookingId, action: 'counter_offered' },
    orderBy: { createdAt: 'desc' },
  });
  if (!event || event.payload === null || typeof event.payload !== 'object') {
    return null;
  }
  return event.payload as CounterOfferPayload;
}

/**
 * Атомарно увеличивает резерв. Условие в WHERE не даёт уйти в минус:
 * параллельные брони увидят актуальный остаток и одна из них не пройдёт.
 */
async function reserveQuantity(
  tx: TransactionClient,
  listingId: string,
  quantity: number,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE listings
    SET "quantityReserved" = "quantityReserved" + ${quantity}
    WHERE id = ${listingId}
      AND "quantityAvailable" - "quantityReserved" >= ${quantity}`;
}

/** Атомарно возвращает резерв (не может уйти в минус по условию WHERE). */
async function releaseReservation(
  tx: TransactionClient,
  listingId: string,
  quantity: number,
): Promise<void> {
  const released = await tx.$executeRaw`
    UPDATE listings
    SET "quantityReserved" = "quantityReserved" - ${quantity}
    WHERE id = ${listingId}
      AND "quantityReserved" >= ${quantity}`;
  if (released === 0) {
    throw new ConflictException('Не удалось вернуть резерв: целостность листинга нарушена');
  }
}

/** Сдвигает резерв на delta (может быть отрицательным) с проверкой остатка. */
async function adjustReservation(
  tx: TransactionClient,
  listingId: string,
  delta: number,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE listings
    SET "quantityReserved" = "quantityReserved" + ${delta}
    WHERE id = ${listingId}
      AND "quantityAvailable" - "quantityReserved" >= ${delta}`;
}

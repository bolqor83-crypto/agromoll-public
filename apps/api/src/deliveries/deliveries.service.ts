/**
 * Сервис доставки попутчиками (v0.5.0, подэтап C, ADR-015).
 *
 * Покупатель просит «подвезти от линии продавца к моей точке».
 * Платформа НЕ показывает цену и НЕ является агентом — водитель и
 * стороны договариваются сами (поля цены нет).
 *
 * Интеграция 289-ФЗ (ADR-011/015):
 *  - при взятии заказа создаётся WorkSession пары (driver, seller),
 *    seller = владелец точки забора (pickupPoint.owner);
 *  - при попытке взять заказ заблокированной парой — 409 с мягким
 *    сообщением, запрос остаётся открытым для других водителей
 *    (DeliveryEvent blocked_by_289fz — аудит попытки);
 *  - при завершении — WorkSession закрывается, часы идут в
 *    MonthlyPairTotal, при закрытой серии месяцев создаётся BlockedPair.
 *
 * TTL: открытый запрос живёт DELIVERY_TTL_MINUTES (по умолчанию 60),
 * крон гасит просроченные (open → expired).
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
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { DeliveryDto, GeoCoord } from '@agromoll/types';
import type { CreateDeliveryInput } from '@agromoll/validation';
import { PrismaService } from '../prisma/prisma.service';
import { WorkHoursService } from '../work-hours/work-hours.service';
import { toMonthKey } from '../work-hours/work-hours.service';
import {
  DEFAULT_DELIVERY_TTL_MINUTES,
  DELIVERY_CORRIDOR_MATCH_METERS,
  DELIVERY_PAIR_BLOCKED_CODE,
  DELIVERY_PAIR_BLOCKED_MESSAGE,
  DELIVERY_TTL_MINUTES,
} from './deliveries.constants';
import { pointToSegmentMeters } from './geo-math';

/** Include запроса с точками и именами сторон. */
const DELIVERY_VIEW_INCLUDE = {
  buyer: { select: { displayName: true } },
  assignedDriver: { select: { displayName: true } },
  booking: { select: { id: true } },
  pickupPoint: {
    select: {
      id: true,
      ownerId: true,
      owner: { select: { displayName: true } },
      label: true,
      address: true,
      latitude: true,
      longitude: true,
    },
  },
  dropoffPoint: {
    select: {
      id: true,
      ownerId: true,
      owner: { select: { displayName: true } },
      label: true,
      address: true,
      latitude: true,
      longitude: true,
    },
  },
} as const satisfies Prisma.DeliveryRequestInclude;

type DeliveryWithRelations = Prisma.DeliveryRequestGetPayload<{
  include: typeof DELIVERY_VIEW_INCLUDE;
}>;

/** Точка маршрута из include. */
type PointView = DeliveryWithRelations['pickupPoint'];

/** Каким ролям показывать QR-коды: только сторонам (ADR-015). */
function codesForViewer(
  delivery: DeliveryWithRelations,
  viewerId: string,
): { pickupCode: string | null; dropoffCode: string | null } {
  const isParty = delivery.buyerId === viewerId || delivery.assignedDriverId === viewerId;
  return isParty
    ? { pickupCode: delivery.pickupCode, dropoffCode: delivery.dropoffCode }
    : { pickupCode: null, dropoffCode: null };
}

@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workHours: WorkHoursService,
    @Inject(DELIVERY_TTL_MINUTES) private readonly ttlMinutes: number,
  ) {}

  /** Покупатель создаёт запрос доставки (идемпотентно, ADR-006). */
  async create(buyerId: string, input: CreateDeliveryInput): Promise<DeliveryDto> {
    // Точки должны существовать и быть активными (ADR-014/015).
    const [pickup, dropoff] = await Promise.all([
      this.prisma.geoPoint.findUnique({ where: { id: input.pickupPointId } }),
      this.prisma.geoPoint.findUnique({ where: { id: input.dropoffPointId } }),
    ]);
    if (!pickup || !pickup.isActive) {
      throw new BadRequestException('Точка забора не найдена или деактивирована');
    }
    if (!dropoff || !dropoff.isActive) {
      throw new BadRequestException('Точка доставки не найдена или деактивирована');
    }
    if (pickup.ownerId === buyerId && dropoff.ownerId === buyerId) {
      throw new BadRequestException('Забор и доставка у вас самих — везти нечего');
    }

    const delivery = await this.prisma.$transaction(async (tx) => {
      const created = await tx.deliveryRequest.create({
        data: {
          buyerId,
          bookingId: input.bookingId ?? null,
          pickupPointId: pickup.id,
          dropoffPointId: dropoff.id,
          weightKg: input.weightKg,
          description: input.description ?? null,
          status: 'open',
          expiresAt: new Date(Date.now() + this.ttlMinutes * 60_000),
          pickupCode: randomUUID(),
          dropoffCode: randomUUID(),
        },
        include: DELIVERY_VIEW_INCLUDE,
      });
      await tx.deliveryEvent.create({
        data: { deliveryId: created.id, actorId: buyerId, action: 'created' },
      });
      this.logger.log({ deliveryId: created.id, buyerId }, 'delivery:created');
      return created;
    });

    return this.toDto(delivery, buyerId, null);
  }

  /**
   * Лента радара: открытые запросы для водителя. Если у водителя есть
   * активные коридоры — только «попутные» (точки в радиусе от линии
   * маршрута), отсортированные по близости; без коридоров — все.
   */
  async findOpen(driverId: string): Promise<DeliveryDto[]> {
    const [requests, corridors] = await Promise.all([
      this.prisma.deliveryRequest.findMany({
        where: { status: 'open', expiresAt: { gt: new Date() } },
        include: DELIVERY_VIEW_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.geoPoint.findMany({
        where: { ownerId: driverId, kind: 'delivery_corridor', isActive: true },
      }),
    ]);

    // Свой запрос подвезти нельзя — исключаем сразу.
    const foreign = requests.filter((request) => request.buyerId !== driverId);

    if (corridors.length === 0) {
      return foreign.map((request) => this.toDto(request, driverId, null));
    }

    const segments = corridors
      .filter((c) => c.corridorFrom && c.corridorTo)
      .map((c) => ({
        from: c.corridorFrom as unknown as GeoCoord,
        to: c.corridorTo as unknown as GeoCoord,
      }));

    const scored = foreign
      .map((request) => {
        const pickup: GeoCoord = { lat: request.pickupPoint.latitude, lng: request.pickupPoint.longitude };
        const dropoff: GeoCoord = {
          lat: request.dropoffPoint.latitude,
          lng: request.dropoffPoint.longitude,
        };
        // «Попутность» = минимальное расстояние от точек заказа до линии.
        let best = Number.POSITIVE_INFINITY;
        for (const segment of segments) {
          best = Math.min(
            best,
            pointToSegmentMeters(pickup, segment.from, segment.to),
            pointToSegmentMeters(dropoff, segment.from, segment.to),
          );
        }
        return { request, distance: best };
      })
      .filter(({ distance }) => distance <= DELIVERY_CORRIDOR_MATCH_METERS)
      .sort((a, b) => a.distance - b.distance);

    return scored.map(({ request, distance }) =>
      this.toDto(request, driverId, Math.round(distance)),
    );
  }

  /** Мои доставки: покупателю — созданные, водителю — взятые. */
  async findMine(userId: string): Promise<DeliveryDto[]> {
    const requests = await this.prisma.deliveryRequest.findMany({
      where: {
        OR: [{ buyerId: userId }, { assignedDriverId: userId }],
      },
      include: DELIVERY_VIEW_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return requests.map((request) => this.toDto(request, userId, null));
  }

  /**
   * Водитель берёт заказ: open → assigned + WorkSession(driver, seller).
   * Заблокированная пара 289-ФЗ → 409 (запрос остаётся открытым).
   */
  async assign(deliveryId: string, driverId: string): Promise<DeliveryDto> {
    const delivery = await this.prisma.$transaction(async (tx) => {
      const current = await tx.deliveryRequest.findUnique({
        where: { id: deliveryId },
        include: { pickupPoint: { select: { ownerId: true } } },
      });
      if (!current) {
        throw new NotFoundException('Запрос доставки не найден');
      }
      if (current.status !== 'open') {
        throw new ConflictException(
          `Заказ уже не открыт (статус «${current.status}») — кто-то успел раньше`,
        );
      }
      if (current.buyerId === driverId) {
        throw new ForbiddenException('Нельзя взять собственный заказ');
      }
      const sellerId = current.pickupPoint.ownerId;

      // 289-ФЗ: пара заблокирована → заказ остаётся открытым, попытка — в аудит.
      const blocked = await tx.blockedPair.findUnique({
        where: { driverId_sellerId: { driverId, sellerId } },
      });
      if (blocked) {
        // Событие — отдельной записью (транзакция ниже откатится с 409).
        await this.prisma.deliveryEvent.create({
          data: {
            deliveryId,
            actorId: driverId,
            action: 'blocked_by_289fz',
            payload: { sellerId, unblockAt: blocked.unblockAt },
          },
        });
        throw new ConflictException({
          code: DELIVERY_PAIR_BLOCKED_CODE,
          message: DELIVERY_PAIR_BLOCKED_MESSAGE,
        });
      }

      // Одна открытая смена на водителя — как в ADR-011.
      const open = await tx.workSession.findFirst({
        where: { driverId, endedAt: null },
      });
      if (open) {
        throw new ConflictException(
          open.sellerId === sellerId
            ? 'Смена с этим продавцом уже открыта'
            : 'У вас уже есть открытая смена — сначала завершите её',
        );
      }

      const now = new Date();
      const updated = await tx.deliveryRequest.update({
        where: { id: deliveryId },
        data: { status: 'assigned', assignedDriverId: driverId, assignedAt: now },
        include: DELIVERY_VIEW_INCLUDE,
      });

      // Смена пары начинается ВЗЯТИЕМ заказа (ADR-015): часы 289-ФЗ
      // считают фактическую работу с продавцом, а не намерение.
      await tx.workSession.create({
        data: { driverId, sellerId, startedAt: now, month: toMonthKey(now) },
      });

      await tx.deliveryEvent.create({
        data: { deliveryId, actorId: driverId, action: 'assigned' },
      });
      this.logger.log({ deliveryId, driverId, sellerId }, 'delivery:assigned');
      return updated;
    });

    return this.toDto(delivery, driverId, null);
  }

  /** Водитель выехал: assigned → in_transit. */
  async start(deliveryId: string, driverId: string): Promise<DeliveryDto> {
    const delivery = await this.prisma.$transaction(async (tx) => {
      const current = await tx.deliveryRequest.findUnique({ where: { id: deliveryId } });
      if (!current) {
        throw new NotFoundException('Запрос доставки не найден');
      }
      if (current.assignedDriverId !== driverId) {
        throw new ForbiddenException('Начать может только водитель, взявший заказ');
      }
      if (current.status !== 'assigned') {
        throw new ConflictException(`Начать можно только из «assigned» (сейчас «${current.status}»)`);
      }
      const updated = await tx.deliveryRequest.update({
        where: { id: deliveryId },
        data: { status: 'in_transit' },
        include: DELIVERY_VIEW_INCLUDE,
      });
      await tx.deliveryEvent.create({
        data: { deliveryId, actorId: driverId, action: 'started' },
      });
      return updated;
    });
    this.logger.log({ deliveryId, driverId }, 'delivery:started');
    return this.toDto(delivery, driverId, null);
  }

  /**
   * Передача завершена: in_transit → delivered. WorkSession пары
   * закрывается (часы → MonthlyPairTotal), при закрытой серии 289-ФЗ
   * создаётся BlockedPair (ADR-011/015).
   */
  async deliver(deliveryId: string, driverId: string): Promise<DeliveryDto> {
    const delivery = await this.prisma.$transaction(async (tx) => {
      const current = await tx.deliveryRequest.findUnique({
        where: { id: deliveryId },
        include: { pickupPoint: { select: { ownerId: true } } },
      });
      if (!current) {
        throw new NotFoundException('Запрос доставки не найден');
      }
      if (current.assignedDriverId !== driverId) {
        throw new ForbiddenException('Завершить может только водитель, взявший заказ');
      }
      if (current.status !== 'in_transit') {
        throw new ConflictException(
          `Завершить можно только из «in_transit» (сейчас «${current.status}»)`,
        );
      }
      const updated = await tx.deliveryRequest.update({
        where: { id: deliveryId },
        data: { status: 'delivered', deliveredAt: new Date() },
        include: DELIVERY_VIEW_INCLUDE,
      });
      await tx.deliveryEvent.create({
        data: { deliveryId, actorId: driverId, action: 'delivered' },
      });
      return updated;
    });

    // Часы 289-ФЗ: закрываем смену пары (если открыта) и проверяем серию.
    await this.closePairSession(deliveryId);

    this.logger.log({ deliveryId, driverId }, 'delivery:delivered');
    return this.toDto(delivery, driverId, null);
  }

  /**
   * Отмена: до in_transit — любая сторона; после in_transit — только
   * водитель, с причиной. Взятым заказом управляет и смена: закрываем.
   */
  async cancel(deliveryId: string, actorId: string, reason?: string): Promise<DeliveryDto> {
    const delivery = await this.prisma.$transaction(async (tx) => {
      const current = await tx.deliveryRequest.findUnique({ where: { id: deliveryId } });
      if (!current) {
        throw new NotFoundException('Запрос доставки не найден');
      }
      const isBuyer = current.buyerId === actorId;
      const isDriver = current.assignedDriverId === actorId;
      if (!isBuyer && !isDriver) {
        throw new ForbiddenException('Отменить может только покупатель или водитель заказа');
      }
      if (current.status === 'in_transit') {
        if (!isDriver) {
          throw new ForbiddenException('После выезда отменяет только водитель (с причиной)');
        }
        if (!reason || reason.trim().length === 0) {
          throw new BadRequestException('После выезда причина отмены обязательна');
        }
      }
      if (current.status !== 'open' && current.status !== 'assigned' && current.status !== 'in_transit') {
        throw new ConflictException(`Отменить из «${current.status}» нельзя`);
      }
      const updated = await tx.deliveryRequest.update({
        where: { id: deliveryId },
        data: { status: 'cancelled' },
        include: DELIVERY_VIEW_INCLUDE,
      });
      await tx.deliveryEvent.create({
        data: {
          deliveryId,
          actorId,
          action: 'cancelled',
          ...(reason !== undefined ? { payload: { reason } } : {}),
        },
      });
      return updated;
    });

    // Смена закрывается и при отмене взятого заказа — часы честные.
    await this.closePairSession(deliveryId);

    this.logger.log({ deliveryId, actorId }, 'delivery:cancelled');
    return this.toDto(delivery, actorId, null);
  }

  /** TTL-крон: гасит просроченные open → expired. Возвращает количество. */
  async expireStale(): Promise<number> {
    const stale = await this.prisma.deliveryRequest.findMany({
      where: { status: 'open', expiresAt: { lt: new Date() } },
      select: { id: true },
    });
    let expired = 0;
    for (const { id } of stale) {
      try {
        const done = await this.prisma.$transaction(async (tx) => {
          const current = await tx.deliveryRequest.findUnique({ where: { id } });
          if (!current || current.status !== 'open') {
            return false;
          }
          await tx.deliveryRequest.update({ where: { id }, data: { status: 'expired' } });
          await tx.deliveryEvent.create({
            data: { deliveryId: id, actorId: null, action: 'expired' },
          });
          return true;
        });
        if (done) {
          expired += 1;
        }
      } catch (error) {
        this.logger.error({ deliveryId: id, err: error }, 'delivery:expire не удался');
      }
    }
    if (expired > 0) {
      this.logger.log({ expired }, 'delivery:expired stale requests');
    }
    return expired;
  }

  /**
   * Закрыть открытую смену пары заказа (driver, pickup-продавец):
   * при deliver/cancel взятого. Актёр закрытия — ВОДИТЕЛЬ пары:
   * WorkHoursService пускает к закрытию только сторону пары
   * (ADR-011), а триггер доставки — системный. Часы уйдут в
   * MonthlyPairTotal, затем — проверка серии 289-ФЗ.
   */
  private async closePairSession(deliveryId: string): Promise<void> {
    try {
      const delivery = await this.prisma.deliveryRequest.findUniqueOrThrow({
        where: { id: deliveryId },
        select: {
          assignedDriverId: true,
          pickupPoint: { select: { ownerId: true } },
        },
      });
      if (!delivery.assignedDriverId) {
        return; // заказ не был взят — смены нет
      }
      const sellerId = delivery.pickupPoint.ownerId;
      const open = await this.prisma.workSession.findFirst({
        where: { driverId: delivery.assignedDriverId, sellerId, endedAt: null },
      });
      if (open) {
        await this.workHours.endSession(open.id, delivery.assignedDriverId);
      }
      // Серия 289-ФЗ: закрытие смены могло добить месяц до лимита.
      await this.workHours.enforceSeriesForPair(delivery.assignedDriverId, sellerId);
    } catch (error) {
      this.logger.error(
        { deliveryId, err: error },
        'delivery: закрытие смены пары не удалось (заказ не затронут)',
      );
    }
  }

  /** Prisma-строка → DTO: имена, точки, коды только сторонам. */
  private toDto(
    delivery: DeliveryWithRelations,
    viewerId: string,
    corridorDistanceMeters: number | null,
  ): DeliveryDto {
    const point = (p: PointView) => ({
      id: p.id,
      ownerId: p.ownerId,
      ownerName: p.owner.displayName,
      label: p.label,
      address: p.address,
      latitude: p.latitude,
      longitude: p.longitude,
    });
    return {
      id: delivery.id,
      buyerId: delivery.buyerId,
      buyerName: delivery.buyer.displayName,
      bookingId: delivery.bookingId,
      pickup: point(delivery.pickupPoint),
      dropoff: point(delivery.dropoffPoint),
      weightKg: delivery.weightKg.toString(),
      description: delivery.description,
      status: delivery.status,
      assignedDriverId: delivery.assignedDriverId,
      assignedDriverName: delivery.assignedDriver?.displayName ?? null,
      assignedAt: delivery.assignedAt?.toISOString() ?? null,
      deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
      expiresAt: delivery.expiresAt.toISOString(),
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString(),
      ...codesForViewer(delivery, viewerId),
      corridorDistanceMeters,
    };
  }
}

/** Дефолт TTL для документации. */
export const DELIVERY_DEFAULT_TTL = DEFAULT_DELIVERY_TTL_MINUTES;

/**
 * Unit-тесты DeliveriesService (v0.5.0, подэтап C, ADR-015).
 *
 * Машина состояний, ролевые правила, 289-ФЗ (блокировка при взятии,
 * смена пары, закрытие смены), TTL — на моке Prisma. Полный HTTP-цикл
 * с реальной БД — в e2e (delivery-flow.e2e-spec.ts).
 */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DeliveriesService } from './deliveries.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkHoursService } from '../work-hours/work-hours.service';
import { DELIVERY_PAIR_BLOCKED_CODE } from './deliveries.constants';

const BUYER = 'buyer-1';
const DRIVER = 'driver-1';
const SELLER = 'seller-1';
const OTHER_DRIVER = 'driver-2';

interface PrismaMockShape {
  geoPoint: { findUnique: jest.Mock; findMany: jest.Mock };
  deliveryRequest: {
    findUnique: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  deliveryEvent: { create: jest.Mock };
  workSession: { findFirst: jest.Mock; create: jest.Mock };
  blockedPair: { findUnique: jest.Mock };
  $transaction: jest.Mock;
}

/** Строка доставки с include (упрощённая). */
function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    buyerId: BUYER,
    bookingId: null,
    pickupPointId: 'pickup-1',
    dropoffPointId: 'dropoff-1',
    weightKg: { toString: () => '12.50' } as unknown as Decimal,
    description: null,
    status: 'open',
    assignedDriverId: null,
    assignedAt: null,
    deliveredAt: null,
    expiresAt: new Date(Date.now() + 60 * 60_000),
    pickupCode: 'pickup-uuid',
    dropoffCode: 'dropoff-uuid',
    createdAt: new Date('2026-11-08T08:00:00Z'),
    updatedAt: new Date('2026-11-08T08:00:00Z'),
    buyer: { displayName: 'Ларёк «У Ашота»' },
    assignedDriver: null,
    booking: null,
    pickupPoint: {
      id: 'pickup-1',
      ownerId: SELLER,
      owner: { displayName: 'ФХ «Донская долина»' },
      label: 'Линия 5',
      address: null,
      latitude: 47.2224,
      longitude: 39.7138,
    },
    dropoffPoint: {
      id: 'dropoff-1',
      ownerId: BUYER,
      owner: { displayName: 'Ларёк «У Ашота»' },
      label: 'Мой ларёк',
      address: 'ул. Иванова 45',
      latitude: 47.24,
      longitude: 39.73,
    },
    ...overrides,
  };
}

/** Заглушка Decimal (в тестах достаточно строки). */
interface Decimal {
  toString(): string;
}

function makeService(): {
  service: DeliveriesService;
  prisma: PrismaMockShape;
  workHours: { endSession: jest.Mock; enforceSeriesForPair: jest.Mock };
} {
  const prisma: PrismaMockShape = {
    geoPoint: { findUnique: jest.fn(), findMany: jest.fn() },
    deliveryRequest: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    deliveryEvent: { create: jest.fn() },
    workSession: { findFirst: jest.fn(), create: jest.fn() },
    blockedPair: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const workHours = { endSession: jest.fn(), enforceSeriesForPair: jest.fn() };
  const service = new DeliveriesService(
    prisma as unknown as PrismaService,
    workHours as unknown as WorkHoursService,
    60,
  );
  return { service, prisma, workHours };
}

/** Настроить мок транзакции: $transaction вызывает колбэк с тем же моком. */
function mockTransaction(prisma: PrismaMockShape): void {
  prisma.$transaction.mockImplementation(async (fn: (client: PrismaMockShape) => Promise<unknown>) =>
    fn(prisma),
  );
}

describe('DeliveriesService.create', () => {
  it('создаёт open-запрос с TTL, кодами и событием created', async () => {
    const { service, prisma } = makeService();
    mockTransaction(prisma);
    prisma.geoPoint.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      where.id === 'pickup-1'
        ? { id: 'pickup-1', ownerId: SELLER, isActive: true }
        : { id: 'dropoff-1', ownerId: BUYER, isActive: true },
    );
    prisma.deliveryRequest.create.mockResolvedValue(makeDelivery());

    const dto = await service.create(BUYER, {
      pickupPointId: 'pickup-1',
      dropoffPointId: 'dropoff-1',
      weightKg: 12.5,
    });

    expect(dto.status).toBe('open');
    expect(prisma.deliveryRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buyerId: BUYER,
          status: 'open',
          pickupCode: expect.any(String),
          dropoffCode: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.deliveryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deliveryId: 'delivery-1', actorId: BUYER, action: 'created' } }),
    );
  });

  it('неактивная точка забора → 400', async () => {
    const { service, prisma } = makeService();
    prisma.geoPoint.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      where.id === 'pickup-1' ? { id: 'pickup-1', ownerId: SELLER, isActive: false } : null,
    );
    await expect(
      service.create(BUYER, { pickupPointId: 'pickup-1', dropoffPointId: 'dropoff-1', weightKg: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('забор и доставка у самого себя → 400', async () => {
    const { service, prisma } = makeService();
    prisma.geoPoint.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      where.id === 'pickup-1'
        ? { id: 'pickup-1', ownerId: BUYER, isActive: true }
        : { id: 'dropoff-1', ownerId: BUYER, isActive: true },
    );
    await expect(
      service.create(BUYER, { pickupPointId: 'pickup-1', dropoffPointId: 'dropoff-1', weightKg: 10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DeliveriesService.findOpen (радар)', () => {
  it('без коридоров — все чужие открытые запросы', async () => {
    const { service, prisma } = makeService();
    prisma.deliveryRequest.findMany.mockResolvedValue([
      makeDelivery(),
      makeDelivery({ id: 'delivery-own', buyerId: DRIVER }),
    ]);
    prisma.geoPoint.findMany.mockResolvedValue([]);

    const result = await service.findOpen(DRIVER);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('delivery-1');
    expect(result[0].corridorDistanceMeters).toBeNull();
  });

  it('с коридором — только попутные, отсортированные по близости', async () => {
    const { service, prisma } = makeService();
    // Коридор водителя: рынок → восток (линия по широте рынка).
    prisma.geoPoint.findMany.mockResolvedValue([
      {
        id: 'corridor-1',
        ownerId: DRIVER,
        kind: 'delivery_corridor',
        isActive: true,
        corridorFrom: { lat: 47.2224, lng: 39.7138 },
        corridorTo: { lat: 47.2224, lng: 39.7288 },
      },
    ]);
    // Обе точки «далёкого» заказа — в 5 км севернее линии.
    const farPoint = {
      id: 'point-far',
      ownerId: SELLER,
      owner: { displayName: 'S' },
      label: null,
      address: null,
      latitude: 47.2674,
      longitude: 39.72,
    };
    prisma.deliveryRequest.findMany.mockResolvedValue([
      makeDelivery({ id: 'far-away', pickupPoint: farPoint, dropoffPoint: farPoint }),
      // Точка забора на линии — попутный.
      makeDelivery({ id: 'on-the-way' }),
    ]);

    const result = await service.findOpen(DRIVER);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('on-the-way');
    expect(result[0].corridorDistanceMeters).toBeLessThan(50);
  });
});

describe('DeliveriesService.assign (взятие + 289-ФЗ)', () => {
  function setup(prisma: PrismaMockShape): void {
    mockTransaction(prisma);
    prisma.deliveryRequest.findUnique.mockResolvedValue({
      id: 'delivery-1',
      status: 'open',
      buyerId: BUYER,
      assignedDriverId: null,
      pickupPoint: { ownerId: SELLER },
    });
    prisma.deliveryRequest.update.mockResolvedValue(
      makeDelivery({ status: 'assigned', assignedDriverId: DRIVER }),
    );
  }

  it('счастливый путь: assigned + смена пары создана + событие', async () => {
    const { service, prisma } = makeService();
    setup(prisma);
    prisma.blockedPair.findUnique.mockResolvedValue(null);
    prisma.workSession.findFirst.mockResolvedValue(null);

    const dto = await service.assign('delivery-1', DRIVER);

    expect(dto.status).toBe('assigned');
    expect(prisma.workSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ driverId: DRIVER, sellerId: SELLER }),
      }),
    );
    expect(prisma.deliveryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deliveryId: 'delivery-1', actorId: DRIVER, action: 'assigned' } }),
    );
  });

  it('пара заблокирована 289-ФЗ → 409 + событие blocked_by_289fz (запрос жив)', async () => {
    const { service, prisma } = makeService();
    setup(prisma);
    prisma.blockedPair.findUnique.mockResolvedValue({
      driverId: DRIVER,
      sellerId: SELLER,
      reason: 'причина',
      unblockAt: null,
    });

    // Событие пишется ОТДЕЛЬНО (this.prisma), транзакция откатывается.
    let conflict: unknown;
    try {
      await service.assign('delivery-1', DRIVER);
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(ConflictException);
    expect((conflict as ConflictException).getResponse()).toMatchObject({
      code: DELIVERY_PAIR_BLOCKED_CODE,
    });
    expect(prisma.deliveryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveryId: 'delivery-1', action: 'blocked_by_289fz' }),
      }),
    );
    expect(prisma.deliveryRequest.update).not.toHaveBeenCalled();
  });

  it('своя же бронь → 403', async () => {
    const { service, prisma } = makeService();
    mockTransaction(prisma);
    prisma.deliveryRequest.findUnique.mockResolvedValue({
      id: 'delivery-1',
      status: 'open',
      buyerId: DRIVER,
      pickupPoint: { ownerId: SELLER },
    });
    await expect(service.assign('delivery-1', DRIVER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('уже есть открытая смена (другой продавец) → 409', async () => {
    const { service, prisma } = makeService();
    setup(prisma);
    prisma.blockedPair.findUnique.mockResolvedValue(null);
    prisma.workSession.findFirst.mockResolvedValue({ id: 'ws-1', sellerId: 'seller-other' });

    await expect(service.assign('delivery-1', DRIVER)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.workSession.create).not.toHaveBeenCalled();
  });

  it('заказ уже взят другим → 409', async () => {
    const { service, prisma } = makeService();
    mockTransaction(prisma);
    prisma.deliveryRequest.findUnique.mockResolvedValue({
      id: 'delivery-1',
      status: 'assigned',
      buyerId: BUYER,
      assignedDriverId: OTHER_DRIVER,
      pickupPoint: { ownerId: SELLER },
    });
    await expect(service.assign('delivery-1', DRIVER)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('DeliveriesService.start / deliver / cancel', () => {

  it('start: только назначенный водитель, assigned → in_transit', async () => {
    const { service, prisma } = makeService();
    mockTransaction(prisma);
    prisma.deliveryRequest.findUnique.mockResolvedValue({
      id: 'delivery-1',
      status: 'assigned',
      assignedDriverId: DRIVER,
    });
    prisma.deliveryRequest.update.mockResolvedValue(
      makeDelivery({ status: 'in_transit', assignedDriverId: DRIVER }),
    );

    const dto = await service.start('delivery-1', DRIVER);
    expect(dto.status).toBe('in_transit');

    // Чужой водитель → 403
    await expect(service.start('delivery-1', OTHER_DRIVER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('deliver: закрывает смену пары и проверяет серию 289-ФЗ', async () => {
    const { service, prisma, workHours } = makeService();
    mockTransaction(prisma);
    prisma.deliveryRequest.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === 'delivery-1') {
        // Первая транзакция (статусы) — уже in_transit.
        return {
          id: 'delivery-1',
          status: 'in_transit',
          assignedDriverId: DRIVER,
          pickupPoint: { ownerId: SELLER },
        };
      }
      return null;
    });
    // closePairSession: перечитывает заказ и ищет открытую смену.
    prisma.deliveryRequest.findUniqueOrThrow.mockResolvedValue({
      assignedDriverId: DRIVER,
      pickupPoint: { ownerId: SELLER },
    });
    prisma.deliveryRequest.update.mockResolvedValue(
      makeDelivery({ status: 'delivered', assignedDriverId: DRIVER, deliveredAt: new Date() }),
    );
    prisma.workSession.findFirst.mockResolvedValue({ id: 'ws-1', sellerId: SELLER, endedAt: null });

    const dto = await service.deliver('delivery-1', DRIVER);

    expect(dto.status).toBe('delivered');
    expect(workHours.endSession).toHaveBeenCalledWith('ws-1', DRIVER);
    expect(workHours.enforceSeriesForPair).toHaveBeenCalledWith(DRIVER, SELLER);
  });

  it('cancel до выезда: покупатель может, смена закрывается', async () => {
    const { service, prisma, workHours } = makeService();
    mockTransaction(prisma);
    prisma.deliveryRequest.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === 'delivery-1') {
        return {
          id: 'delivery-1',
          status: 'assigned',
          buyerId: BUYER,
          assignedDriverId: DRIVER,
          pickupPoint: { ownerId: SELLER },
        };
      }
      return null;
    });
    prisma.deliveryRequest.findUniqueOrThrow.mockResolvedValue({
      assignedDriverId: DRIVER,
      pickupPoint: { ownerId: SELLER },
    });
    prisma.deliveryRequest.update.mockResolvedValue(
      makeDelivery({ status: 'cancelled', assignedDriverId: DRIVER }),
    );
    prisma.workSession.findFirst.mockResolvedValue({ id: 'ws-1', endedAt: null });

    const dto = await service.cancel('delivery-1', BUYER);
    expect(dto.status).toBe('cancelled');
    // Актёр закрытия — водитель пары: endSession пускает только
    // сторону пары (ADR-011), а триггер — системный (ADR-015).
    expect(workHours.endSession).toHaveBeenCalledWith('ws-1', DRIVER);
  });

  it('cancel после выезда: только водитель и только с причиной', async () => {
    const { service, prisma } = makeService();
    mockTransaction(prisma);
    prisma.deliveryRequest.findUnique.mockResolvedValue({
      id: 'delivery-1',
      status: 'in_transit',
      buyerId: BUYER,
      assignedDriverId: DRIVER,
    });

    await expect(service.cancel('delivery-1', BUYER)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.cancel('delivery-1', DRIVER)).rejects.toBeInstanceOf(BadRequestException);

    prisma.deliveryRequest.update.mockResolvedValue(makeDelivery({ status: 'cancelled' }));
    prisma.workSession.findFirst.mockResolvedValue(null);
    const dto = await service.cancel('delivery-1', DRIVER, 'машину загрузили другим рейсом');
    expect(dto.status).toBe('cancelled');
  });

  it('cancel чужим → 403; несуществующий → 404', async () => {
    const { service, prisma } = makeService();
    mockTransaction(prisma);
    prisma.deliveryRequest.findUnique.mockResolvedValue({
      id: 'delivery-1',
      status: 'open',
      buyerId: BUYER,
      assignedDriverId: null,
    });
    await expect(service.cancel('delivery-1', OTHER_DRIVER)).rejects.toBeInstanceOf(ForbiddenException);

    prisma.deliveryRequest.findUnique.mockResolvedValue(null);
    await expect(service.cancel('delivery-404', DRIVER)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DeliveriesService.expireStale (TTL)', () => {
  it('просроченные open → expired, другие не трогает', async () => {
    const { service, prisma } = makeService();
    mockTransaction(prisma);
    prisma.deliveryRequest.findMany.mockResolvedValue([{ id: 'stale-1' }]);
    prisma.deliveryRequest.findUnique.mockResolvedValueOnce({ id: 'stale-1', status: 'open' });

    const expired = await service.expireStale();

    expect(expired).toBe(1);
    expect(prisma.deliveryRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'stale-1' }, data: { status: 'expired' } }),
    );
    expect(prisma.deliveryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { deliveryId: 'stale-1', actorId: null, action: 'expired' },
      }),
    );
  });
});

describe('DeliveriesService (DTO и приватность кодов)', () => {
  it('QR-коды видны только сторонам, не чужому водителю', async () => {
    const { service, prisma } = makeService();
    prisma.deliveryRequest.findMany.mockResolvedValue([makeDelivery()]);
    prisma.geoPoint.findMany.mockResolvedValue([]);

    const open = await service.findOpen(OTHER_DRIVER);
    expect(open[0].pickupCode).toBeNull();
    expect(open[0].dropoffCode).toBeNull();

    const mine = await service.findMine(BUYER);
    expect(mine[0].pickupCode).toBe('pickup-uuid');
    expect(mine[0].dropoffCode).toBe('dropoff-uuid');
  });
});

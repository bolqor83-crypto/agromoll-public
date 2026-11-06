/**
 * Unit-тесты ReputationService (v0.5.0, подэтап A, ADR-013).
 *
 * Ядро расчёта — computeFromEvents — чистая функция: наборы событий
 * собираются вручную, без БД. Веса, порог RATING_MIN_DEALS, анти-накрутка
 * и нейтральность разрешённых споров покрыты кейсами ниже. Триггеры
 * (safeOnBookingDelivery / safeOnDebtChanged) — на моке Prisma.
 */
import { Test } from '@nestjs/testing';
import type { BookingEvent, DebtEvent } from '@prisma/client';
import { ReputationService } from './reputation.service';
import { PrismaService } from '../prisma/prisma.service';

/** Значения ENV по умолчанию (спецификация v0.5.0-A). */
const MIN_DEALS = 5;
const MAX_PAIR_DEALS = 10;
const PAIR_WINDOW_DAYS = 30;
const WEIGHT_OK = 1.0;
const WEIGHT_MINOR = 0.5;
const WEIGHT_AUTO = 0.3;
const WEIGHT_DISPUTE = 1.0;
const PAIR_CAP = 0.3;

const SELLER = 'seller-1';
const BUYER = 'buyer-1';
const OTHER_BUYER = 'buyer-2';

type RatedBookingEvent = BookingEvent & {
  booking: { buyerId: string; listing: { sellerId: string } };
};

/** Событие приёмки от лица продавца SELLER. */
function dealEvent(
  action: 'delivery_confirmed' | 'delivery_disputed' | 'system_auto_confirmed',
  opts: {
    qualityFlag?: string;
    buyerId?: string;
    sellerId?: string;
    createdAt?: Date;
    id?: string;
  } = {},
): RatedBookingEvent {
  const buyerId = opts.buyerId ?? BUYER;
  const sellerId = opts.sellerId ?? SELLER;
  return {
    id: opts.id ?? `event-${Math.random().toString(36).slice(2)}`,
    bookingId: 'booking-1',
    actorId: buyerId,
    action,
    payload: opts.qualityFlag ? { qualityFlag: opts.qualityFlag } : null,
    createdAt: opts.createdAt ?? new Date(),
    booking: { buyerId, listing: { sellerId } },
  } as unknown as RatedBookingEvent;
}

/** Событие долга дебитора. */
function debtEvent(
  action: 'settled' | 'disputed' | 'resolve_confirmed',
  debtId = 'debt-1',
): Pick<DebtEvent, 'debtId' | 'action'> {
  return { debtId, action };
}

/** Сервис с дефолтными весами и моком Prisma. */
interface PrismaMock {
  bookingEvent: { findMany: jest.Mock; count: jest.Mock };
  debtEvent: { findMany: jest.Mock };
  reputationSnapshot: { upsert: jest.Mock; findUnique: jest.Mock };
  reputationEvent: { create: jest.Mock; findMany: jest.Mock };
  booking: { findUniqueOrThrow: jest.Mock };
  debt: { findUniqueOrThrow: jest.Mock };
  user: { findUnique: jest.Mock };
}

function makeService(): { service: ReputationService; prisma: PrismaMock } {
  const prisma: PrismaMock = {
    bookingEvent: { findMany: jest.fn(), count: jest.fn() },
    debtEvent: { findMany: jest.fn() },
    reputationSnapshot: { upsert: jest.fn(), findUnique: jest.fn() },
    reputationEvent: { create: jest.fn(), findMany: jest.fn() },
    booking: { findUniqueOrThrow: jest.fn() },
    debt: { findUniqueOrThrow: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  const service = new ReputationService(
    prisma as unknown as PrismaService,
    MIN_DEALS,
    MAX_PAIR_DEALS,
    PAIR_WINDOW_DAYS,
    WEIGHT_OK,
    WEIGHT_MINOR,
    WEIGHT_AUTO,
    WEIGHT_DISPUTE,
    PAIR_CAP,
  );
  return { service, prisma };
}

/** n успешных сделок (rated = чей рейтинг считаем: продавец или покупатель). */
function okDeals(n: number, opts: { buyerId?: string; sellerId?: string } = {}): RatedBookingEvent[] {
  return Array.from({ length: n }, () => dealEvent('delivery_confirmed', { qualityFlag: 'ok', ...opts }));
}

describe('ReputationService.computeFromEvents (веса)', () => {
  it('5 успешных сделок продавца → score 5.0, dealsCount 5', () => {
    const { service } = makeService();
    const result = service.computeFromEvents(SELLER, okDeals(5), []);
    expect(result.score).toBe(5);
    expect(result.dealsCount).toBe(5);
    expect(result.disputesCount).toBe(0);
    expect(result.totalWeight).toBe(5);
  });

  it('покупателю сделка идёт полным весом даже при minor_issue (качество — зона продавца)', () => {
    const { service } = makeService();
    const events = Array.from({ length: 5 }, () =>
      dealEvent('delivery_confirmed', { qualityFlag: 'minor_issue' }),
    );
    const buyerResult = service.computeFromEvents(BUYER, events, []);
    expect(buyerResult.score).toBe(5);
    expect(buyerResult.dealsCount).toBe(5);
  });

  it('minor_issue продавцу — вес 0.5: 4 мелких + 1 ok → 3.0', () => {
    const { service } = makeService();
    const events = [
      ...Array.from({ length: 4 }, () => dealEvent('delivery_confirmed', { qualityFlag: 'minor_issue' })),
      dealEvent('delivery_confirmed', { qualityFlag: 'ok' }),
    ];
    const result = service.computeFromEvents(SELLER, events, []);
    expect(result.score).toBe(3);
    expect(result.dealsCount).toBe(5);
  });

  it('спор по качеству: продавцу −1.0 (4 ok + 1 спор → 3.0), покупателю нейтрально', () => {
    const { service } = makeService();
    const events = [...okDeals(4), dealEvent('delivery_disputed')];

    const sellerResult = service.computeFromEvents(SELLER, events, []);
    expect(sellerResult.score).toBe(3);
    expect(sellerResult.disputesCount).toBe(1);

    const buyerResult = service.computeFromEvents(BUYER, events, []);
    // для покупателя спор исключён: 4 сделки, вес 4 < порога 5 → null
    expect(buyerResult.score).toBeNull();
    expect(buyerResult.disputesCount).toBe(0);
  });

  it('авто-подтверждение весит меньше: 5 авто → 1.5, autoConfirmedCount 5', () => {
    const { service } = makeService();
    const events = Array.from({ length: 5 }, () => dealEvent('system_auto_confirmed'));
    const result = service.computeFromEvents(SELLER, events, []);
    expect(result.score).toBe(1.5);
    expect(result.autoConfirmedCount).toBe(5);
    expect(result.dealsCount).toBe(0);
  });

  it('кламп в [0, 5]: только споры → 0.0', () => {
    const { service } = makeService();
    const events = Array.from({ length: 5 }, () => dealEvent('delivery_disputed'));
    const result = service.computeFromEvents(SELLER, events, []);
    expect(result.score).toBe(0);
    expect(result.disputesCount).toBe(5);
  });
});

describe('ReputationService.computeFromEvents (порог RATING_MIN_DEALS)', () => {
  it('меньше 5 взвешенных событий → score null', () => {
    const { service } = makeService();
    const result = service.computeFromEvents(SELLER, okDeals(4), []);
    expect(result.score).toBeNull();
    expect(result.dealsCount).toBe(4);
    expect(result.totalWeight).toBe(4);
  });

  it('погашенные долги приближают к порогу: 4 сделки + 1 settled → score есть', () => {
    const { service } = makeService();
    const computed = service.computeFromEvents(SELLER, okDeals(4), [debtEvent('settled')]);
    expect(computed.totalWeight).toBe(5);
    // pos = 4 + 1 = 5, neg = 0 → 5.0
    expect(computed.score).toBe(5);
  });
});

describe('ReputationService.computeFromEvents (долги)', () => {
  it('погашенный долг — +1.0 дебитору', () => {
    const { service } = makeService();
    const result = service.computeFromEvents(BUYER, okDeals(4), [debtEvent('settled', 'd1')]);
    expect(result.score).toBe(5);
  });

  it('спор по долгу — −1.0 дебитору', () => {
    const { service } = makeService();
    const result = service.computeFromEvents(BUYER, okDeals(4), [debtEvent('disputed', 'd1')]);
    // pos 4, neg 1, tot 5 → 5*(4-1)/5 = 3.0
    expect(result.score).toBe(3);
    expect(result.disputesCount).toBe(1);
  });

  it('спор, разрешённый обоюдно, — нейтрален: исключается целиком', () => {
    const { service } = makeService();
    const events = okDeals(5);
    const debts = [debtEvent('disputed', 'd1'), debtEvent('resolve_confirmed', 'd1')];
    const result = service.computeFromEvents(BUYER, events, debts);
    // спор нейтрализован: pos 5, neg 0, tot 5 → 5.0
    expect(result.score).toBe(5);
    expect(result.disputesCount).toBe(0);
  });
});

describe('ReputationService.computeFromEvents (анти-накрутка)', () => {
  it('более 10 сделок одной пары за 30 дней — все сделки пары с весом 0.3', () => {
    const { service } = makeService();
    const events = okDeals(11); // все buyer-1 ↔ seller-1, сейчас
    const result = service.computeFromEvents(SELLER, events, []);
    // pos = 11 × 0.3 = 3.3, tot = 11 → 5 × 3.3 / 11 = 1.5
    expect(result.score).toBe(1.5);
    expect(result.dealsCount).toBe(11);
  });

  it('сделки разных пар не капаются: 11 сделок с разными покупателями → 5.0', () => {
    const { service } = makeService();
    const events = Array.from({ length: 11 }, (_, i) =>
      dealEvent('delivery_confirmed', { qualityFlag: 'ok', buyerId: `${OTHER_BUYER}-${i}` }),
    );
    const result = service.computeFromEvents(SELLER, events, []);
    expect(result.score).toBe(5);
  });

  it('окно 30 дней: старые сделки пары не капаются', () => {
    const { service } = makeService();
    const old = new Date(Date.now() - 31 * 24 * 3_600_000);
    const events = okDeals(11, {}).map((event, index) => ({
      ...event,
      id: `old-${index}`,
      createdAt: old,
    }));
    const result = service.computeFromEvents(SELLER, events, []);
    expect(result.score).toBe(5);
  });

  it('ровно 10 сделок пары — ещё не накрутка, вес полный', () => {
    const { service } = makeService();
    const result = service.computeFromEvents(SELLER, okDeals(10), []);
    expect(result.score).toBe(5);
  });
});

describe('ReputationService.recalculate (снимок)', () => {
  it('пересчитывает и атомарно upsert-ит снимок', async () => {
    const { service, prisma } = makeService();
    prisma.bookingEvent.findMany.mockResolvedValue(okDeals(5));
    prisma.debtEvent.findMany.mockResolvedValue([]);
    prisma.reputationSnapshot.upsert.mockResolvedValue({});

    const computed = await service.recalculate(SELLER);

    expect(computed.score).toBe(5);
    expect(prisma.reputationSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: SELLER },
        create: expect.objectContaining({ userId: SELLER, score: 5, dealsCount: 5 }),
        update: expect.objectContaining({ score: 5, dealsCount: 5 }),
      }),
    );
  });
});

describe('ReputationService.safeOnBookingDelivery (триггер)', () => {
  /** Настроить мок под завершённую сделку. */
  function mockBookingDelivery(prisma: PrismaMock, action: string, qualityFlag?: string) {
    prisma.booking.findUniqueOrThrow.mockResolvedValue({
      buyerId: BUYER,
      listing: { sellerId: SELLER },
      events: [{ action, payload: qualityFlag ? { qualityFlag } : null }],
    });
    prisma.bookingEvent.count.mockResolvedValue(0);
    prisma.bookingEvent.findMany.mockResolvedValue([]);
    prisma.debtEvent.findMany.mockResolvedValue([]);
    prisma.reputationSnapshot.upsert.mockResolvedValue({});
  }

  it('delivery_confirmed ok: события журнала обеим сторонам + пересчёт обоих', async () => {
    const { service, prisma } = makeService();
    mockBookingDelivery(prisma, 'delivery_confirmed', 'ok');

    await service.safeOnBookingDelivery('booking-1');

    const created = prisma.reputationEvent.create.mock.calls;
    expect(created).toHaveLength(2); // продавец + покупатель
    expect(prisma.reputationSnapshot.upsert).toHaveBeenCalledTimes(2);
  });

  it('delivery_disputed: событие dispute_opened только продавцу', async () => {
    const { service, prisma } = makeService();
    mockBookingDelivery(prisma, 'delivery_disputed');

    await service.safeOnBookingDelivery('booking-1');

    const created = prisma.reputationEvent.create.mock.calls;
    expect(created).toHaveLength(1);
    expect(created[0][0].data).toMatchObject({
      userId: SELLER,
      action: 'dispute_opened',
      delta: -WEIGHT_DISPUTE,
    });
  });

  it('сбой пересчёта не бросает наружу (сделка не откатывается)', async () => {
    const { service, prisma } = makeService();
    prisma.booking.findUniqueOrThrow.mockRejectedValue(new Error('db down'));

    await expect(service.safeOnBookingDelivery('booking-1')).resolves.toBeUndefined();
  });

  it('пара превысила лимит сделок — penalty_applied обеим сторонам', async () => {
    const { service, prisma } = makeService();
    mockBookingDelivery(prisma, 'delivery_confirmed', 'ok');
    prisma.bookingEvent.count.mockResolvedValue(MAX_PAIR_DEALS + 1);

    await service.safeOnBookingDelivery('booking-1');

    const created = prisma.reputationEvent.create.mock.calls;
    const penalties = created.filter((call) => call[0].data.action === 'penalty_applied');
    expect(penalties).toHaveLength(2);
    expect(penalties[0][0].data.delta).toBeCloseTo(PAIR_CAP - WEIGHT_OK, 5);
  });
});

describe('ReputationService.safeOnDebtChanged (триггер)', () => {
  it('settled: deal_confirmed дебитору + пересчёт', async () => {
    const { service, prisma } = makeService();
    prisma.debt.findUniqueOrThrow.mockResolvedValue({
      debtorId: BUYER,
      events: [{ action: 'settled', payload: null }],
    });
    prisma.bookingEvent.findMany.mockResolvedValue([]);
    prisma.debtEvent.findMany.mockResolvedValue([]);
    prisma.reputationSnapshot.upsert.mockResolvedValue({});

    await service.safeOnDebtChanged('debt-1');

    expect(prisma.reputationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: BUYER, action: 'deal_confirmed', delta: WEIGHT_OK, reason: 'debt_settled' },
      }),
    );
    expect(prisma.reputationSnapshot.upsert).toHaveBeenCalledTimes(1);
  });

  it('resolve_confirmed: нейтральное событие (delta 0)', async () => {
    const { service, prisma } = makeService();
    prisma.debt.findUniqueOrThrow.mockResolvedValue({
      debtorId: BUYER,
      events: [{ action: 'resolve_confirmed', payload: null }],
    });
    prisma.bookingEvent.findMany.mockResolvedValue([]);
    prisma.debtEvent.findMany.mockResolvedValue([]);
    prisma.reputationSnapshot.upsert.mockResolvedValue({});

    await service.safeOnDebtChanged('debt-1');

    expect(prisma.reputationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: BUYER,
          action: 'dispute_resolved',
          delta: 0,
          reason: 'debt_resolved_mutually',
        },
      }),
    );
  });
});

describe('ReputationService (чтение API)', () => {
  it('getPublicProfile: снимок есть — отвечает из снимка', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: SELLER });
    prisma.reputationSnapshot.findUnique.mockResolvedValue({
      score: 4.7,
      dealsCount: 42,
      disputesCount: 1,
      autoConfirmedCount: 2,
      lastCalculatedAt: new Date('2026-11-01T08:00:00Z'),
    });

    const dto = await service.getPublicProfile(SELLER);
    expect(dto.score).toBe(4.7);
    expect(dto.dealsCount).toBe(42);
    expect(dto.reason).toBeUndefined();
    expect(dto.lastCalculatedAt).toBe('2026-11-01T08:00:00.000Z');
  });

  it('getPublicProfile: снимка нет — расчёт на лету без записи', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: SELLER });
    prisma.reputationSnapshot.findUnique.mockResolvedValue(null);
    prisma.bookingEvent.findMany.mockResolvedValue(okDeals(3));
    prisma.debtEvent.findMany.mockResolvedValue([]);

    const dto = await service.getPublicProfile(SELLER);
    expect(dto.score).toBeNull();
    expect(dto.reason).toBe('min_deals_not_reached');
    expect(dto.lastCalculatedAt).toBeNull();
    expect(prisma.reputationSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('getPublicProfile: пользователь не найден → 404', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getPublicProfile('missing')).rejects.toThrow('Пользователь не найден');
  });

  it('getMyProfile: события + сколько осталось до рейтинга', async () => {
    const { service, prisma } = makeService();
    prisma.bookingEvent.findMany.mockResolvedValue(okDeals(3));
    prisma.debtEvent.findMany.mockResolvedValue([]);
    prisma.reputationEvent.findMany.mockResolvedValue([
      {
        id: 'e1',
        action: 'deal_confirmed',
        delta: 1.0,
        reason: 'ok',
        createdAt: new Date('2026-11-01T08:00:00Z'),
      },
    ]);

    const dto = await service.getMyProfile(SELLER);
    expect(dto.score).toBeNull();
    expect(dto.reason).toBe('min_deals_not_reached');
    expect(dto.dealsToRating).toBe(2); // 5 − 3
    expect(dto.events).toHaveLength(1);
    expect(dto.events[0].action).toBe('deal_confirmed');
  });
});

/** Гарантия DI-конфигурации Nest: сервис создаётся из тестового модуля. */
describe('ReputationService (DI)', () => {
  it('создаётся Testing-модулем без ошибок', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: PrismaService,
          useValue: {},
        },
        { provide: 'RATING_MIN_DEALS', useValue: MIN_DEALS },
        { provide: 'RATING_MAX_PAIR_DEALS', useValue: MAX_PAIR_DEALS },
        { provide: 'RATING_PAIR_WINDOW_DAYS', useValue: PAIR_WINDOW_DAYS },
        { provide: 'RATING_WEIGHT_OK', useValue: WEIGHT_OK },
        { provide: 'RATING_WEIGHT_MINOR', useValue: WEIGHT_MINOR },
        { provide: 'RATING_WEIGHT_AUTO', useValue: WEIGHT_AUTO },
        { provide: 'RATING_WEIGHT_DISPUTE', useValue: WEIGHT_DISPUTE },
        { provide: 'RATING_PAIR_CAP_WEIGHT', useValue: PAIR_CAP },
        ReputationService,
      ],
    }).compile();
    expect(moduleRef.get(ReputationService)).toBeInstanceOf(ReputationService);
  });
});

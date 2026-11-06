/**
 * E2E подэтапа B (v0.3.0): идемпотентность POST-мутаций.
 *
 * Требует DATABASE_URL (+ Redis при REDIS_URL) — запускается в CI
 * с service-контейнерами (`pnpm --filter @agromoll/api test:e2e`).
 *
 * Сценарии: двойная отправка одного clientUuid не создаёт дубль
 * (тот же ответ, одна бронь, резерв посчитан один раз); состояние
 * received даёт 409 IDEMPOTENCY_IN_PROGRESS; без ключа — обычный путь.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { authHeader, registerAndLogin } from './auth.helper';
import type { TestUser } from './auth.helper';

describe('Idempotency (e2e, HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let buyer: TestUser;
  let seller: TestUser;
  let listingId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    buyer = await registerAndLogin(app, 'buyer');
    seller = await registerAndLogin(app, 'seller');
    const listing = await prisma.listing.create({
      data: {
        sellerId: seller.id,
        title: 'Помидоры розовые',
        category: 'vegetables',
        unit: 'kg',
        pricePerUnit: 85.5,
        quantityAvailable: 100,
        status: 'active',
      },
    });
    listingId = listing.id;
  });

  it('двойная отправка одного clientUuid — не создаёт дубль', async () => {
    const key = '11111111-1111-4111-8111-111111111111';
    const body = { listingId, requestedQuantity: 20 };

    const first = await request(app.getHttpServer())
      .post('/bookings')
      .set(authHeader(buyer))
      .set('X-Idempotency-Key', key)
      .send(body)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/bookings')
      .set(authHeader(buyer))
      .set('X-Idempotency-Key', key)
      .send(body)
      .expect(201); // сохранённый статус тоже 201

    // ответы совпадают
    expect(second.body.id).toBe(first.body.id);

    // в БД ровно одна бронь и один резерв
    const bookings = await prisma.booking.findMany({ where: { buyerId: buyer.id } });
    expect(bookings).toHaveLength(1);
    expect(bookings[0].requestedQuantity).toBe(20);

    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.quantityReserved).toBe(20);

    // строка outbox — processed с результатом
    const op = await prisma.outboxOperation.findUnique({ where: { clientUuid: key } });
    expect(op?.state).toBe('processed');
    expect(op?.operationType).toBe('create_booking');
    expect((op?.result as { body: { id: string } })?.body?.id).toBe(first.body.id);
  });

  it('received-ключ (параллельный дубль) — 409 IDEMPOTENCY_IN_PROGRESS', async () => {
    const key = '22222222-2222-4222-8222-222222222222';
    // эмулируем «операция уже в обработке»: вставляем строку вручную
    await prisma.outboxOperation.create({
      data: {
        clientUuid: key,
        userId: buyer.id,
        operationType: 'create_booking',
        payload: { listingId, requestedQuantity: 5 },
        state: 'received',
      },
    });

    const res = await request(app.getHttpServer())
      .post('/bookings')
      .set(authHeader(buyer))
      .set('X-Idempotency-Key', key)
      .send({ listingId, requestedQuantity: 5 })
      .expect(409);

    expect(res.body).toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
    // бронь не создана
    expect(await prisma.booking.count({ where: { buyerId: buyer.id } })).toBe(0);
  });

  it('без X-Idempotency-Key — обычное выполнение (обратная совместимость)', async () => {
    await request(app.getHttpServer())
      .post('/bookings')
      .set(authHeader(buyer))
      .send({ listingId, requestedQuantity: 7 })
      .expect(201);

    expect(await prisma.booking.count({ where: { buyerId: buyer.id } })).toBe(1);
    expect(await prisma.outboxOperation.count()).toBe(0);
  });

  it('разные ключи — разные операции (два запроса, две брони)', async () => {
    for (const [key, qty] of [
      ['33333333-3333-4333-8333-333333333331', 10],
      ['33333333-3333-4333-8333-333333333332', 15],
    ] as const) {
      await request(app.getHttpServer())
        .post('/bookings')
        .set(authHeader(buyer))
        .set('X-Idempotency-Key', key)
        .send({ listingId, requestedQuantity: qty })
        .expect(201);
    }

    expect(await prisma.booking.count({ where: { buyerId: buyer.id } })).toBe(2);
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.quantityReserved).toBe(25);
  });

  it('идемпотентность и на отмене: дубль отмены не ломает состояние', async () => {
    const createKey = '44444444-4444-4444-8444-444444444441';
    const cancelKey = '44444444-4444-4444-8444-444444444442';

    const created = await request(app.getHttpServer())
      .post('/bookings')
      .set(authHeader(buyer))
      .set('X-Idempotency-Key', createKey)
      .send({ listingId, requestedQuantity: 10 })
      .expect(201);

    const cancelFirst = await request(app.getHttpServer())
      .post(`/bookings/${created.body.id}/cancel`)
      .set(authHeader(buyer))
      .set('X-Idempotency-Key', cancelKey)
      .send({ reason: 'не успел' })
      .expect(201);
    expect(cancelFirst.body.status).toBe('cancelled');

    // дубль отмены — реплей сохранённого ответа, а не 409 бизнес-конфликта
    const cancelSecond = await request(app.getHttpServer())
      .post(`/bookings/${created.body.id}/cancel`)
      .set(authHeader(buyer))
      .set('X-Idempotency-Key', cancelKey)
      .send({ reason: 'не успел' })
      .expect(201);
    expect(cancelSecond.body.status).toBe('cancelled');

    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.quantityReserved).toBe(0);
  });

  it('ошибка обработчика → failed; повтор с тем же ключом выполняется', async () => {
    const key = '55555555-5555-4555-8555-555555555551';

    // первая попытка: бронируем больше остатка — 409 бизнес-конфликт
    await request(app.getHttpServer())
      .post('/bookings')
      .set(authHeader(buyer))
      .set('X-Idempotency-Key', key)
      .send({ listingId, requestedQuantity: 999 })
      .expect(409);

    const failed = await prisma.outboxOperation.findUnique({ where: { clientUuid: key } });
    expect(failed?.state).toBe('failed');

    // повтор с корректным телом под тем же ключом — выполняется
    const retried = await request(app.getHttpServer())
      .post('/bookings')
      .set(authHeader(buyer))
      .set('X-Idempotency-Key', key)
      .send({ listingId, requestedQuantity: 12 })
      .expect(201);
    expect(retried.body.requestedQuantity).toBe(12);

    const op = await prisma.outboxOperation.findUnique({ where: { clientUuid: key } });
    expect(op?.state).toBe('processed');
  });
});

/** Полная очистка таблиц в порядке внешних ключей. */
async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.outboxOperation.deleteMany();
  await prisma.bookingEvent.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.deliveryEvent.deleteMany();
  await prisma.deliveryRequest.deleteMany();
  await prisma.geoPoint.deleteMany();
  await prisma.user.deleteMany();
}

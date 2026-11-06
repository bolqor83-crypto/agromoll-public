/**
 * E2E долгов (v0.4.0, подэтап A, ADR-010): полный HTTP-цикл.
 *
 * Требует DATABASE_URL и применённых миграций — запускается в CI
 * (service-контейнеры postgis + redis) командой
 * `pnpm --filter @agromoll/api test:e2e`.
 *
 * Сценарии: создание → погашение; спор → обоюдное разрешение;
 * правила (самому себе 400, чужой 404/403, повтор settle 409);
 * напоминание с кулдауном (429 + in-app уведомление дебитору);
 * сводка и контрагенты (по броням); идемпотентность create_debt
 * (двойной POST с одним X-Idempotency-Key — один долг, тот же ответ).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { authHeader, registerAndLogin } from './auth.helper';
import type { TestUser } from './auth.helper';

describe('Debts flow (e2e, HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let creditor: TestUser; // кредитор (любая роль — здесь seller)
  let debtor: TestUser; // дебитор (buyer)
  let outsider: TestUser; // посторонний

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
    creditor = await registerAndLogin(app, 'seller');
    debtor = await registerAndLogin(app, 'buyer');
    outsider = await registerAndLogin(app, 'driver');
  });

  const post = (user: TestUser, url: string, key?: string) => {
    const req = request(app.getHttpServer())
      .post(url)
      .set(authHeader(user));
    return key ? req.set({ 'X-Idempotency-Key': key }) : req;
  };

  const get = (user: TestUser, url: string) =>
    request(app.getHttpServer()).get(url).set(authHeader(user));

  // ─── Полный цикл: create → settle ────────────────────────────────────────

  it('создание → погашение одной стороной → settled + журнал', async () => {
    const created = await post(creditor, '/debts')
      .send({ debtorId: debtor.id, amount: 12500.5, description: 'Помидоры, 2 ящика' })
      .expect(201);
    const debtId = created.body.id as string;

    expect(created.body).toMatchObject({
      creditorId: creditor.id,
      debtorId: debtor.id,
      status: 'active',
      amount: '12500.5',
      currency: 'RUB',
      canRemind: true,
      isOverdue: false,
    });

    // settle может и дебитор: обе стороны подтверждают погашение
    const settled = await post(debtor, `/debts/${debtId}/settle`).send({}).expect(201);
    expect(settled.body.status).toBe('settled');
    expect(settled.body.settledAt).toEqual(expect.any(String));

    // повторный settle → 409
    await post(creditor, `/debts/${debtId}/settle`).send({}).expect(409);

    // журнал: created → settled
    const events = await prisma.debtEvent.findMany({
      where: { debtId },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual(['created', 'settled']);
  });

  it('создание → спор → обоюдное разрешение → settled', async () => {
    const created = await post(creditor, '/debts')
      .send({ debtorId: debtor.id, amount: 4200 })
      .expect(201);
    const debtId = created.body.id as string;

    // спор открывает дебитор (любая сторона)
    const disputed = await post(debtor, `/debts/${debtId}/dispute`)
      .send({ reason: 'частично вернул' })
      .expect(201);
    expect(disputed.body.status).toBe('disputed');

    // спор по уже спорному → 409
    await post(debtor, `/debts/${debtId}/dispute`).send({}).expect(409);

    // первая сторона предлагает закрыть
    const requested = await post(creditor, `/debts/${debtId}/resolve`).send({}).expect(201);
    expect(requested.body.status).toBe('disputed');
    expect(requested.body.resolveRequestedById).toBe(creditor.id);

    // та же сторона повторно → 409 «ждём вторую сторону»
    await post(creditor, `/debts/${debtId}/resolve`).send({}).expect(409);

    // вторая сторона подтверждает — спор закрыт обоюдно
    const resolved = await post(debtor, `/debts/${debtId}/resolve`).send({}).expect(201);
    expect(resolved.body.status).toBe('settled');
    expect(resolved.body.resolveRequestedById).toBeNull();

    // журнал фиксирует оба шага разрешения
    const events = await prisma.debtEvent.findMany({
      where: { debtId },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual([
      'created',
      'disputed',
      'resolve_requested',
      'resolve_confirmed',
    ]);
  });

  // ─── Правила ─────────────────────────────────────────────────────────────

  it('долг самому себе → 400; несуществующий дебитор → 404', async () => {
    await post(creditor, '/debts').send({ debtorId: creditor.id, amount: 100 }).expect(400);
    await post(creditor, '/debts')
      .send({ debtorId: '00000000-0000-4000-8000-000000000099', amount: 100 })
      .expect(404);
  });

  it('сумма вне границ и мусорная валюта → 400 (zod)', async () => {
    await post(creditor, '/debts').send({ debtorId: debtor.id, amount: 0 }).expect(400);
    await post(creditor, '/debts').send({ debtorId: debtor.id, amount: 1_000_001 }).expect(400);
    await post(creditor, '/debts')
      .send({ debtorId: debtor.id, amount: 100.123 })
      .expect(400);
    await post(creditor, '/debts')
      .send({ debtorId: debtor.id, amount: 100, currency: 'USD' })
      .expect(400);
  });

  it('чужой не может погасить/оспорить/разрешить → 403; чужой долг не виден в списке', async () => {
    const created = await post(creditor, '/debts')
      .send({ debtorId: debtor.id, amount: 500 })
      .expect(201);
    const debtId = created.body.id as string;

    await post(outsider, `/debts/${debtId}/settle`).send({}).expect(403);
    await post(outsider, `/debts/${debtId}/dispute`).send({}).expect(403);
    await post(outsider, `/debts/${debtId}/resolve`).send({}).expect(403);

    const outsiderList = await get(outsider, '/debts').expect(200);
    expect(outsiderList.body).toHaveLength(0);
  });

  // ─── Напоминание ─────────────────────────────────────────────────────────

  it('напоминание: кредитор → 201 + in-app дебитору; повтор сразу → 429', async () => {
    const created = await post(creditor, '/debts')
      .send({ debtorId: debtor.id, amount: 800 })
      .expect(201);
    const debtId = created.body.id as string;

    // не-кредитор не может напоминать
    await post(debtor, `/debts/${debtId}/reminder`).send({}).expect(403);

    const first = await post(creditor, `/debts/${debtId}/reminder`).send({}).expect(201);
    expect(first.body).toMatchObject({
      sentAt: expect.any(String),
      nextReminderAt: expect.any(String),
    });

    // кулдаун 24 ч: второе подряд → 429 с кодом и моментом следующей попытки
    const second = await post(creditor, `/debts/${debtId}/reminder`).send({}).expect(429);
    expect(second.body.code).toBe('DEBT_REMINDER_COOLDOWN');
    expect(second.body.nextReminderAt).toEqual(expect.any(String));

    // in-app уведомление дошло дебитору
    const notifications = await get(debtor, '/notifications/me').expect(200);
    expect(notifications.body.unreadCount).toBeGreaterThanOrEqual(1);
    const reminder = (notifications.body.items as { type: string }[]).find(
      (n) => n.type === 'debt_reminder',
    );
    expect(reminder).toBeDefined();
  });

  // ─── Сводка и списки ─────────────────────────────────────────────────────

  it('сводка: мне должны / я должен, раздельно по сторонам', async () => {
    await post(creditor, '/debts').send({ debtorId: debtor.id, amount: 12500 }).expect(201);
    await post(creditor, '/debts').send({ debtorId: debtor.id, amount: 4200.5 }).expect(201);
    await post(debtor, '/debts').send({ debtorId: creditor.id, amount: 300 }).expect(201);
    // погашенный не считается в сводке
    const settledDebt = await post(debtor, '/debts')
      .send({ debtorId: creditor.id, amount: 999 })
      .expect(201);
    await post(debtor, `/debts/${settledDebt.body.id}/settle`).send({}).expect(201);

    const creditorSummary = await get(creditor, '/debts/summary').expect(200);
    expect(creditorSummary.body.owedToMe).toMatchObject({ total: '16700.5', count: 2 });
    expect(creditorSummary.body.iOwe).toMatchObject({ total: '300', count: 1 });

    const debtorSummary = await get(debtor, '/debts/summary').expect(200);
    expect(debtorSummary.body.owedToMe).toMatchObject({ total: '300', count: 1 });
    expect(debtorSummary.body.iOwe).toMatchObject({ total: '16700.5', count: 2 });

    // списки с фильтром статуса: активных 3 (обе стороны: 2 «мне должны»
    // + 1 «я должен»), погашенный 999 ₽ фильтром исключён
    const activeOnly = await get(creditor, '/debts?status=active').expect(200);
    expect(activeOnly.body).toHaveLength(3);
  });

  it('контрагенты появляются после сделки (брони в обе стороны)', async () => {
    // сделка: продавец выставляет лот, покупатель бронирует
    const listing = await post(creditor, '/listings')
      .send({
        title: 'Лук репчатый',
        category: 'vegetables',
        unit: 'box',
        pricePerUnit: 640,
        quantityAvailable: 25,
      })
      .expect(201);
    await post(debtor, '/bookings')
      .send({ listingId: listing.body.id, requestedQuantity: 2 })
      .expect(201);

    const creditorPartners = await get(creditor, '/debts/counterparties').expect(200);
    expect(creditorPartners.body).toEqual([
      expect.objectContaining({ id: debtor.id, displayName: expect.any(String) }),
    ]);

    const debtorPartners = await get(debtor, '/debts/counterparties').expect(200);
    expect(debtorPartners.body).toEqual([
      expect.objectContaining({ id: creditor.id }),
    ]);

    // посторонний без сделок — пустой список
    const outsiderPartners = await get(outsider, '/debts/counterparties').expect(200);
    expect(outsiderPartners.body).toHaveLength(0);
  });

  // ─── Идемпотентность ─────────────────────────────────────────────────────

  it('двойной POST /debts с одним X-Idempotency-Key → один долг, тот же ответ', async () => {
    const key = 'aaaaaaa1-0000-4000-8000-000000000001';
    const body = { debtorId: debtor.id, amount: 5500, description: 'Идемпотентность' };

    const first = await post(creditor, '/debts', key).send(body).expect(201);
    const second = await post(creditor, '/debts', key).send(body).expect(201);

    expect(second.body).toEqual(first.body);
    expect(second.body.id).toBe(first.body.id);

    const debts = await prisma.debt.findMany({ where: { creditorId: creditor.id } });
    expect(debts).toHaveLength(1);
  });
});

async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.debtEvent.deleteMany();
  await prisma.debt.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.outboxOperation.deleteMany();
  await prisma.bookingEvent.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.session.deleteMany();
  await prisma.deliveryEvent.deleteMany();
  await prisma.deliveryRequest.deleteMany();
  await prisma.geoPoint.deleteMany();
  await prisma.user.deleteMany();
}

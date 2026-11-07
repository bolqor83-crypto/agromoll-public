/**
 * E2E апелляций на блокировки 289-ФЗ (v0.6.0-E ADR-035, переписка —
 * v0.7.0-C ADR-037): полный HTTP-цикл.
 *
 * Требует DATABASE_URL и применённых миграций — запускается в CI
 * (service-контейнеры postgis + redis) командой
 * `pnpm --filter @agromoll/api test:e2e`.
 *
 * Сценарии:
 *  1. полный цикл: серия месяцев → блокировка пары → смена 409 →
 *     апелляция (водитель) → дубликат 409 → очередь арбитра → assign →
 *     resolve unblock → пара снова работает (смена 201), строка
 *     блокировки СОХРАНЕНА с аудитом разблока;
 *  2. reject: блокировка остаётся, повторная подача после закрытия —
 *     можно (новый активный кейс);
 *  3. доступ: посторонний не открывает и не читает (404), очередь —
 *     только арбитр (403);
 *  4. mine: продавец пары видит кейс, открытый водителем;
 *  5. ревайв: после разблока серия всё ещё закрыта → крон блокирует
 *     пару снова (та же строка, не дубль) — разблок не «иммунитет».
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkHoursService, addMonths, toMonthKey } from '../src/work-hours/work-hours.service';
import { authHeader, registerAndLogin } from './auth.helper';
import type { TestUser } from './auth.helper';

describe('Block appeals 289-ФЗ (e2e, HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let workHours: WorkHoursService;

  let driver: TestUser;
  let seller: TestUser;
  let outsider: TestUser;
  let arbitrator: TestUser;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    workHours = app.get(WorkHoursService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    driver = await registerAndLogin(app, 'driver');
    seller = await registerAndLogin(app, 'seller');
    outsider = await registerAndLogin(app, 'buyer');

    // Арбитром стать нельзя через API (MARKET_ROLES) — назначаем в БД,
    // как это делает сид/админ (ADR-033/035).
    arbitrator = await registerAndLogin(app, 'buyer');
    await prisma.user.update({
      where: { id: arbitrator.id },
      data: { role: 'arbitrator' },
    });
  });

  const post = (user: TestUser, url: string, key?: string) => {
    const req = request(app.getHttpServer()).post(url).set(authHeader(user));
    return key ? req.set({ 'X-Idempotency-Key': key }) : req;
  };
  const get = (user: TestUser, url: string) =>
    request(app.getHttpServer()).get(url).set(authHeader(user));

  /** Серия из 6 месяцев по 60 ч+ → блокировка пары кроном. */
  async function blockPair(): Promise<string> {
    const month = toMonthKey(new Date());
    for (const back of [0, 1, 2, 3, 4, 5]) {
      await prisma.monthlyPairTotal.create({
        data: {
          driverId: driver.id,
          sellerId: seller.id,
          month: addMonths(month, -back),
          totalMinutes: 60 * 60,
          monthCounted: true,
        },
      });
    }
    expect(await workHours.enforceSeriesLimit()).toBe(1);
    const block = await prisma.blockedPair.findFirstOrThrow({
      where: { driverId: driver.id, sellerId: seller.id, unblockedAt: null },
    });
    return block.id;
  }

  it('полный цикл: блокировка → апелляция → unblock → пара работает', async () => {
    const blockedPairId = await blockPair();

    // Пара заблокирована: смена отклоняется мягким 409.
    await post(driver, '/work-hours/sessions').send({ sellerId: seller.id }).expect(409);

    // Строка пары «Мои часы» несёт id блокировки для апелляции (ADR-035).
    const mine = await get(driver, '/work-hours/me').expect(200);
    expect(mine.body[0]).toMatchObject({
      blocked: true,
      blockedPairId,
      appeal: null,
    });

    // 1. Водитель обжалует блокировку (часы задвоились).
    const appeal = await post(driver, '/appeals')
      .send({
        blockedPairId,
        reason: 'Часы задвоились: отменённые доставки закрывали смены дважды',
      })
      .expect(201);
    expect(appeal.body).toMatchObject({ status: 'open', blockedPairId });

    // Дубликат активного кейса → 409 (одна апелляция на блокировку).
    await post(seller, '/appeals')
      .send({ blockedPairId, reason: 'Продавец пытается подать параллельно' })
      .expect(409);

    // Контрагент (продавец) узнал об обжаловании — in-app уведомление.
    const notified = await prisma.notification.findFirst({
      where: { userId: seller.id, type: 'appeal_opened' },
    });
    expect(notified).not.toBeNull();

    // Строка пары показывает активную апелляцию.
    const mineWithAppeal = await get(driver, '/work-hours/me').expect(200);
    expect(mineWithAppeal.body[0].appeal).toMatchObject({
      id: appeal.body.id,
      status: 'open',
    });

    // 2. Арбитр: очередь → детали с месяцами часов (доказательство) →
    //    взял в работу → решение «снять блокировку».
    const queue = await get(arbitrator, '/appeals/queue').expect(200);
    expect(queue.body.items).toHaveLength(1);
    expect(queue.body.items[0]).toMatchObject({ id: appeal.body.id, status: 'open' });

    const detail = await get(arbitrator, `/appeals/${appeal.body.id}`).expect(200);
    expect(detail.body.months.length).toBeGreaterThanOrEqual(6);
    expect(detail.body.months[0]).toMatchObject({ monthCounted: true });

    await post(arbitrator, `/appeals/${appeal.body.id}/assign`).send({}).expect(201);

    const resolved = await post(arbitrator, `/appeals/${appeal.body.id}/resolve`)
      .send({ decision: 'unblock', notes: 'Смены действительно задвоились' })
      .expect(201);
    expect(resolved.body).toMatchObject({ status: 'unblocked' });

    // 3. Блокировка снята — пара может работать сразу.
    await post(driver, '/work-hours/sessions').send({ sellerId: seller.id }).expect(201);

    // 4. Аудит: строка блокировки НЕ удалена, помечена кем/когда/почему.
    const block = await prisma.blockedPair.findUniqueOrThrow({
      where: { id: blockedPairId },
    });
    expect(block.unblockedAt).not.toBeNull();
    expect(block.unblockedById).toBe(arbitrator.id);
    expect(block.unblockReason).toContain('задвоились');
  });

  it('reject: блокировка остаётся; повторная подача после закрытия — можно', async () => {
    const blockedPairId = await blockPair();

    const appeal = await post(driver, '/appeals')
      .send({ blockedPairId, reason: 'Серия не должна была закрыться, я не работал столько' })
      .expect(201);

    await post(arbitrator, `/appeals/${appeal.body.id}/assign`).send({}).expect(201);
    await post(arbitrator, `/appeals/${appeal.body.id}/resolve`)
      .send({ decision: 'reject', notes: 'Серия действительно закрыта' })
      .expect(201);

    // Блокировка остаётся: смена всё ещё 409.
    await post(driver, '/work-hours/sessions').send({ sellerId: seller.id }).expect(409);

    // Кейс закрыт — подать снова можно (например, с новыми данными).
    const reopened = await post(seller, '/appeals')
      .send({ blockedPairId, reason: 'Нашли накладные: половину смен отменили ошибочно' })
      .expect(201);
    expect(reopened.body.status).toBe('open');
  });

  it('доступ: постороннему — 404, очередь — только арбитр (403)', async () => {
    const blockedPairId = await blockPair();

    // Посторонний не раскрывает даже факт блокировки пары.
    await post(outsider, '/appeals')
      .send({ blockedPairId, reason: 'Посторонний пытается обжаловать' })
      .expect(404);

    const appeal = await post(driver, '/appeals')
      .send({ blockedPairId, reason: 'Часы задвоились, нужна проверка' })
      .expect(201);

    // Очередь — только арбитру.
    await get(driver, '/appeals/queue').expect(403);
    // Детали — сторонам пары и арбитру; постороннему 404.
    await get(outsider, `/appeals/${appeal.body.id}`).expect(404);
    await get(seller, `/appeals/${appeal.body.id}`).expect(200);
  });

  it('mine: обе стороны пары видят кейс, открытый водителем', async () => {
    const blockedPairId = await blockPair();
    await post(driver, '/appeals')
      .send({ blockedPairId, reason: 'Часы считались с ошибкой платформы' })
      .expect(201);

    const mineSeller = await get(seller, '/appeals/mine').expect(200);
    expect(mineSeller.body.items).toHaveLength(1);
    expect(mineSeller.body.items[0].appellant.id).toBe(driver.id);

    // Посторонний не видит чужих апелляций.
    const mineOutsider = await get(outsider, '/appeals/mine').expect(200);
    expect(mineOutsider.body.items).toHaveLength(0);
  });

  it('переписка (v0.7.0-C, ADR-037): арбитр уточняет → сторона отвечает → решение', async () => {
    const blockedPairId = await blockPair();
    const appeal = await post(driver, '/appeals')
      .send({ blockedPairId, reason: 'Часы задвоились из-за отменённых доставок' })
      .expect(201);
    const appealId = appeal.body.id as string;

    await post(arbitrator, `/appeals/${appealId}/assign`).send({}).expect(201);

    // Арбитр спрашивает публично — обе стороны видят сообщение.
    await post(arbitrator, `/appeals/${appealId}/messages`)
      .send({ body: 'Пришлите номера смен, которые закрывались дважды', isInternal: false })
      .expect(201);

    // Арбитр фиксирует служебную заметку — паре она невидима.
    await post(arbitrator, `/appeals/${appealId}/messages`)
      .send({ body: 'Проверил журнал: смены 41 и 42 дублированы', isInternal: true })
      .expect(201);

    // Сторона пары отвечает.
    await post(driver, `/appeals/${appealId}/messages`)
      .send({ body: 'Смены 41 и 42, обе закрывались автоматически' })
      .expect(201);

    // Сторона не может писать служебные заметки — 403.
    await post(driver, `/appeals/${appealId}/messages`)
      .send({ body: 'Попробую отметить служебно', isInternal: true })
      .expect(403);

    // Детали: водитель видит 2 сообщения (своё + вопрос арбитра),
    // арбитр — 3 (+ служебная заметка).
    const driverView = await get(driver, `/appeals/${appealId}`).expect(200);
    expect(driverView.body.messages).toHaveLength(2);
    expect(driverView.body.messages.every((m: { isInternal: boolean }) => !m.isInternal)).toBe(
      true,
    );
    const arbView = await get(arbitrator, `/appeals/${appealId}`).expect(200);
    expect(arbView.body.messages).toHaveLength(3);

    // Отдельный эндпоинт списка — та же видимость.
    const list = await get(seller, `/appeals/${appealId}/messages`).expect(200);
    expect(list.body.items).toHaveLength(2);

    // Посторонний не читает переписку (404).
    await get(outsider, `/appeals/${appealId}/messages`).expect(404);

    // Продавец (вторая сторона) получил push об активности в кейсе.
    const notified = await prisma.notification.findFirst({
      where: { userId: seller.id, type: 'appeal_message' },
    });
    expect(notified).not.toBeNull();

    // Решение закрывает кейс; переписка после закрытия недоступна (409),
    // но читается в деталях (история сохраняется).
    await post(arbitrator, `/appeals/${appealId}/resolve`)
      .send({ decision: 'unblock', notes: 'Дублирование подтверждено, часы пересчитаны' })
      .expect(201);
    await post(driver, `/appeals/${appealId}/messages`)
      .send({ body: 'Спасибо!' })
      .expect(409);
    const closedView = await get(driver, `/appeals/${appealId}`).expect(200);
    expect(closedView.body.messages).toHaveLength(2);
  });

  it('ревайв: после разблока серия всё ещё закрыта → крон блокирует снова', async () => {
    const blockedPairId = await blockPair();
    const appeal = await post(driver, '/appeals')
      .send({ blockedPairId, reason: 'Часы задвоились, прошу разблокировать' })
      .expect(201);
    await post(arbitrator, `/appeals/${appeal.body.id}/assign`).send({}).expect(201);
    await post(arbitrator, `/appeals/${appeal.body.id}/resolve`)
      .send({ decision: 'unblock', notes: 'Ошибка учёта подтверждена' })
      .expect(201);

    // Разблок — не «вечный иммунитет»: серия месяцев никуда не делась,
    // следующий прогон крона блокирует пару снова (ревайв той же строки).
    expect(await workHours.enforceSeriesLimit()).toBe(1);

    const activeBlocks = await prisma.blockedPair.findMany({
      where: { driverId: driver.id, sellerId: seller.id, unblockedAt: null },
    });
    expect(activeBlocks).toHaveLength(1);
    // Строка та же самая (ревайв), не дубль.
    expect(activeBlocks[0].id).toBe(blockedPairId);

    // И пара снова не работает.
    await post(driver, '/work-hours/sessions').send({ sellerId: seller.id }).expect(409);
  });
});

async function cleanDatabase(prisma: PrismaService): Promise<void> {
  // Идемпотентные операции держат FK на users — чистим первыми (ADR-006).
  await prisma.outboxOperation.deleteMany();
  await prisma.appealMessage.deleteMany();
  await prisma.appealCase.deleteMany();
  await prisma.blockedPair.deleteMany();
  await prisma.workSession.deleteMany();
  await prisma.monthlyPairTotal.deleteMany();
  await prisma.disputeMessage.deleteMany();
  await prisma.disputeEvidence.deleteMany();
  await prisma.disputeCase.deleteMany();
  await prisma.reputationEvent.deleteMany();
  await prisma.reputationSnapshot.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.debtEvent.deleteMany();
  await prisma.debt.deleteMany();
  await prisma.bookingEvent.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.deliveryEvent.deleteMany();
  await prisma.deliveryRequest.deleteMany();
  await prisma.geoPoint.deleteMany();
  await prisma.user.deleteMany();
}

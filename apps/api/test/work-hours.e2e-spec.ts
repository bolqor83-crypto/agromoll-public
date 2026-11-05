/**
 * E2E учёта часов 289-ФЗ (v0.4.0, подэтап B, ADR-011).
 *
 * Требует DATABASE_URL и применённых миграций — запускается в CI
 * (`pnpm --filter @agromoll/api test:e2e`).
 *
 * Сценарии: сессия → завершение → MonthlyPairTotal инкрементится и
 * monthCounted при ≥60 ч; симуляция 6 месяцев подряд ≥60 ч прямым
 * insert → крон (прямой вызов enforceSeriesLimit) создаёт BlockedPair →
 * новая сессия → 409 WORK_PAIR_BLOCKED; разорванная серия → блокировки
 * нет; check-эндпоинт отдаёт состояние пары для UI.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkHoursService, addMonths, toMonthKey } from '../src/work-hours/work-hours.service';
import { WORK_PAIR_BLOCKED_CODE } from '../src/work-hours/work-hours.constants';
import { authHeader, registerAndLogin } from './auth.helper';
import type { TestUser } from './auth.helper';

describe('Work hours 289-ФЗ (e2e, HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let workHours: WorkHoursService;

  let driver: TestUser;
  let seller: TestUser;

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
  });

  const post = (user: TestUser, url: string) =>
    request(app.getHttpServer()).post(url).set(authHeader(user));

  const get = (user: TestUser, url: string) =>
    request(app.getHttpServer()).get(url).set(authHeader(user));

  it('сессия → завершение → MonthlyPairTotal растёт; 60 ч → monthCounted', async () => {
    // короткая сессия — минута-две реального времени
    const started = await post(driver, '/work-hours/sessions').send({ sellerId: seller.id }).expect(201);
    expect(started.body).toMatchObject({
      driverId: driver.id,
      sellerId: seller.id,
      endedAt: null,
      month: toMonthKey(new Date()),
    });

    const ended = await post(driver, `/work-hours/sessions/${started.body.id}/end`)
      .send({})
      .expect(201);
    expect(ended.body.endedAt).toEqual(expect.any(String));
    expect(ended.body.durationMinutes).toBeGreaterThanOrEqual(1);

    const total = await prisma.monthlyPairTotal.findUniqueOrThrow({
      where: {
        driverId_sellerId_month: {
          driverId: driver.id,
          sellerId: seller.id,
          month: toMonthKey(new Date()),
        },
      },
    });
    expect(total.totalMinutes).toBeGreaterThanOrEqual(1);
    expect(total.monthCounted).toBe(false); // пара минут — далеко до 60 ч

    // повторное завершение — идемпотентно, минут не добавилось
    await post(driver, `/work-hours/sessions/${started.body.id}/end`).send({}).expect(201);
    const totalAfterRepeat = await prisma.monthlyPairTotal.findUniqueOrThrow({
      where: {
        driverId_sellerId_month: {
          driverId: driver.id,
          sellerId: seller.id,
          month: toMonthKey(new Date()),
        },
      },
    });
    expect(totalAfterRepeat.totalMinutes).toBe(total.totalMinutes);
  });

  it('правила: сам с собой 400, чужой end 403, вторая смена 409, роли', async () => {
    await post(driver, '/work-hours/sessions').send({ sellerId: driver.id }).expect(400);
    await post(seller, '/work-hours/sessions').send({ sellerId: seller.id }).expect(403); // не driver

    const session = await post(driver, '/work-hours/sessions')
      .send({ sellerId: seller.id })
      .expect(201);

    // вторая открытая смена у того же водителя
    const otherSeller = await registerAndLogin(app, 'seller');
    await post(driver, '/work-hours/sessions').send({ sellerId: otherSeller.id }).expect(409);

    // посторонний не может завершить
    const outsider = await registerAndLogin(app, 'buyer');
    await post(outsider, `/work-hours/sessions/${session.body.id}/end`).send({}).expect(403);
  });

  it('6 месяцев подряд ≥60 ч → крон блокирует пару → новая сессия 409', async () => {
    const month = toMonthKey(new Date());
    // прямой insert: текущий месяц + 5 предыдущих, все ≥60 ч
    for (let back = 0; back < 6; back += 1) {
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

    // крон (прямой вызов — как в unit-тестах, но против реальной БД)
    const created = await workHours.enforceSeriesLimit();
    expect(created).toBe(1);

    const blocked = await prisma.blockedPair.findUniqueOrThrow({
      where: { driverId_sellerId: { driverId: driver.id, sellerId: seller.id } },
    });
    expect(blocked.reason).toContain('289-ФЗ');

    // попытка новой сессии — мягкий 409 с кодом
    const attempt = await post(driver, '/work-hours/sessions')
      .send({ sellerId: seller.id })
      .expect(409);
    expect(attempt.body.code).toBe(WORK_PAIR_BLOCKED_CODE);
    expect(attempt.body.message).toContain('289-ФЗ');
    expect(attempt.body.message).toContain('продавца');

    // повторный прогон крона не дублирует
    expect(await workHours.enforceSeriesLimit()).toBe(0);

    // check-эндпоинт: UI показывает экран паузы
    const check = await get(driver, `/work-hours/check/${driver.id}/${seller.id}`).expect(200);
    expect(check.body).toMatchObject({
      blocked: true,
      monthCounted: true,
      series: 6,
    });
  });

  it('разорванная серия (<60 ч в одном месяце) → блокировки нет', async () => {
    const month = toMonthKey(new Date());
    // текущий + 2 предыдущих counted, месяц -3 провален, старые — counted
    const months = [0, 1, 2, 4, 5, 6];
    for (const back of months) {
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

    expect(await workHours.enforceSeriesLimit()).toBe(0);

    const check = await get(driver, `/work-hours/check/${driver.id}/${seller.id}`).expect(200);
    expect(check.body.blocked).toBe(false);
    // серия = 3 (месяцы 0,1,2 подряд; дальше разрыв)
    expect(check.body.series).toBe(3);

    // работать можно
    await post(driver, '/work-hours/sessions').send({ sellerId: seller.id }).expect(201);
  });

  it('GET /work-hours/me: driver видит пары по продавцам, seller — по водителям', async () => {
    const session = await post(driver, '/work-hours/sessions')
      .send({ sellerId: seller.id })
      .expect(201);
    await post(driver, `/work-hours/sessions/${session.body.id}/end`).send({}).expect(201);

    const mine = await get(driver, '/work-hours/me').expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({
      counterpartId: seller.id,
      counterpartName: expect.any(String),
      totalMinutes: expect.any(Number),
      activeSessionId: null,
    });

    const sellerView = await get(seller, '/work-hours/me').expect(200);
    expect(sellerView.body).toHaveLength(1);
    expect(sellerView.body[0].counterpartId).toBe(driver.id);

    // открытая сессия видна в паре
    const open = await post(driver, '/work-hours/sessions').send({ sellerId: seller.id }).expect(201);
    const mineOpen = await get(driver, '/work-hours/me').expect(200);
    const pair = mineOpen.body.find((p: { counterpartId: string }) => p.counterpartId === seller.id);
    expect(pair.activeSessionId).toBe(open.body.id);

    // driver видит свою открытую смену отдельным эндпоинтом
    const openSession = await get(driver, '/work-hours/open-session').expect(200);
    expect(openSession.body.id).toBe(open.body.id);
  });
});

async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.workSession.deleteMany();
  await prisma.monthlyPairTotal.deleteMany();
  await prisma.blockedPair.deleteMany();
  await prisma.debtEvent.deleteMany();
  await prisma.debt.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.outboxOperation.deleteMany();
  await prisma.bookingEvent.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}

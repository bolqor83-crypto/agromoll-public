/**
 * E2E арбитража споров (v0.6.0-C ADR-033 → v0.7.0-B ADR-036): полный HTTP-цикл.
 *
 * Требует DATABASE_URL, применённых миграций и S3_* (MinIO) — запускается
 * в CI (service-контейнеры postgis + redis + minio) командой
 * `pnpm --filter @agromoll/api test:e2e`.
 *
 * Сценарии:
 *  1. бронь: приёмка с major_issue → эскалация в арбитраж → дубликат 409
 *     → заморозка (отмена брони 409) → очередь арбитра → assign →
 *     сообщения (внутренние заметки скрыты от сторон) → доказательства
 *     (S3-цикл: presigned PUT → confirm → presigned GET; fallback
 *     data:-URL ≤ 500 КБ; чужой objectKey — 400) → решение favor_buyer +
 *     cancel → бронь отменена, резерв возвращён, продавец оштрафован;
 *  2. долг: эскалация активного долга → compromise + settle_adjusted →
 *     сумма снижена, статус settled;
 *  3. доступ: очередь только арбитру (403), арбитр не открывает споры;
 *  4. dismiss: кейс отклонён, объект разморожен, стороны продолжают сами.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { authHeader, registerAndLogin } from './auth.helper';
import type { TestUser } from './auth.helper';
import { useJsonBodyLimit } from '../src/app-body-parser';

describe('Disputes arbitration flow (e2e, HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let buyer: TestUser;
  let seller: TestUser;
  let outsider: TestUser;
  let arbitrator: TestUser;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // Тот же парсер, что в main.ts (4 МБ, ADR-033): e2e не прогоняет
    // bootstrap, а доказательства приходят мегабайтными base64.
    app = moduleRef.createNestApplication({ bodyParser: false });
    useJsonBodyLimit(app);
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
    outsider = await registerAndLogin(app, 'driver');

    // Арбитром стать нельзя через API (MARKET_ROLES) — назначаем в БД,
    // как это делает сид/админ (ADR-033). Токен остаётся валиден:
    // JwtAuthGuard перечитывает роль из БД.
    arbitrator = await registerAndLogin(app, 'buyer');
    await prisma.user.update({
      where: { id: arbitrator.id },
      data: { role: 'arbitrator' },
    });
  });

  const post = (user: TestUser, url: string, key?: string) => {
    const req = request(app.getHttpServer())
      .post(url)
      .set(authHeader(user));
    return key ? req.set({ 'X-Idempotency-Key': key }) : req;
  };
  const get = (user: TestUser, url: string) =>
    request(app.getHttpServer()).get(url).set(authHeader(user));

  /** Листинг + подтверждённая бронь (готофлоу эскалации). */
  async function confirmedBooking(): Promise<{ listingId: string; bookingId: string }> {
    const created = await post(seller, '/listings')
      .send({
        title: 'Помидоры розовые',
        category: 'vegetables',
        unit: 'kg',
        pricePerUnit: '85.50',
        quantityAvailable: 100,
        lineNumber: 12,
        isPerishable: true,
      })
      .expect(201);
    const booking = await post(buyer, '/bookings')
      .send({ listingId: created.body.id, requestedQuantity: 20 })
      .expect(201);
    await post(seller, `/bookings/${booking.body.id}/confirm`).send({}).expect(201);
    return { listingId: created.body.id, bookingId: booking.body.id };
  }

  it('арбитром нельзя стать через PATCH /users/me/role (конфликт интересов)', async () => {
    await request(app.getHttpServer())
      .patch('/users/me/role')
      .set(authHeader(outsider))
      .send({ role: 'arbitrator' })
      .expect(400);
  });

  it('полный цикл: спор по брони от эскалации до решения favor_buyer', async () => {
    const { listingId, bookingId } = await confirmedBooking();

    // 1. Покупатель эскалирует подтверждённую бронь в арбитраж
    // (получил товар, половина ящиков разбита — приёмку не подтверждает).
    const dispute = await post(buyer, '/disputes')
      .send({
        type: 'booking',
        referenceId: bookingId,
        reason: 'Половина ящиков разбита, товар не соответствовал заказу',
      })
      .expect(201);
    expect(dispute.body).toMatchObject({
      status: 'open',
      type: 'booking',
      firstParty: { id: buyer.id },
      secondParty: { id: seller.id },
      messagesCount: 1,
    });
    const disputeId = dispute.body.id;

    // 2. Дубликат: второй активный спор по тому же объекту — 409.
    await post(seller, '/disputes')
      .send({
        type: 'booking',
        referenceId: bookingId,
        reason: 'Продавец тоже хочет спорить по этой брони',
      })
      .expect(409);

    // 2a. Посторонний не может открыть спор по чужой брони.
    await post(outsider, '/disputes')
      .send({
        type: 'booking',
        referenceId: bookingId,
        reason: 'Посторонний пытается открыть спор по чужой сделке',
      })
      .expect(403);

    // 3. Заморозка: приёмка спорной брони → 409 (статус позволяет,
    // блокирует именно арбитраж — ADR-033).
    const frozen = await post(buyer, `/bookings/${bookingId}/confirm-delivery`)
      .send({ receivedQuantity: 20, qualityFlag: 'ok' })
      .expect(409);
    expect(JSON.stringify(frozen.body)).toContain('арбитраж');

    // 4. Очередь арбитража: только арбитр (простому — 403).
    await get(buyer, '/disputes/queue').expect(403);
    const queue = await get(arbitrator, '/disputes/queue').expect(200);
    expect(queue.body.items).toHaveLength(1);
    expect(queue.body.items[0]).toMatchObject({ id: disputeId, status: 'open' });

    // 5. Мои споры: обе стороны видят кейс, посторонний — нет.
    const mine = await get(seller, '/disputes').expect(200);
    expect(mine.body.items).toHaveLength(1);
    const outsiderMine = await get(outsider, '/disputes').expect(200);
    expect(outsiderMine.body.items).toHaveLength(0);

    // 6. Арбитр берёт в работу.
    await post(arbitrator, `/disputes/${disputeId}/assign`).send({}).expect(201);
    // Повторно — 409 (уже на рассмотрении).
    await post(arbitrator, `/disputes/${disputeId}/assign`).send({}).expect(409);

    // 7. Арбитр оставляет внутреннюю заметку и публичное сообщение.
    await post(arbitrator, `/disputes/${disputeId}/messages`)
      .send({ body: 'Запрошу фото разбитых ящиков у покупателя', isInternal: true })
      .expect(201);
    await post(arbitrator, `/disputes/${disputeId}/messages`)
      .send({ body: 'Прошу фотографии повреждённого товара', isInternal: false })
      .expect(201);

    // 8. Сторона не видит внутренние заметки, арбитр — видит.
    const buyerView = await get(buyer, `/disputes/${disputeId}`).expect(200);
    expect(buyerView.body.messages).toHaveLength(2); // причина + публичное
    expect(buyerView.body.messages.every((m: { isInternal: boolean }) => !m.isInternal)).toBe(
      true,
    );
    const arbView = await get(arbitrator, `/disputes/${disputeId}`).expect(200);
    expect(arbView.body.messages).toHaveLength(3); // + внутренняя

    // 9. Доказательства покупателя (v0.7.0-B, ADR-036) — полный S3-цикл
    //    против реального MinIO: presigned URL → PUT напрямую в хранилище →
    //    confirm с objectKey (сверка HEAD) → список с presigned GET.
    const photoBytes = Buffer.from('broken-crates-photo-e2e');
    const uploadUrlResponse = await post(buyer, `/disputes/${disputeId}/evidence/upload-url`)
      .send({ mimeType: 'image/jpeg', sizeBytes: photoBytes.length })
      .expect(201);
    const { objectKey, uploadUrl } = uploadUrlResponse.body as {
      objectKey: string;
      uploadUrl: string;
    };
    expect(objectKey).toMatch(new RegExp(`^disputes/${disputeId}/[\\w.-]+\\.jpg$`));

    // PUT напрямую в MinIO (presigned, без токенов приложения).
    const putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: photoBytes,
    });
    expect(putResponse.status).toBe(200);

    // Confirm: без загрузки — 400; после загрузки — 201.
    await post(buyer, `/disputes/${disputeId}/evidence`)
      .send({
        storage: 's3',
        objectKey,
        fileName: 'yashiki.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: photoBytes.length,
      })
      .expect(201);

    // Список доказательств: участник получает presigned GET-ссылку.
    const evidenceList = await get(buyer, `/disputes/${disputeId}/evidence`).expect(200);
    expect(evidenceList.body.items).toHaveLength(1);
    expect(evidenceList.body.items[0].url).toContain(objectKey);
    // Ссылка рабочая: GET по ней отдаёт байты фото.
    const getResponse = await fetch(evidenceList.body.items[0].url);
    expect(getResponse.status).toBe(200);
    expect(Buffer.from(await getResponse.arrayBuffer()).toString()).toBe(photoBytes.toString());

    // Посторонний не видит ссылок (404 — не раскрываем факт спора).
    await get(outsider, `/disputes/${disputeId}/evidence`).expect(404);

    // 9a. Fallback: data:-URL ≤ 500 КБ (хранилище доступно, но путь валиден).
    const fallback = await post(buyer, `/disputes/${disputeId}/evidence`)
      .send({
        storage: 'data',
        fileName: 'akt.jpg',
        mimeType: 'image/jpeg',
        dataUrl: `data:image/jpeg;base64,${photoBytes.toString('base64')}`,
      })
      .expect(201);
    expect(fallback.body.sizeBytes).toBe(photoBytes.length);

    // Fallback больше 500 КБ — 400 (защита на входе, zod).
    await post(buyer, `/disputes/${disputeId}/evidence`)
      .send({
        storage: 'data',
        fileName: 'huge.jpg',
        mimeType: 'image/jpeg',
        dataUrl: `data:image/jpeg;base64,${'A'.repeat(700_000)}`,
      })
      .expect(400);

    // 9b. Чужой objectKey (другой спор) — 400.
    await post(buyer, `/disputes/${disputeId}/evidence`)
      .send({
        storage: 's3',
        objectKey: `disputes/00000000-0000-4000-8000-000000000000/stolen.jpg`,
        fileName: 'stolen.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: photoBytes.length,
      })
      .expect(400);

    // 9c. Оба файла в списке: presigned GET + data:-URL как есть.
    const listAfterFallback = await get(arbitrator, `/disputes/${disputeId}/evidence`).expect(200);
    expect(listAfterFallback.body.items).toHaveLength(2);
    expect(listAfterFallback.body.items[1].url).toMatch(/^data:image\/jpeg;base64,/);

    // 10. Решение: прав покупатель, бронь отменить, резерв вернуть.
    const resolved = await post(arbitrator, `/disputes/${disputeId}/resolve`)
      .send({
        outcome: 'favor_buyer',
        bookingOutcome: 'cancel',
        notes: 'Фотографии подтверждают бой при транспортировке',
      })
      .expect(201);
    expect(resolved.body).toMatchObject({ status: 'resolved', resolution: 'favor_buyer' });

    // 11. Бронь отменена, резерв возвращён листингу.
    const bookingAfter = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(bookingAfter.status).toBe('cancelled');
    const listingAfter = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listingAfter.quantityReserved).toBe(0);

    // 12. Репутация: продавец оштрафован (penalty_applied −1).
    const penalty = await prisma.reputationEvent.findFirst({
      where: { userId: seller.id, action: 'penalty_applied' },
    });
    expect(penalty).not.toBeNull();
    expect(penalty?.delta).toBe(-1);
    expect(penalty?.reason).toBe('arbitration:favor_buyer');

    // 13. Объект разморожен: бронь уже cancelled — обычный 409 статуса,
    // сообщение НЕ про арбитраж (заморозка снята решением).
    const reCancel = await post(buyer, `/bookings/${bookingId}/cancel`)
      .send({ reason: 'Уже отменена арбитражем' })
      .expect(409);
    expect(JSON.stringify(reCancel.body)).not.toContain('арбитраж');

    // 14. Закрытый кейс: переписка недоступна (409); уведомления о
    // решении пришли обеим сторонам.
    await post(buyer, `/disputes/${disputeId}/messages`)
      .send({ body: 'Спасибо за решение', isInternal: false })
      .expect(409);
    const notifications = await prisma.notification.findMany({
      where: { type: 'dispute_resolved' },
    });
    expect(notifications).toHaveLength(2);
  });

  it('спор по долгу: compromise + settle_adjusted снижает сумму и гасит долг', async () => {
    // Кредитор-продавец даёт покупателю 10 000 ₽ в долг.
    const debt = await post(seller, '/debts')
      .send({ debtorId: buyer.id, amount: 10000, description: 'Товар в долг до пятницы' })
      .expect(201);
    const debtId = debt.body.id;

    // Дебитор эскалирует: товар был частично бракованным.
    const dispute = await post(buyer, '/disputes')
      .send({
        type: 'debt',
        referenceId: debtId,
        reason: 'Часть товара была бракованной, требую снизить сумму долга',
      })
      .expect(201);
    const disputeId = dispute.body.id;

    // Долг заморожен: settle теперь 409.
    await post(buyer, `/debts/${debtId}/settle`).send({}).expect(409);

    // Арбитр берёт и решает компромисс: долг 6 000 ₽, считается погашенным.
    await post(arbitrator, `/disputes/${disputeId}/assign`).send({}).expect(201);
    const resolved = await post(arbitrator, `/disputes/${disputeId}/resolve`)
      .send({
        outcome: 'compromise',
        debtOutcome: 'settle_adjusted',
        adjustedAmount: 6000,
        notes: 'Брак подтверждён частично: 60% суммы',
      })
      .expect(201);
    expect(resolved.body.resolution).toBe('compromise');

    const debtAfter = await prisma.debt.findUniqueOrThrow({ where: { id: debtId } });
    expect(debtAfter.status).toBe('settled');
    expect(debtAfter.amount.toNumber()).toBe(6000);
    expect(debtAfter.settledAt).not.toBeNull();

    // Обе стороны получили штраф −0.5 (компромисс).
    const penalties = await prisma.reputationEvent.findMany({
      where: { action: 'penalty_applied', reason: 'arbitration:compromise' },
    });
    expect(penalties).toHaveLength(2);
  });

  it('dismiss: необоснованный спор отклонён, объект разморожен без вмешательства', async () => {
    const { bookingId } = await confirmedBooking();

    const dispute = await post(seller, '/disputes')
      .send({
        type: 'booking',
        referenceId: bookingId,
        reason: 'Покупатель слишком долго забирает бронь, требую компенсации',
      })
      .expect(201);

    // Пока спор активен — приёмка заморожена (409).
    await post(buyer, `/bookings/${bookingId}/confirm-delivery`)
      .send({ receivedQuantity: 20, qualityFlag: 'ok' })
      .expect(409);

    await post(arbitrator, `/disputes/${dispute.body.id}/assign`).send({}).expect(201);
    await post(arbitrator, `/disputes/${dispute.body.id}/resolve`)
      .send({ outcome: 'dismiss', notes: 'Срок брони не истёк, повода для спора нет' })
      .expect(201);

    // После dismiss разморожено: покупатель подтверждает приёмку штатно.
    await post(buyer, `/bookings/${bookingId}/confirm-delivery`)
      .send({ receivedQuantity: 20, qualityFlag: 'ok' })
      .expect(201);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('completed');

    // Штрафов нет: dismissed никого не бьёт по репутации.
    const penalties = await prisma.reputationEvent.findMany({
      where: { action: 'penalty_applied' },
    });
    expect(penalties).toHaveLength(0);
  });

  it('арбитр не открывает споры: он не сторона рынка (403)', async () => {
    const { bookingId } = await confirmedBooking();
    await post(arbitrator, '/disputes')
      .send({
        type: 'booking',
        referenceId: bookingId,
        reason: 'Арбитр пытается открыть спор как участник',
      })
      .expect(403);
  });

  it('идемпотентность открытия: двойной POST с одним ключом — один кейс', async () => {
    const { bookingId } = await confirmedBooking();
    const key = '11111111-1111-4111-8111-111111111111';

    const first = await post(buyer, '/disputes', key)
      .send({
        type: 'booking',
        referenceId: bookingId,
        reason: 'Ретрай мобильного клиента при плохой сети',
      })
      .expect(201);
    const second = await post(buyer, '/disputes', key)
      .send({
        type: 'booking',
        referenceId: bookingId,
        reason: 'Ретрай мобильного клиента при плохой сети',
      })
      .expect(201);
    expect(second.body.id).toBe(first.body.id);

    const count = await prisma.disputeCase.count();
    expect(count).toBe(1);
  });
});

async function cleanDatabase(prisma: PrismaService): Promise<void> {
  // Идемпотентные операции держат FK на users — чистим первыми (ADR-006).
  await prisma.outboxOperation.deleteMany();
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

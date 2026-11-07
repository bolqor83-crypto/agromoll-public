/**
 * E2E фото товаров (v0.7.0-D, ADR-038): полный HTTP-цикл.
 *
 * Требует DATABASE_URL, применённых миграций и S3_* (LocalStack) —
 * запускается в CI (service-контейнеры postgis + redis + s3) командой
 * `pnpm --filter @agromoll/api test:e2e`.
 *
 * Сценарии:
 *  1. S3-цикл: presigned PUT → confirm с objectKey (сверка HEAD) →
 *     детали лота с presigned GET → GET по ссылке отдаёт байты;
 *  2. обложка в ленте и витрине: coverUrl = первое фото (position 0);
 *  3. fallback data:-URL ≤ 500 КБ — 201; больше — 400 (zod);
 *  4. лимит: шестое фото — 409;
 *  5. доступ: не-владелец не получает ни ссылку, ни attach (403);
 *     чужой objectKey — 400;
 *  6. удаление: обложка удаляется, позиции пересобираются — новое
 *     первое фото становится обложкой.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { authHeader, registerAndLogin } from './auth.helper';
import type { TestUser } from './auth.helper';
import { useJsonBodyLimit } from '../src/app-body-parser';

describe('Listing photos (e2e, HTTP, v0.7.0-D)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let seller: TestUser;
  let otherSeller: TestUser;
  let buyer: TestUser;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    seller = await registerAndLogin(app, 'seller');
    otherSeller = await registerAndLogin(app, 'seller');
    buyer = await registerAndLogin(app, 'buyer');
  });

  const post = (user: TestUser, url: string, key?: string) => {
    const req = request(app.getHttpServer()).post(url).set(authHeader(user));
    return key ? req.set({ 'X-Idempotency-Key': key }) : req;
  };
  const get = (user: TestUser, url: string) =>
    request(app.getHttpServer()).get(url).set(authHeader(user));
  const del = (user: TestUser, url: string) =>
    request(app.getHttpServer()).delete(url).set(authHeader(user));

  /** Новый лот продавца. */
  async function createListing(): Promise<string> {
    const created = await post(seller, '/listings').send({
      title: 'Помидоры розовые',
      category: 'vegetables',
      unit: 'kg',
      pricePerUnit: '85.50',
      quantityAvailable: 100,
      lineNumber: 12,
      isPerishable: true,
    });
    expect(created.status).toBe(201);
    return created.body.id as string;
  }

  /** Загрузить байты в S3 по presigned URL, вернуть objectKey. */
  async function uploadToS3(
    listingId: string,
    bytes: Buffer,
  ): Promise<string> {
    const response = await post(seller, `/listings/${listingId}/photos/upload-url`)
      .send({ mimeType: 'image/jpeg', sizeBytes: bytes.length })
      .expect(201);
    const { objectKey, uploadUrl } = response.body as { objectKey: string; uploadUrl: string };
    expect(objectKey).toMatch(new RegExp(`^listings/${listingId}/[\\w.-]+\\.jpg$`));
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: bytes,
    });
    expect(put.status).toBe(200);
    return objectKey;
  }

  it('S3-цикл: upload-url → PUT → confirm → детали с presigned GET → байты по ссылке', async () => {
    const listingId = await createListing();
    const photoBytes = Buffer.from('rose-tomatoes-photo-e2e');

    const objectKey = await uploadToS3(listingId, photoBytes);

    // Confirm без загрузки — 400 (мёртвых ссылок не бывает).
    await post(seller, `/listings/${listingId}/photos`)
      .send({
        storage: 's3',
        objectKey: `listings/${listingId}/not-uploaded.jpg`,
        fileName: 'ghost.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: photoBytes.length,
      })
      .expect(400);

    const attached = await post(seller, `/listings/${listingId}/photos`)
      .send({
        storage: 's3',
        objectKey,
        fileName: 'tomatoes.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: photoBytes.length,
      })
      .expect(201);
    expect(attached.body).toMatchObject({ position: 0, mimeType: 'image/jpeg' });
    expect(attached.body.url).toContain(objectKey);

    // Детали: фото с presigned GET, обложка = первое фото.
    const detail = await request(app.getHttpServer()).get(`/listings/${listingId}`).expect(200);
    expect(detail.body.photos).toHaveLength(1);
    expect(detail.body.photos[0].position).toBe(0);
    expect(detail.body.coverUrl).toBe(detail.body.photos[0].url);

    // Ссылка рабочая: GET отдаёт исходные байты.
    const getResponse = await fetch(detail.body.photos[0].url);
    expect(getResponse.status).toBe(200);
    expect(Buffer.from(await getResponse.arrayBuffer()).toString()).toBe(photoBytes.toString());
  });

  it('лента и витрина отдают обложку, лот без фото — coverUrl null', async () => {
    const bareId = await createListing();
    const photoId = await createListing();

    const bytes = Buffer.from('cover-photo');
    const objectKey = await uploadToS3(photoId, bytes);
    await post(seller, `/listings/${photoId}/photos`)
      .send({
        storage: 's3',
        objectKey,
        fileName: 'cover.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: bytes.length,
      })
      .expect(201);

    const feed = await request(app.getHttpServer()).get('/listings').expect(200);
    const byId = new Map<string, { coverUrl: string | null; photos?: unknown[] }>(
      feed.body.map((l: { id: string; coverUrl: string | null; photos?: unknown[] }) => [
        l.id,
        { coverUrl: l.coverUrl, photos: l.photos },
      ]),
    );
    expect(byId.get(bareId)?.coverUrl).toBeNull();
    expect(byId.get(bareId)?.photos).toBeUndefined(); // в списках — только обложка
    expect(byId.get(photoId)?.coverUrl).toContain(objectKey);

    // Витрина продавца — те же обложки.
    const mine = await get(seller, '/listings/mine').expect(200);
    const mineById = new Map<string, string | null>(
      mine.body.map((l: { id: string; coverUrl: string | null }) => [l.id, l.coverUrl]),
    );
    expect(mineById.get(bareId)).toBeNull();
    expect(mineById.get(photoId)).toContain(objectKey);
  });

  it('fallback data:-URL ≤ 500 КБ — 201 с честным размером, больше — 400', async () => {
    const listingId = await createListing();
    const bytes = Buffer.from('tiny-fallback-photo');

    const attached = await post(seller, `/listings/${listingId}/photos`)
      .send({
        storage: 'data',
        fileName: 'fallback.jpg',
        mimeType: 'image/jpeg',
        dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      })
      .expect(201);
    expect(attached.body.sizeBytes).toBe(bytes.length);
    expect(attached.body.url).toMatch(/^data:image\/jpeg;base64,/);

    // Детали: data:-URL отдаётся как есть (без presign).
    const detail = await request(app.getHttpServer()).get(`/listings/${listingId}`).expect(200);
    expect(detail.body.coverUrl).toMatch(/^data:image\/jpeg;base64,/);

    // Больше 500 КБ — 400 (защита на входе, zod).
    await post(seller, `/listings/${listingId}/photos`)
      .send({
        storage: 'data',
        fileName: 'huge.jpg',
        mimeType: 'image/jpeg',
        dataUrl: `data:image/jpeg;base64,${'A'.repeat(700_000)}`,
      })
      .expect(400);
  });

  it('лимит 5 фото: шестое — 409', async () => {
    const listingId = await createListing();
    const bytes = Buffer.from('multi-photo');

    for (let i = 0; i < 5; i += 1) {
      const objectKey = await uploadToS3(listingId, bytes);
      await post(seller, `/listings/${listingId}/photos`)
        .send({
          storage: 's3',
          objectKey,
          fileName: `photo-${i}.jpg`,
          mimeType: 'image/jpeg',
          sizeBytes: bytes.length,
        })
        .expect(201);
    }

    const sixthKey = await uploadToS3(listingId, bytes);
    const sixth = await post(seller, `/listings/${listingId}/photos`)
      .send({
        storage: 's3',
        objectKey: sixthKey,
        fileName: 'sixth.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: bytes.length,
      })
      .expect(409);
    expect(JSON.stringify(sixth.body)).toContain('5');
  });

  it('доступ: не-владелец — 403 на upload-url и attach; чужой objectKey — 400', async () => {
    const listingId = await createListing();
    const bytes = Buffer.from('access-control-photo');

    await post(otherSeller, `/listings/${listingId}/photos/upload-url`)
      .send({ mimeType: 'image/jpeg', sizeBytes: bytes.length })
      .expect(403);

    await post(otherSeller, `/listings/${listingId}/photos`)
      .send({
        storage: 'data',
        fileName: 'alien.jpg',
        mimeType: 'image/jpeg',
        dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      })
      .expect(403);

    // Покупатель тоже не владелец — 403 (фото управляет только продавец).
    await post(buyer, `/listings/${listingId}/photos`)
      .send({
        storage: 'data',
        fileName: 'buyer.jpg',
        mimeType: 'image/jpeg',
        dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      })
      .expect(403);

    // Чужой objectKey (фото другого лота) — 400.
    const ownListing = await createListing();
    const objectKey = await uploadToS3(listingId, bytes);
    await post(seller, `/listings/${ownListing}/photos`)
      .send({
        storage: 's3',
        objectKey,
        fileName: 'stolen.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: bytes.length,
      })
      .expect(400);
  });

  it('удаление обложки: позиции пересобираются, обложкой становится следующее', async () => {
    const listingId = await createListing();
    const bytes = Buffer.from('delete-flow');

    const photoIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const objectKey = await uploadToS3(listingId, bytes);
      const attached = await post(seller, `/listings/${listingId}/photos`)
        .send({
          storage: 's3',
          objectKey,
          fileName: `photo-${i}.jpg`,
          mimeType: 'image/jpeg',
          sizeBytes: bytes.length,
        })
        .expect(201);
      photoIds.push(attached.body.id as string);
    }

    // Удаляем обложку (position 0).
    await del(seller, `/listings/${listingId}/photos/${photoIds[0]}`).expect(200);

    // Детали: два фото, позиции плотные 0..1, обложка — бывшее второе.
    const detail = await request(app.getHttpServer()).get(`/listings/${listingId}`).expect(200);
    expect(detail.body.photos).toHaveLength(2);
    expect(detail.body.photos.map((p: { position: number }) => p.position)).toEqual([0, 1]);
    expect(detail.body.coverUrl).toBe(detail.body.photos[0].url);
    expect(detail.body.photos[0].id).toBe(photoIds[1]);

    // Не-владелец удалить не может.
    await del(otherSeller, `/listings/${listingId}/photos/${photoIds[1]}`).expect(403);
    // Фото чужого лота — 404.
    await del(seller, `/listings/${listingId}/photos/00000000-0000-4000-8000-000000000000`).expect(
      404,
    );
  });
});

async function cleanDatabase(prisma: PrismaService): Promise<void> {
  // Идемпотентные операции держат FK на users — чистим первыми (ADR-006).
  await prisma.outboxOperation.deleteMany();
  // listing_photo удаляются каскадом вместе с листингами (ADR-038).
  await prisma.listing.deleteMany();
  await prisma.user.deleteMany();
}

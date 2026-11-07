/**
 * Unit-тесты сервиса листингов (мок Prisma + мок S3-хранилища).
 *
 * Фото товаров (v0.7.0-D, ADR-038): паттерн доказательств споров
 * (ADR-036) — presigned URL только владельцу, confirm сверяет HEAD,
 * fallback data:-URL ≤ 500 КБ, лимит 5 фото, удаление пересобирает
 * позиции. Сетевые сценарии S3 — в e2e (test/listings.photos.e2e-spec.ts).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Listing, ListingPhoto } from '@prisma/client';
import { ListingsService } from './listings.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'listing-1',
    sellerId: 'seller-1',
    title: 'Помидоры розовые',
    category: 'vegetables',
    unit: 'kg',
    pricePerUnit: 85.5,
    quantityAvailable: 100,
    quantityReserved: 0,
    lineNumber: 12,
    isPerishable: true,
    status: 'active',
    createdAt: new Date('2026-11-05T04:00:00Z'),
    updatedAt: new Date('2026-11-05T04:00:00Z'),
    ...overrides,
  } as Listing;
}

function makePhoto(overrides: Partial<ListingPhoto> = {}): ListingPhoto {
  return {
    id: 'photo-1',
    listingId: 'listing-1',
    position: 0,
    fileName: 'photo-1.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1234,
    fileUrl: 's3://listings/listing-1/uuid.jpg',
    createdAt: new Date('2026-11-05T04:00:00Z'),
    ...overrides,
  } as ListingPhoto;
}

function createPrismaMock() {
  const prismaMock = {
    listing: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    listingPhoto: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  return { prismaMock, prisma: prismaMock as unknown as PrismaService };
}

/** Мок StorageService: presign/head без сети, доступность управляется тестом. */
function createStorageMock(available = true) {
  return {
    isAvailable: jest.fn(() => available),
    presignPut: jest.fn(async (objectKey: string) => ({
      objectKey,
      uploadUrl: `http://s3.local/${objectKey}?sig=put`,
      expiresIn: 600,
    })),
    presignGet: jest.fn(async (objectKey: string) => `http://s3.local/${objectKey}?sig=get`),
    headObject: jest.fn(
      async (): Promise<{ sizeBytes: number; mimeType: string } | null> => null,
    ),
    listingPhotoObjectKey: jest.fn(
      (listingId: string, mimeType: string) =>
        `listings/${listingId}/${'0'.repeat(8)}-uuid.${mimeType === 'image/png' ? 'png' : 'jpg'}`,
    ),
  };
}

async function createService(
  prisma: PrismaService,
  storage: ReturnType<typeof createStorageMock> = createStorageMock(),
): Promise<ListingsService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: StorageService, useValue: storage },
      ListingsService,
    ],
  }).compile();
  return moduleRef.get(ListingsService);
}

describe('ListingsService (unit)', () => {
  it('create создаёт активный лот и сериализует Decimal в строку', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    prismaMock.listing.create.mockResolvedValue({
      ...makeListing(),
      seller: { displayName: 'ФХ «Донская долина»' },
    });

    const service = await createService(prisma);
    const dto = await service.create('seller-1', {
      title: 'Помидоры розовые',
      category: 'vegetables',
      unit: 'kg',
      pricePerUnit: 85.5,
      quantityAvailable: 100,
      lineNumber: 12,
      isPerishable: true,
    });

    expect(dto.status).toBe('active');
    expect(dto.pricePerUnit).toBe('85.5');
    expect(dto.quantityAvailableForBooking).toBe(100);
    expect(dto.sellerName).toBe('ФХ «Донская долина»');
  });

  it('findMany по умолчанию показывает только активные лоты', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    prismaMock.listing.findMany.mockResolvedValue([]);

    const service = await createService(prisma);
    await service.findMany({});

    expect(prismaMock.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'active' }) }),
    );
  });

  it('findMany передаёт фильтры категории и линии', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    prismaMock.listing.findMany.mockResolvedValue([]);

    const service = await createService(prisma);
    await service.findMany({ category: 'vegetables', lineNumber: 12 });

    expect(prismaMock.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: 'vegetables',
          lineNumber: 12,
          status: 'active',
        }),
      }),
    );
  });

  it('findMany отдаёт обложку presigned-ссылкой (S3) и null без фото', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    prismaMock.listing.findMany.mockResolvedValue([
      { ...makeListing({ id: 'with-photo' }), seller: null, photos: [{ fileUrl: 's3://listings/with-photo/a.jpg' }] },
      { ...makeListing({ id: 'bare' }), seller: null, photos: [] },
    ]);

    const service = await createService(prisma);
    const [withPhoto, bare] = await service.findMany({});

    expect(withPhoto.coverUrl).toBe('http://s3.local/listings/with-photo/a.jpg?sig=get');
    expect(bare.coverUrl).toBeNull();
  });

  it('findMany отдаёт data:-обложку как есть (fallback, без presign)', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    const dataUrl = 'data:image/jpeg;base64,abc=';
    prismaMock.listing.findMany.mockResolvedValue([
      { ...makeListing(), seller: null, photos: [{ fileUrl: dataUrl }] },
    ]);

    const service = await createService(prisma);
    const [listing] = await service.findMany({});

    expect(listing.coverUrl).toBe(dataUrl);
  });

  it('findOne отдаёт 404 для несуществующего лота', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    prismaMock.listing.findUnique.mockResolvedValue(null);

    const service = await createService(prisma);
    await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findOne возвращает фото по порядку с ссылками', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    prismaMock.listing.findUnique.mockResolvedValue({
      ...makeListing(),
      seller: null,
      photos: [
        makePhoto({ id: 'p2', position: 1, fileUrl: 's3://listings/listing-1/b.jpg' }),
        makePhoto({ id: 'p1', position: 0, fileUrl: 's3://listings/listing-1/a.jpg' }),
      ],
    });

    const service = await createService(prisma);
    const dto = await service.findOne('listing-1');

    // Prisma orderBy вернул бы по позиции; мок отдаёт как задано —
    // сервис доверяет порядку БД, здесь проверяем маппинг полей.
    expect(dto.photos).toHaveLength(2);
    expect(dto.photos?.[0]).toMatchObject({ id: 'p2', position: 1, url: 'http://s3.local/listings/listing-1/b.jpg?sig=get' });
    expect(dto.coverUrl).toBe('http://s3.local/listings/listing-1/b.jpg?sig=get');
  });

  it('update запрещён не-владельцу (403)', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    prismaMock.listing.findUnique.mockResolvedValue(makeListing({ sellerId: 'seller-1' }));

    const service = await createService(prisma);
    await expect(
      service.update('listing-1', 'stranger', { title: 'Взломано' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaMock.listing.update).not.toHaveBeenCalled();
  });

  it('update не даёт опустить quantityAvailable ниже резерва (409)', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    prismaMock.listing.findUnique.mockResolvedValue(
      makeListing({ sellerId: 'seller-1', quantityAvailable: 100, quantityReserved: 40 }),
    );

    const service = await createService(prisma);
    await expect(
      service.update('listing-1', 'seller-1', { quantityAvailable: 30 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('update меняет только переданные поля', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    prismaMock.listing.findUnique.mockResolvedValue(
      makeListing({ sellerId: 'seller-1', quantityReserved: 10 }),
    );
    prismaMock.listing.update.mockResolvedValue({
      ...makeListing({ status: 'paused' }),
      seller: null,
    });

    const service = await createService(prisma);
    await service.update('listing-1', 'seller-1', { status: 'paused' });

    expect(prismaMock.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'paused' } }),
    );
  });
});

describe('ListingsService — фото товаров (unit, v0.7.0-D)', () => {
  const S3_INPUT = {
    storage: 's3' as const,
    objectKey: 'listings/listing-1/00000000-uuid.jpg',
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg' as const,
    sizeBytes: 1234,
  };

  it('upload-url: владелец получает presigned PUT под ключ listings/<id>/…', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    const storage = createStorageMock(true);
    prismaMock.listing.findUnique.mockResolvedValue(makeListing());
    storage.listingPhotoObjectKey.mockReturnValue('listings/listing-1/uuid.jpg');

    const service = await createService(prisma, storage);
    const result = await service.createPhotoUploadUrl('seller-1', 'listing-1', {
      mimeType: 'image/jpeg',
      sizeBytes: 1234,
    });

    expect(result.objectKey).toBe('listings/listing-1/uuid.jpg');
    expect(result.uploadUrl).toContain('listings/listing-1/uuid.jpg');
    expect(result.expiresIn).toBe(600);
  });

  it('upload-url: не-владелец — 403, ссылка не подписывается', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    const storage = createStorageMock(true);
    prismaMock.listing.findUnique.mockResolvedValue(makeListing());

    const service = await createService(prisma, storage);
    await expect(
      service.createPhotoUploadUrl('stranger', 'listing-1', {
        mimeType: 'image/jpeg',
        sizeBytes: 1234,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.presignPut).not.toHaveBeenCalled();
  });

  it('upload-url: хранилище недоступно — 503 (клиент уйдёт в fallback)', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    const storage = createStorageMock(false);
    prismaMock.listing.findUnique.mockResolvedValue(makeListing());

    const service = await createService(prisma, storage);
    await expect(
      service.createPhotoUploadUrl('seller-1', 'listing-1', {
        mimeType: 'image/jpeg',
        sizeBytes: 1234,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('attach s3: счастливый путь — позиция 0, fileUrl s3://, presigned GET в DTO', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    const storage = createStorageMock(true);
    prismaMock.listing.findUnique.mockResolvedValue(makeListing());
    prismaMock.listingPhoto.count.mockResolvedValue(0);
    prismaMock.listingPhoto.create.mockResolvedValue(makePhoto());
    storage.headObject.mockResolvedValue({ sizeBytes: 1234, mimeType: 'image/jpeg' });

    const service = await createService(prisma, storage);
    const dto = await service.attachPhoto('seller-1', 'listing-1', S3_INPUT);

    expect(prismaMock.listingPhoto.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 0, fileUrl: 's3://listings/listing-1/00000000-uuid.jpg' }) }),
    );
    expect(dto.url).toBe('http://s3.local/listings/listing-1/uuid.jpg?sig=get');
    expect(dto.position).toBe(0);
  });

  it('attach s3: чужой objectKey (фото другого лота) — 400', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    const storage = createStorageMock(true);
    prismaMock.listing.findUnique.mockResolvedValue(makeListing());
    prismaMock.listingPhoto.count.mockResolvedValue(0);

    const service = await createService(prisma, storage);
    await expect(
      service.attachPhoto('seller-1', 'listing-1', {
        ...S3_INPUT,
        objectKey: 'listings/listing-OTHER/00000000-uuid.jpg',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.headObject).not.toHaveBeenCalled();
  });

  it('attach s3: файла нет в хранилище (HEAD null) — 400', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    const storage = createStorageMock(true);
    prismaMock.listing.findUnique.mockResolvedValue(makeListing());
    prismaMock.listingPhoto.count.mockResolvedValue(0);
    storage.headObject.mockResolvedValue(null);

    const service = await createService(prisma, storage);
    await expect(
      service.attachPhoto('seller-1', 'listing-1', S3_INPUT),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('attach s3: размер в хранилище не совпал — 400', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    const storage = createStorageMock(true);
    prismaMock.listing.findUnique.mockResolvedValue(makeListing());
    prismaMock.listingPhoto.count.mockResolvedValue(0);
    storage.headObject.mockResolvedValue({ sizeBytes: 999, mimeType: 'image/jpeg' });

    const service = await createService(prisma, storage);
    await expect(
      service.attachPhoto('seller-1', 'listing-1', S3_INPUT),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('attach data: fallback записывает data:-URL и честный размер', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    const storage = createStorageMock(true);
    prismaMock.listing.findUnique.mockResolvedValue(makeListing());
    prismaMock.listingPhoto.count.mockResolvedValue(1);
    prismaMock.listingPhoto.create.mockResolvedValue(makePhoto({ position: 1, fileUrl: 'data:image/jpeg;base64,QUJD' }));

    const service = await createService(prisma, storage);
    const dto = await service.attachPhoto('seller-1', 'listing-1', {
      storage: 'data',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,QUJD',
    });

    // «QUJD» = «ABC» → 3 байта.
    expect(prismaMock.listingPhoto.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ position: 1, sizeBytes: 3, fileUrl: 'data:image/jpeg;base64,QUJD' }),
      }),
    );
    expect(dto.url).toBe('data:image/jpeg;base64,QUJD');
  });

  it('attach data: MIME в dataUrl не совпал с заявленным — 400', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    const storage = createStorageMock(true);
    prismaMock.listing.findUnique.mockResolvedValue(makeListing());
    prismaMock.listingPhoto.count.mockResolvedValue(0);

    const service = await createService(prisma, storage);
    await expect(
      service.attachPhoto('seller-1', 'listing-1', {
        storage: 'data',
        fileName: 'photo.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/jpeg;base64,QUJD',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('attach: шестое фото — 409 (лимит 5)', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    const storage = createStorageMock(true);
    prismaMock.listing.findUnique.mockResolvedValue(makeListing());
    prismaMock.listingPhoto.count.mockResolvedValue(5);

    const service = await createService(prisma, storage);
    await expect(
      service.attachPhoto('seller-1', 'listing-1', S3_INPUT),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prismaMock.listingPhoto.create).not.toHaveBeenCalled();
  });

  it('attach: не-владелец — 403 до каких-либо обращений к хранилищу', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    const storage = createStorageMock(true);
    prismaMock.listing.findUnique.mockResolvedValue(makeListing());

    const service = await createService(prisma, storage);
    await expect(
      service.attachPhoto('stranger', 'listing-1', S3_INPUT),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(prismaMock.listingPhoto.create).not.toHaveBeenCalled();
  });

  it('delete: удаляет фото и пересобирает позиции 0..n-1', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    prismaMock.listing.findUnique.mockResolvedValue(makeListing());
    prismaMock.listingPhoto.findFirst.mockResolvedValue(makePhoto({ id: 'p0', position: 0 }));
    // Транзакция реальная в сервисе; в моке $transaction выполняет
    // колбэк с тем же объектом (findMany/update пойдут в prismaMock).
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prismaMock),
    );
    prismaMock.listingPhoto.findMany.mockResolvedValue([
      { id: 'p1' },
      { id: 'p2' },
    ]);

    const service = await createService(prisma);
    const result = await service.deletePhoto('seller-1', 'listing-1', 'p0');

    expect(result).toEqual({ id: 'p0' });
    expect(prismaMock.listingPhoto.delete).toHaveBeenCalledWith({ where: { id: 'p0' } });
    // Оставшиеся получили плотные позиции.
    expect(prismaMock.listingPhoto.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { position: 0 } });
    expect(prismaMock.listingPhoto.update).toHaveBeenCalledWith({ where: { id: 'p2' }, data: { position: 1 } });
  });

  it('delete: фото другого лота — 404 (не раскрываем существование)', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    prismaMock.listing.findUnique.mockResolvedValue(makeListing());
    prismaMock.listingPhoto.findFirst.mockResolvedValue(null);

    const service = await createService(prisma);
    await expect(service.deletePhoto('seller-1', 'listing-1', 'alien')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('delete: не-владелец лота — 403', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    prismaMock.listing.findUnique.mockResolvedValue(makeListing());

    const service = await createService(prisma);
    await expect(
      service.deletePhoto('stranger', 'listing-1', 'p0'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

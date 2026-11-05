/**
 * Unit-тесты сервиса листингов (мок Prisma).
 */
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Listing } from '@prisma/client';
import { ListingsService } from './listings.service';
import { PrismaService } from '../prisma/prisma.service';

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

function createPrismaMock() {
  const prismaMock = {
    listing: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  return { prismaMock, prisma: prismaMock as unknown as PrismaService };
}

async function createService(prisma: PrismaService): Promise<ListingsService> {
  const moduleRef = await Test.createTestingModule({
    providers: [{ provide: PrismaService, useValue: prisma }, ListingsService],
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

  it('findOne отдаёт 404 для несуществующего лота', async () => {
    const { prisma, prismaMock } = createPrismaMock();
    prismaMock.listing.findUnique.mockResolvedValue(null);

    const service = await createService(prisma);
    await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
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

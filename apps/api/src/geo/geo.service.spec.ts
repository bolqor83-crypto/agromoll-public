/**
 * Unit-тесты GeoService (v0.5.0, подэтап B, ADR-014).
 *
 * Ролевые правила, владелец-проверки и маппинг DTO — на моке Prisma.
 * Сам PostGIS (ST_DWithin/ST_Distance, GIST) покрыт e2e с реальной БД.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GeoService } from './geo.service';
import { PrismaService } from '../prisma/prisma.service';
import { GEO_DEFAULT_RADIUS_METERS } from './geo.constants';

const USER = 'user-1';
const OTHER = 'user-2';

/** Минимальная строка geo_points (как из Prisma-клиента). */
function makePoint(overrides: Record<string, unknown> = {}) {
  return {
    id: 'geo-1',
    ownerId: USER,
    kind: 'buyer_point',
    latitude: 47.2224,
    longitude: 39.7138,
    address: 'ул. Станиславского, 8',
    label: 'Мой ларёк',
    radiusMeters: 50,
    isActive: true,
    corridorFrom: null,
    corridorTo: null,
    vehicleType: 'car',
    maxWeightKg: null,
    isRefrigerated: false,
    createdAt: new Date('2026-11-08T08:00:00Z'),
    updatedAt: new Date('2026-11-08T08:00:00Z'),
    ...overrides,
  };
}

/** Мок Prisma с geoPoint-методами и $queryRaw. */
interface GeoPrismaMock {
  geoPoint: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  $queryRaw: jest.Mock;
}

function makeService(): { service: GeoService; prisma: GeoPrismaMock } {
  const prisma: GeoPrismaMock = {
    geoPoint: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const service = new GeoService(prisma as unknown as PrismaService, 2000);
  return { service, prisma };
}

describe('GeoService (unit)', () => {
  describe('createPoint — ролевые правила', () => {
    it('покупатель создаёт buyer_point', async () => {
      const { service, prisma } = makeService();
      prisma.geoPoint.create.mockResolvedValue(makePoint());

      const dto = await service.createPoint(USER, 'buyer', {
        kind: 'buyer_point',
        latitude: 47.2224,
        longitude: 39.7138,
        radiusMeters: 50,
      });

      expect(dto.kind).toBe('buyer_point');
      expect(prisma.geoPoint.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ownerId: USER, kind: 'buyer_point' }),
        }),
      );
    });

    it('покупатель НЕ создаёт seller_line → 403', async () => {
      const { service } = makeService();
      await expect(
        service.createPoint(USER, 'buyer', {
          kind: 'seller_line',
          latitude: 47.2224,
          longitude: 39.7138,
          radiusMeters: 50,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('продавец создаёт seller_line', async () => {
      const { service, prisma } = makeService();
      prisma.geoPoint.create.mockResolvedValue(makePoint({ kind: 'seller_line' }));

      const dto = await service.createPoint(USER, 'seller', {
        kind: 'seller_line',
        latitude: 47.2224,
        longitude: 39.7138,
        radiusMeters: 50,
      });

      expect(dto.kind).toBe('seller_line');
    });

    it('продавец НЕ создаёт buyer_point → 403', async () => {
      const { service } = makeService();
      await expect(
        service.createPoint(USER, 'seller', {
          kind: 'buyer_point',
          latitude: 47.2224,
          longitude: 39.7138,
          radiusMeters: 50,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('createCorridor', () => {
    it('базовые координаты = старт маршрута, kind=delivery_corridor', async () => {
      const { service, prisma } = makeService();
      prisma.geoPoint.create.mockResolvedValue(
        makePoint({
          kind: 'delivery_corridor',
          corridorFrom: { lat: 47.2224, lng: 39.7138 },
          corridorTo: { lat: 47.24, lng: 39.73 },
          vehicleType: 'van',
          maxWeightKg: 1500,
          isRefrigerated: true,
        }),
      );

      const dto = await service.createCorridor(USER, {
        corridorFrom: { lat: 47.2224, lng: 39.7138 },
        corridorTo: { lat: 47.24, lng: 39.73 },
        vehicleType: 'van',
        maxWeightKg: 1500,
        isRefrigerated: true,
      });

      expect(dto.kind).toBe('delivery_corridor');
      expect(dto.latitude).toBe(47.2224);
      expect(dto.longitude).toBe(39.7138);
      expect(dto.corridorFrom).toEqual({ lat: 47.2224, lng: 39.7138 });
      expect(dto.corridorTo).toEqual({ lat: 47.24, lng: 39.73 });
      expect(dto.vehicleType).toBe('van');
      expect(dto.maxWeightKg).toBe(1500);
      expect(dto.isRefrigerated).toBe(true);
    });
  });

  describe('findNearby', () => {
    it('без radiusMeters — радиус по умолчанию из ENV (2000)', async () => {
      const { service, prisma } = makeService();
      prisma.$queryRaw.mockResolvedValue([makePoint({ distanceMeters: 55.4 })]);

      const result = await service.findNearby({ lat: 47.2224, lng: 39.7138 });

      expect(result).toHaveLength(1);
      expect(result[0].distanceMeters).toBe(55);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('kind-фильтр передаётся в SQL-фрагмент', async () => {
      const { service, prisma } = makeService();
      prisma.$queryRaw.mockResolvedValue([]);

      await service.findNearby({ lat: 47.2224, lng: 39.7138, kind: 'seller_line' });

      const sql = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
      const text = (sql.strings as readonly string[]).join('?');
      expect(text).toContain('"kind"::text');
    });

    it('токен провайдера радиуса — имя ENV-переменной', () => {
      // Провайдер модуля читает DEFAULT_GEO_RADIUS_METERS (ADR-014).
      expect(GEO_DEFAULT_RADIUS_METERS).toBe('GEO_DEFAULT_RADIUS_METERS');
    });
  });

  describe('findCorridorsNearby', () => {
    it('ищет коридоры и маппит расстояние', async () => {
      const { service, prisma } = makeService();
      prisma.$queryRaw.mockResolvedValue([
        makePoint({
          kind: 'delivery_corridor',
          corridorFrom: { lat: 47.2224, lng: 39.7138 },
          corridorTo: { lat: 47.24, lng: 39.73 },
          distanceMeters: 120.6,
        }),
      ]);

      const result = await service.findCorridorsNearby({ lat: 47.23, lng: 39.72 });
      expect(result).toHaveLength(1);
      expect(result[0].distanceMeters).toBe(121);
    });
  });

  describe('findMine', () => {
    it('только свои активные геозоны', async () => {
      const { service, prisma } = makeService();
      prisma.geoPoint.findMany.mockResolvedValue([makePoint()]);

      await service.findMine(USER);

      expect(prisma.geoPoint.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ownerId: USER, isActive: true },
        }),
      );
    });
  });

  describe('updatePoint', () => {
    it('владелец обновляет поля', async () => {
      const { service, prisma } = makeService();
      prisma.geoPoint.findUnique.mockResolvedValue(makePoint());
      prisma.geoPoint.update.mockResolvedValue(makePoint({ label: 'Новый склад' }));

      const dto = await service.updatePoint('geo-1', USER, { label: 'Новый склад' });

      expect(dto.label).toBe('Новый склад');
      expect(prisma.geoPoint.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'geo-1' },
          data: { label: 'Новый склад' },
        }),
      );
    });

    it('чужой → 403', async () => {
      const { service, prisma } = makeService();
      prisma.geoPoint.findUnique.mockResolvedValue(makePoint());

      await expect(service.updatePoint('geo-1', OTHER, { label: 'x' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('нет такой геозоны → 404', async () => {
      const { service, prisma } = makeService();
      prisma.geoPoint.findUnique.mockResolvedValue(null);

      await expect(service.updatePoint('geo-x', USER, { label: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('deactivatePoint', () => {
    it('владелец деактивирует (isActive=false, строка живёт)', async () => {
      const { service, prisma } = makeService();
      prisma.geoPoint.findUnique.mockResolvedValue(makePoint());
      prisma.geoPoint.update.mockResolvedValue(makePoint({ isActive: false }));

      const dto = await service.deactivatePoint('geo-1', USER);

      expect(dto.isActive).toBe(false);
      expect(prisma.geoPoint.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
    });

    it('чужой → 403', async () => {
      const { service, prisma } = makeService();
      prisma.geoPoint.findUnique.mockResolvedValue(makePoint());

      await expect(service.deactivatePoint('geo-1', OTHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('маппинг DTO', () => {
    it('jsonb-коридор → GeoCoord, даты → ISO', () => {
      const { service, prisma } = makeService();
      prisma.$queryRaw.mockResolvedValue([
        makePoint({
          kind: 'delivery_corridor',
          corridorFrom: { lat: 47.1, lng: 39.1 },
          corridorTo: { lat: 47.2, lng: 39.2 },
        }),
      ]);

      return service.findNearby({ lat: 47.15, lng: 39.15 }).then((result) => {
        expect(result[0].corridorFrom).toEqual({ lat: 47.1, lng: 39.1 });
        expect(result[0].createdAt).toBe('2026-11-08T08:00:00.000Z');
        expect(result[0].distanceMeters).toBeUndefined();
      });
    });
  });
});

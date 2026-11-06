/**
 * Сервис геозон (v0.5.0, подэтап B, ADR-014).
 *
 * Точки покупателей, линии продавцов и коридоры доставщиков живут в
 * одной таблице geo_points. Координаты — двойное представление:
 *  - Float-поля latitude/longitude — клиентский контракт (Prisma);
 *  - PostGIS geography(Point, 4326) — пространственные запросы,
 *    синхронизируется триггером БД (миграция 20261108100000).
 *
 * Запросы «рядом» — ST_DWithin/ST_Distance по geography: расстояния
 * в метрах на сфероиде без ручных пересчётов проекций, GIST-индекс
 * обслуживает фильтр (ADR-014).
 */
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  GeoCoord,
  GeoPointDto,
  GeoPointKind,
  GeoVehicleType,
  UserRole,
} from '@agromoll/types';
import type {
  CreateGeoCorridorInput,
  CreateGeoPointInput,
  GeoNearbyQuery,
  UpdateGeoPointInput,
} from '@agromoll/validation';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_GEO_RADIUS_METERS_VALUE,
  GEO_CORRIDORS_LIMIT,
  GEO_DEFAULT_RADIUS_METERS,
  GEO_NEARBY_LIMIT,
} from './geo.constants';

/** Строка geo_points из сырого SQL-запроса (camelCase-алиасы). */
interface GeoPointRow {
  id: string;
  ownerId: string;
  kind: GeoPointKind;
  latitude: number;
  longitude: number;
  address: string | null;
  label: string | null;
  radiusMeters: number;
  isActive: boolean;
  corridorFrom: unknown;
  corridorTo: unknown;
  vehicleType: GeoVehicleType;
  maxWeightKg: number | null;
  isRefrigerated: boolean;
  createdAt: Date;
  updatedAt: Date;
  distanceMeters?: number;
}

/** Какая роль какую геозону создаёт (ADR-014). */
const KIND_ROLES: Record<Exclude<GeoPointKind, 'delivery_corridor'>, UserRole> = {
  buyer_point: 'buyer',
  seller_line: 'seller',
};

/** Строка БД → DTO: jsonb-поля к GeoCoord|null, даты — ISO. */
function toGeoPointDto(row: GeoPointRow): GeoPointDto {
  const from = row.corridorFrom as GeoCoord | null;
  const to = row.corridorTo as GeoCoord | null;
  return {
    id: row.id,
    ownerId: row.ownerId,
    kind: row.kind,
    latitude: row.latitude,
    longitude: row.longitude,
    address: row.address,
    label: row.label,
    radiusMeters: row.radiusMeters,
    isActive: row.isActive,
    corridorFrom: from && typeof from.lat === 'number' ? from : null,
    corridorTo: to && typeof to.lat === 'number' ? to : null,
    vehicleType: row.vehicleType,
    maxWeightKg: row.maxWeightKg,
    isRefrigerated: row.isRefrigerated,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.distanceMeters !== undefined ? { distanceMeters: Math.round(row.distanceMeters) } : {}),
  };
}

@Injectable()
export class GeoService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GEO_DEFAULT_RADIUS_METERS) private readonly defaultRadiusMeters: number,
  ) {}

  /** Создать точку покупателя или линию продавца. */
  async createPoint(
    ownerId: string,
    role: UserRole,
    input: CreateGeoPointInput,
  ): Promise<GeoPointDto> {
    // Вид геозоны должен соответствовать роли: покупатель не рисует
    // «линии продавцов», продавец — «точки покупателей» (ADR-014).
    if (KIND_ROLES[input.kind] !== role) {
      throw new ForbiddenException(
        `Геозону «${input.kind}» создаёт только роль «${KIND_ROLES[input.kind]}»`,
      );
    }
    const point = await this.prisma.geoPoint.create({
      data: {
        ownerId,
        kind: input.kind,
        latitude: input.latitude,
        longitude: input.longitude,
        address: input.address,
        label: input.label,
        radiusMeters: input.radiusMeters,
      },
    });
    return toGeoPointDto({ ...point, corridorFrom: null, corridorTo: null });
  }

  /**
   * Создать коридор доставщика: маршрут «еду из А в Б — могу подвезти».
   * Базовые координаты строки = точка старта (для карты и nearby).
   */
  async createCorridor(ownerId: string, input: CreateGeoCorridorInput): Promise<GeoPointDto> {
    const point = await this.prisma.geoPoint.create({
      data: {
        ownerId,
        kind: 'delivery_corridor',
        latitude: input.corridorFrom.lat,
        longitude: input.corridorFrom.lng,
        address: input.address,
        label: input.label,
        corridorFrom: input.corridorFrom,
        corridorTo: input.corridorTo,
        vehicleType: input.vehicleType,
        maxWeightKg: input.maxWeightKg,
        isRefrigerated: input.isRefrigerated,
      },
    });
    return toGeoPointDto(point as unknown as GeoPointRow);
  }

  /** Точки «рядом»: ST_DWithin по geography, GIST-индекс, метры честные. */
  async findNearby(query: GeoNearbyQuery): Promise<GeoPointDto[]> {
    const radius = query.radiusMeters ?? this.defaultRadiusMeters;
    // Фильтр по виду — опциональный фрагмент SQL (Prisma.empty без него).
    const kindFilter = query.kind
      ? Prisma.sql`AND "kind"::text = ${query.kind}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<GeoPointRow[]>(Prisma.sql`
      SELECT
        "id", "ownerId", "kind", "latitude", "longitude", "address", "label",
        "radiusMeters", "isActive", "corridorFrom", "corridorTo", "vehicleType",
        "maxWeightKg", "isRefrigerated", "createdAt", "updatedAt",
        ST_Distance(
          "geog",
          ST_SetSRID(ST_MakePoint(CAST(${query.lng} AS double precision), CAST(${query.lat} AS double precision)), 4326)::geography
        ) AS "distanceMeters"
      FROM "geo_points"
      WHERE "isActive" = true
        ${kindFilter}
        AND ST_DWithin(
          "geog",
          ST_SetSRID(ST_MakePoint(CAST(${query.lng} AS double precision), CAST(${query.lat} AS double precision)), 4326)::geography,
          CAST(${radius} AS double precision)
        )
      ORDER BY "distanceMeters" ASC
      LIMIT ${GEO_NEARBY_LIMIT}
    `);
    return rows.map(toGeoPointDto);
  }

  /**
   * Коридоры «рядом»: активные маршруты доставщиков, чья ЛИНИЯ
   * (start → finish) проходит не дальше radiusMeters от точки.
   */
  async findCorridorsNearby(query: {
    lat: number;
    lng: number;
    radiusMeters?: number;
  }): Promise<GeoPointDto[]> {
    const radius = query.radiusMeters ?? this.defaultRadiusMeters;

    const rows = await this.prisma.$queryRaw<GeoPointRow[]>(Prisma.sql`
      SELECT
        "id", "ownerId", "kind", "latitude", "longitude", "address", "label",
        "radiusMeters", "isActive", "corridorFrom", "corridorTo", "vehicleType",
        "maxWeightKg", "isRefrigerated", "createdAt", "updatedAt",
        ST_Distance(
          ST_MakeLine(
            ST_SetSRID(ST_MakePoint(
              CAST("corridorFrom"->>'lng' AS double precision),
              CAST("corridorFrom"->>'lat' AS double precision)
            ), 4326)::geography,
            ST_SetSRID(ST_MakePoint(
              CAST("corridorTo"->>'lng' AS double precision),
              CAST("corridorTo"->>'lat' AS double precision)
            ), 4326)::geography
          ),
          ST_SetSRID(ST_MakePoint(CAST(${query.lng} AS double precision), CAST(${query.lat} AS double precision)), 4326)::geography
        ) AS "distanceMeters"
      FROM "geo_points"
      WHERE "isActive" = true
        AND "kind" = 'delivery_corridor'
        AND "corridorFrom" IS NOT NULL
        AND "corridorTo" IS NOT NULL
        AND ST_DWithin(
          ST_MakeLine(
            ST_SetSRID(ST_MakePoint(
              CAST("corridorFrom"->>'lng' AS double precision),
              CAST("corridorFrom"->>'lat' AS double precision)
            ), 4326)::geography,
            ST_SetSRID(ST_MakePoint(
              CAST("corridorTo"->>'lng' AS double precision),
              CAST("corridorTo"->>'lat' AS double precision)
            ), 4326)::geography
          ),
          ST_SetSRID(ST_MakePoint(CAST(${query.lng} AS double precision), CAST(${query.lat} AS double precision)), 4326)::geography,
          CAST(${radius} AS double precision)
        )
      ORDER BY "distanceMeters" ASC
      LIMIT ${GEO_CORRIDORS_LIMIT}
    `);
    return rows.map(toGeoPointDto);
  }

  /** Мои геозоны (для экрана «Моя точка» и управления). */
  async findMine(ownerId: string): Promise<GeoPointDto[]> {
    const points = await this.prisma.geoPoint.findMany({
      where: { ownerId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    return points.map((point) => toGeoPointDto(point as unknown as GeoPointRow));
  }

  /** Обновить точку (только владелец, вид менять нельзя). */
  async updatePoint(
    id: string,
    ownerId: string,
    input: UpdateGeoPointInput,
  ): Promise<GeoPointDto> {
    const existing = await this.prisma.geoPoint.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Геозона не найдена');
    }
    if (existing.ownerId !== ownerId) {
      throw new ForbiddenException('Изменить геозону может только её владелец');
    }
    const updated = await this.prisma.geoPoint.update({
      where: { id },
      data: {
        ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.radiusMeters !== undefined ? { radiusMeters: input.radiusMeters } : {}),
      },
    });
    return toGeoPointDto(updated as unknown as GeoPointRow);
  }

  /** Деактивировать точку (isActive=false): история остаётся (ADR-014). */
  async deactivatePoint(id: string, ownerId: string): Promise<GeoPointDto> {
    const existing = await this.prisma.geoPoint.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Геозона не найдена');
    }
    if (existing.ownerId !== ownerId) {
      throw new ForbiddenException('Убрать геозону может только её владелец');
    }
    const updated = await this.prisma.geoPoint.update({
      where: { id },
      data: { isActive: false },
    });
    return toGeoPointDto(updated as unknown as GeoPointRow);
  }
}

/** Дефолт радиуса для документации и тестов. */
export const GEO_DEFAULT_RADIUS = DEFAULT_GEO_RADIUS_METERS_VALUE;

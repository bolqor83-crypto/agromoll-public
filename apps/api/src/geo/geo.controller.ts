/**
 * Геозоны (v0.5.0, подэтап B, ADR-014).
 *
 * - POST /geo/points — точка покупателя (buyer) или линия продавца (seller);
 * - POST /geo/corridors — маршрут доставщика (driver);
 * - GET /geo/points/nearby — активные точки в радиусе (ST_DWithin);
 * - GET /geo/corridors/nearby — маршруты, проходящие рядом с точкой;
 * - GET /geo/points/mine — свои геозоны;
 * - PATCH /geo/points/:id — обновить (только владелец);
 * - DELETE /geo/points/:id — деактивировать (история остаётся).
 */
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { GeoPointDto } from '@agromoll/types';
import {
  CreateGeoCorridorSchema,
  CreateGeoPointSchema,
  GeoNearbyQuerySchema,
  UpdateGeoPointSchema,
} from '@agromoll/validation';
import type {
  CreateGeoCorridorInput,
  CreateGeoPointInput,
  GeoNearbyQuery,
  UpdateGeoPointInput,
} from '@agromoll/validation';
import { CurrentUser, JwtAuthGuard, RolesGuard } from '../auth/auth.guards';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { GeoService } from './geo.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  /** Точка покупателя или линия продавца. */
  @Post('points')
  async createPoint(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateGeoPointSchema)) body: CreateGeoPointInput,
  ): Promise<GeoPointDto> {
    return this.geo.createPoint(user.id, user.role, body);
  }

  /** Маршрут доставщика «еду из А в Б». */
  @Post('corridors')
  async createCorridor(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateGeoCorridorSchema)) body: CreateGeoCorridorInput,
  ): Promise<GeoPointDto> {
    // Коридор — маршрут доставки, задаёт только driver (ADR-014).
    if (user.role !== 'driver') {
      throw new ForbiddenException('Маршрут задаёт только доставщик');
    }
    return this.geo.createCorridor(user.id, body);
  }

  /** Точки в радиусе (по умолчанию DEFAULT_GEO_RADIUS_METERS=2000). */
  @Get('points/nearby')
  async nearby(
    @Query(new ZodValidationPipe(GeoNearbyQuerySchema)) query: GeoNearbyQuery,
  ): Promise<GeoPointDto[]> {
    return this.geo.findNearby(query);
  }

  /** Маршруты доставщиков, проходящие рядом с точкой. */
  @Get('corridors/nearby')
  async corridorsNearby(
    @Query(new ZodValidationPipe(GeoNearbyQuerySchema)) query: GeoNearbyQuery,
  ): Promise<GeoPointDto[]> {
    // kind в query для коридоров не имеет смысла — вырезаем.
    const { kind: _kind, ...rest } = query;
    void _kind;
    return this.geo.findCorridorsNearby(rest);
  }

  /** Мои активные геозоны. */
  @Get('points/mine')
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<GeoPointDto[]> {
    return this.geo.findMine(user.id);
  }

  /** Обновить геозону (только владелец). */
  @Patch('points/:id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateGeoPointSchema)) body: UpdateGeoPointInput,
  ): Promise<GeoPointDto> {
    return this.geo.updatePoint(id, user.id, body);
  }

  /** Деактивировать геозону (isActive=false, не удалять). */
  @Delete('points/:id')
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<GeoPointDto> {
    return this.geo.deactivatePoint(id, user.id);
  }
}

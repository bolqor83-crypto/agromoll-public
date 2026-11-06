/**
 * Модуль геозон (v0.5.0, подэтап B, ADR-014).
 *
 * GeoService — CRUD точек + PostGIS-запросы «рядом» (ST_DWithin /
 * ST_Distance по geography, GIST-индекс). Радиус по умолчанию —
 * ENV DEFAULT_GEO_RADIUS_METERS (2000 м).
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_GEO_RADIUS_METERS_VALUE,
  GEO_DEFAULT_RADIUS_METERS,
} from './geo.constants';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';

@Module({
  controllers: [GeoController],
  providers: [
    GeoService,
    {
      provide: GEO_DEFAULT_RADIUS_METERS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): number => {
        const raw = config.get<number | string>('DEFAULT_GEO_RADIUS_METERS');
        const value =
          raw === undefined || raw === null ? DEFAULT_GEO_RADIUS_METERS_VALUE : Number(raw);
        if (!Number.isFinite(value) || value < 10 || value > 5000) {
          return DEFAULT_GEO_RADIUS_METERS_VALUE;
        }
        return Math.floor(value);
      },
    },
  ],
  exports: [GeoService],
})
export class GeoModule {}

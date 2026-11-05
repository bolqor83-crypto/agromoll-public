/**
 * Модуль учёта часов 289-ФЗ (v0.4.0, подэтап B, ADR-011).
 *
 * Пороги конфигурируются ENV: WORK_HOURS_MONTHLY_LIMIT=60,
 * WORK_MONTHS_SERIES=6 (для тестов можно сузить). WorkHoursCron —
 * ежедневная проверка серий в 03:00 МСК.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_WORK_HOURS_MONTHLY_LIMIT,
  DEFAULT_WORK_MONTHS_SERIES,
  WORK_HOURS_MONTHLY_LIMIT,
  WORK_MONTHS_SERIES,
} from './work-hours.constants';
import { WorkHoursController } from './work-hours.controller';
import { WorkHoursCron } from './work-hours.cron';
import { WorkHoursService } from './work-hours.service';

@Module({
  controllers: [WorkHoursController],
  providers: [
    WorkHoursService,
    WorkHoursCron,
    {
      provide: WORK_HOURS_MONTHLY_LIMIT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): number => {
        const raw = config.get<number>('WORK_HOURS_MONTHLY_LIMIT');
        const value = raw === undefined || raw === null ? DEFAULT_WORK_HOURS_MONTHLY_LIMIT : Number(raw);
        return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_WORK_HOURS_MONTHLY_LIMIT;
      },
    },
    {
      provide: WORK_MONTHS_SERIES,
      inject: [ConfigService],
      useFactory: (config: ConfigService): number => {
        const raw = config.get<number>('WORK_MONTHS_SERIES');
        const value = raw === undefined || raw === null ? DEFAULT_WORK_MONTHS_SERIES : Number(raw);
        return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_WORK_MONTHS_SERIES;
      },
    },
  ],
  exports: [WorkHoursService],
})
export class WorkHoursModule {}

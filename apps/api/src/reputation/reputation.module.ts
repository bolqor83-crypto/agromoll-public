/**
 * Модуль публичного рейтинга (v0.5.0, подэтап A, ADR-013).
 *
 * ReputationService экспортируется для триггеров в BookingsModule
 * (confirm-delivery и авто-подтверждение) и DebtsModule (settle /
 * dispute / resolve). Все веса и пороги — ENV с дефолтами спецификации.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  DEFAULT_RATING_MAX_PAIR_DEALS,
  DEFAULT_RATING_MIN_DEALS,
  DEFAULT_RATING_PAIR_CAP_WEIGHT,
  DEFAULT_RATING_PAIR_WINDOW_DAYS,
  DEFAULT_RATING_WEIGHT_ARBITRATION_COMPROMISE,
  DEFAULT_RATING_WEIGHT_ARBITRATION_LOSS,
  DEFAULT_RATING_WEIGHT_AUTO,
  DEFAULT_RATING_WEIGHT_DISPUTE,
  DEFAULT_RATING_WEIGHT_MINOR,
  DEFAULT_RATING_WEIGHT_OK,
  RATING_MAX_PAIR_DEALS,
  RATING_MIN_DEALS,
  RATING_PAIR_CAP_WEIGHT,
  RATING_PAIR_WINDOW_DAYS,
  RATING_WEIGHT_ARBITRATION_COMPROMISE,
  RATING_WEIGHT_ARBITRATION_LOSS,
  RATING_WEIGHT_AUTO,
  RATING_WEIGHT_DISPUTE,
  RATING_WEIGHT_MINOR,
  RATING_WEIGHT_OK,
} from './reputation.constants';
import { ReputationController } from './reputation.controller';
import { ReputationService } from './reputation.service';

/** Число из ENV с дефолтом и защитой от мусора (NaN/≤0 → дефолт). */
function numberOption(config: ConfigService, token: string, fallback: number): number {
  const raw = config.get<number | string>(token);
  const value = raw === undefined || raw === null ? fallback : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Целое число из ENV (пороги/лимиты): дробная часть отбрасывается. */
function intOption(config: ConfigService, token: string, fallback: number): number {
  return Math.floor(numberOption(config, token, fallback));
}

@Module({
  imports: [NotificationsModule],
  controllers: [ReputationController],
  providers: [
    ReputationService,
    {
      provide: RATING_MIN_DEALS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        intOption(config, 'RATING_MIN_DEALS', DEFAULT_RATING_MIN_DEALS),
    },
    {
      provide: RATING_MAX_PAIR_DEALS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        intOption(config, 'RATING_MAX_PAIR_DEALS', DEFAULT_RATING_MAX_PAIR_DEALS),
    },
    {
      provide: RATING_PAIR_WINDOW_DAYS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        intOption(config, 'RATING_PAIR_WINDOW_DAYS', DEFAULT_RATING_PAIR_WINDOW_DAYS),
    },
    {
      provide: RATING_WEIGHT_OK,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        numberOption(config, 'RATING_WEIGHT_OK', DEFAULT_RATING_WEIGHT_OK),
    },
    {
      provide: RATING_WEIGHT_MINOR,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        numberOption(config, 'RATING_WEIGHT_MINOR', DEFAULT_RATING_WEIGHT_MINOR),
    },
    {
      provide: RATING_WEIGHT_AUTO,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        numberOption(config, 'RATING_WEIGHT_AUTO', DEFAULT_RATING_WEIGHT_AUTO),
    },
    {
      provide: RATING_WEIGHT_DISPUTE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        numberOption(config, 'RATING_WEIGHT_DISPUTE', DEFAULT_RATING_WEIGHT_DISPUTE),
    },
    {
      provide: RATING_PAIR_CAP_WEIGHT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        numberOption(config, 'RATING_PAIR_CAP_WEIGHT', DEFAULT_RATING_PAIR_CAP_WEIGHT),
    },
    // v0.6.0-C (ADR-033): штрафы арбитража.
    {
      provide: RATING_WEIGHT_ARBITRATION_LOSS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        numberOption(config, 'RATING_WEIGHT_ARBITRATION_LOSS', DEFAULT_RATING_WEIGHT_ARBITRATION_LOSS),
    },
    {
      provide: RATING_WEIGHT_ARBITRATION_COMPROMISE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        numberOption(
          config,
          'RATING_WEIGHT_ARBITRATION_COMPROMISE',
          DEFAULT_RATING_WEIGHT_ARBITRATION_COMPROMISE,
        ),
    },
  ],
  exports: [ReputationService],
})
export class ReputationModule {}

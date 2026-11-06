/**
 * Модуль доставки попутчиками (v0.5.0, подэтап C, ADR-015).
 *
 * DeliveriesService — машина состояний доставки + интеграция 289-ФЗ
 * (WorkSession пары при взятии, BlockedPair → 409). TTL запроса —
 * ENV DELIVERY_TTL_MINUTES (60). DeliveryTtlCron гасит просроченные.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkHoursModule } from '../work-hours/work-hours.module';
import {
  DEFAULT_DELIVERY_TTL_MINUTES,
  DELIVERY_TTL_MINUTES,
} from './deliveries.constants';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { DeliveryTtlCron } from './delivery-ttl.cron';

@Module({
  imports: [WorkHoursModule],
  controllers: [DeliveriesController],
  providers: [
    DeliveriesService,
    DeliveryTtlCron,
    {
      provide: DELIVERY_TTL_MINUTES,
      inject: [ConfigService],
      useFactory: (config: ConfigService): number => {
        const raw = config.get<number | string>('DELIVERY_TTL_MINUTES');
        const value =
          raw === undefined || raw === null ? DEFAULT_DELIVERY_TTL_MINUTES : Number(raw);
        if (!Number.isFinite(value) || value <= 0) {
          return DEFAULT_DELIVERY_TTL_MINUTES;
        }
        return Math.floor(value);
      },
    },
  ],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}

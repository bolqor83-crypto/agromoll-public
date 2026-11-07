import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingsController } from './bookings.controller';
import { BookingTtlCron } from './booking-ttl.cron';
import { BookingAutoConfirmCron } from './booking-auto-confirm.cron';
import {
  BOOKING_TTL_MINUTES,
  DEFAULT_BOOKING_TTL_MINUTES,
  BOOKING_AUTO_CONFIRM_HOURS,
  DEFAULT_BOOKING_AUTO_CONFIRM_HOURS,
} from './bookings.constants';
import { BookingsService } from './bookings.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkHoursModule } from '../work-hours/work-hours.module';
import { ReputationModule } from '../reputation/reputation.module';
import { DisputesModule } from '../disputes/disputes.module';

/**
 * Модуль броней v0.2.0 + v0.4.0-C (приёмка, ADR-012).
 *
 * - BookingsService — машина состояний + атомарный резерв количества
 *   + confirm-delivery (приёмка) + авто-подтверждение;
 * - BookingTtlCron — гашение просроченных запросов каждую минуту;
 * - BookingAutoConfirmCron — завершение «забытых» приёмок ежечасно;
 * - DisputesModule (v0.6.0-C, ADR-033) — заморозка спорных броней
 *   (переходы и кроны молча пропускают брони под арбитражем);
 * - TTL и окно авто-подтверждения — ENV (BOOKING_TTL_MINUTES,
 *   BOOKING_AUTO_CONFIRM_HOURS).
 */
@Module({
  imports: [NotificationsModule, WorkHoursModule, ReputationModule, DisputesModule],
  controllers: [BookingsController],
  providers: [
    BookingsService,
    BookingTtlCron,
    BookingAutoConfirmCron,
    {
      provide: BOOKING_TTL_MINUTES,
      inject: [ConfigService],
      useFactory: (config: ConfigService): number => {
        const raw = config.get<number>('BOOKING_TTL_MINUTES');
        const value = raw === undefined || raw === null ? DEFAULT_BOOKING_TTL_MINUTES : Number(raw);
        if (!Number.isFinite(value) || value <= 0) {
          return DEFAULT_BOOKING_TTL_MINUTES;
        }
        return Math.floor(value);
      },
    },
    {
      provide: BOOKING_AUTO_CONFIRM_HOURS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): number => {
        const raw = config.get<number>('BOOKING_AUTO_CONFIRM_HOURS');
        const value =
          raw === undefined || raw === null ? DEFAULT_BOOKING_AUTO_CONFIRM_HOURS : Number(raw);
        if (!Number.isFinite(value) || value <= 0) {
          return DEFAULT_BOOKING_AUTO_CONFIRM_HOURS;
        }
        return Math.floor(value);
      },
    },
  ],
  exports: [BookingsService, BOOKING_TTL_MINUTES],
})
export class BookingsModule {}

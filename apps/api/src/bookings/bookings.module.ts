import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingsController } from './bookings.controller';
import { BookingTtlCron } from './booking-ttl.cron';
import { BOOKING_TTL_MINUTES, DEFAULT_BOOKING_TTL_MINUTES } from './bookings.constants';
import { BookingsService } from './bookings.service';

/**
 * Модуль броней v0.2.0: флоу «запрос → корректировка → подтверждение».
 *
 * - BookingsService — машина состояний + атомарный резерв количества;
 * - BookingTtlCron — гашение просроченных броней каждую минуту;
 * - TTL настраивается через BOOKING_TTL_MINUTES (по умолчанию 30).
 *
 * PrismaModule глобальный, поэтому здесь не импортируется.
 */
@Module({
  controllers: [BookingsController],
  providers: [
    BookingsService,
    BookingTtlCron,
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
  ],
  exports: [BookingsService, BOOKING_TTL_MINUTES],
})
export class BookingsModule {}

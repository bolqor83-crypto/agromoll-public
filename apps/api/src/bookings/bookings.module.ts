import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BOOKING_TTL_MINUTES, DEFAULT_BOOKING_TTL_MINUTES } from './bookings.constants';
import { BookingsService } from './bookings.service';

/**
 * Модуль броней. На подэтапе A (v0.2.0) содержит только доменный сервис —
 * контроллеры и cron появляются в подэтапе B (см. docs/adr/ADR-004).
 * PrismaModule глобальный, поэтому здесь не импортируется.
 */
@Module({
  providers: [
    BookingsService,
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

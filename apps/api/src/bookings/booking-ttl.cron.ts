import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingsService } from './bookings.service';

/**
 * Cron гашения просроченных броней: каждую минуту.
 *
 * TTL по умолчанию — 30 минут (BOOKING_TTL_MINUTES, см. ADR-004):
 * рынок живёт утром 4:00–14:00, «висящие» запросы не должны
 * вечно держать резерв товара.
 */
@Injectable()
export class BookingTtlCron {
  private readonly logger = new Logger(BookingTtlCron.name);

  constructor(private readonly bookings: BookingsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleStaleBookings(): Promise<void> {
    const expired = await this.bookings.expireStale();
    if (expired > 0) {
      this.logger.log({ expired }, 'booking:ttl');
    }
  }
}

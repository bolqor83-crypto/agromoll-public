import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingsService } from './bookings.service';

/**
 * Cron авто-подтверждения приёмки: ежечасно (v0.4.0-C, ADR-012).
 *
 * Если покупатель не подтвердил приёмку в течение
 * BOOKING_AUTO_CONFIRM_HOURS (по умолчанию 24) после подтверждения
 * брони продавцом — бронь завершается автоматически с qualityFlag=ok
 * и событием system_auto_confirmed. Это защита от «забыл подтвердить»:
 * продавец не должен страдать от забывчивости покупателя.
 */
@Injectable()
export class BookingAutoConfirmCron {
  private readonly logger = new Logger(BookingAutoConfirmCron.name);

  constructor(private readonly bookings: BookingsService) {}

  /** Ежечасно: окно 24 ч не требует минутной точности. */
  @Cron(CronExpression.EVERY_HOUR)
  async handleStaleDeliveries(): Promise<void> {
    try {
      const confirmed = await this.bookings.autoConfirmStale();
      if (confirmed > 0) {
        this.logger.log({ confirmed }, 'booking:auto-confirm');
      }
    } catch (error) {
      this.logger.error({ err: error }, 'booking:auto-confirm cron failed');
    }
  }
}

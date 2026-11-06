/**
 * TTL-крон доставки (v0.5.0, ADR-015): каждые 5 минут.
 *
 * Открытый запрос живёт DELIVERY_TTL_MINUTES (по умолчанию 60):
 * «висящие» заказы обесцениваются — рынок работает утром. Просроченные
 * open → expired (событие в журнал, резервов нет — возвращать нечего).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DeliveriesService } from './deliveries.service';

@Injectable()
export class DeliveryTtlCron {
  private readonly logger = new Logger(DeliveryTtlCron.name);

  constructor(private readonly deliveries: DeliveriesService) {}

  /** Каждые 5 минут: лёгкий запрос по индексу status+expiresAt. */
  @Cron('*/5 * * * *')
  async expireStale(): Promise<void> {
    try {
      await this.deliveries.expireStale();
    } catch (error) {
      // Крон не роняет процесс: ошибка — в лог, попытка через 5 минут.
      this.logger.error({ err: error }, 'delivery:ttl-cron failed');
    }
  }
}

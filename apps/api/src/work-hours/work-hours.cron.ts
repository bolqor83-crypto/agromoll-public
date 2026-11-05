/**
 * Крон проверки серий 289-ФЗ (v0.4.0, ADR-011): ежедневно в 03:00.
 *
 * Пары с monthCounted=true в текущем месяце при полной серии
 * (60+ ч × 6 месяцев подряд) блокируются. Fail-closed: блокировка
 * создаётся автоматически, снятие — только вручную поддержкой.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WorkHoursService } from './work-hours.service';

@Injectable()
export class WorkHoursCron {
  private readonly logger = new Logger(WorkHoursCron.name);

  constructor(private readonly workHours: WorkHoursService) {}

  /** 03:00 МСК — рынок закрыт, нагрузка на БД минимальна. */
  @Cron('0 3 * * *', { timeZone: 'Europe/Moscow' })
  async enforceSeries(): Promise<void> {
    try {
      const created = await this.workHours.enforceSeriesLimit();
      if (created > 0) {
        this.logger.log({ created }, 'work-hours:cron blocked pairs (289-ФЗ)');
      }
    } catch (error) {
      // Крон не должен ронять процесс: ошибка — в лог, попытка завтра.
      this.logger.error({ err: error }, 'work-hours:cron failed');
    }
  }
}

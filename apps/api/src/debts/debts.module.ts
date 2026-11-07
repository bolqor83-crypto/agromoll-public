/**
 * Модуль долгов v0.4.0 (подэтап A, ADR-010).
 *
 * DebtsService — машина состояний долга + append-only журнал DebtEvent.
 * Кулдаун напоминаний — DEBT_REMINDER_COOLDOWN_HOURS (по умолчанию 24).
 * NotificationsModule — доставка напоминаний (in-app + FCM при наличии
 * ключа; v0.4.0-C переиспользует его для уведомлений приёмки).
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReputationModule } from '../reputation/reputation.module';
import { DisputesModule } from '../disputes/disputes.module';
import {
  DEBT_REMINDER_COOLDOWN_HOURS,
  DEFAULT_DEBT_REMINDER_COOLDOWN_HOURS,
} from './debts.constants';
import { DebtsController } from './debts.controller';
import { DebtsService } from './debts.service';

@Module({
  imports: [NotificationsModule, ReputationModule, DisputesModule],
  controllers: [DebtsController],
  providers: [
    DebtsService,
    {
      provide: DEBT_REMINDER_COOLDOWN_HOURS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): number => {
        const raw = config.get<number>('DEBT_REMINDER_COOLDOWN_HOURS');
        const value = raw === undefined || raw === null ? DEFAULT_DEBT_REMINDER_COOLDOWN_HOURS : Number(raw);
        if (!Number.isFinite(value) || value <= 0) {
          return DEFAULT_DEBT_REMINDER_COOLDOWN_HOURS;
        }
        return Math.floor(value);
      },
    },
  ],
  exports: [DebtsService],
})
export class DebtsModule {}

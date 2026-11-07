/**
 * Модуль арбитража споров (v0.6.0-C, ADR-033).
 *
 * DisputesService экспортируется для заморозки объектов: BookingsModule,
 * DebtsModule и DeliveriesModule вызывают assertNoActiveDispute перед
 * бизнес-переходами. Циклических зависимостей нет: этот модуль работает
 * с бронями/долгами/доставками напрямую через Prisma, а не через их
 * сервисы (правки судьбы объекта — только в транзакции решения).
 */
import { Module } from '@nestjs/common';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReputationModule } from '../reputation/reputation.module';

@Module({
  imports: [NotificationsModule, ReputationModule],
  controllers: [DisputesController],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}

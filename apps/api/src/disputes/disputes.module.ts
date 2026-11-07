/**
 * Модуль арбитража споров (v0.6.0-C, ADR-033 → v0.7.0-B, ADR-036).
 *
 * DisputesService экспортируется для заморозки объектов: BookingsModule,
 * DebtsModule и DeliveriesModule вызывают assertNoActiveDispute перед
 * бизнес-переходами. Циклических зависимостей нет: этот модуль работает
 * с бронями/долгами/доставками напрямую через Prisma, а не через их
 * сервисы (правки судьбы объекта — только в транзакции решения).
 *
 * StorageModule — S3-хранилище доказательств (presigned URL, ADR-036).
 */
import { Module } from '@nestjs/common';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReputationModule } from '../reputation/reputation.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [NotificationsModule, ReputationModule, StorageModule],
  controllers: [DisputesController],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}

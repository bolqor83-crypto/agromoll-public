/**
 * Модуль уведомлений (v0.4.0 ADR-010 → v0.6.0-A ADR-031).
 *
 * Каналы опциональны и включаются ENV-переменными:
 *  - FCM_SERVICE_ACCOUNT_JSON — push на ios/android (FCM HTTP v1);
 *  - VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (+ VAPID_SUBJECT) — Web Push.
 * Без ключей транспорта — заглушки: in-app канал работает, e2e-тесты
 * в CI идут без Firebase (доставка мокается NoopPushTransport).
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FCM_SERVICE_ACCOUNT_JSON } from './notifications.constants';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [
    {
      provide: FCM_SERVICE_ACCOUNT_JSON,
      useFactory: (): string | undefined => process.env.FCM_SERVICE_ACCOUNT_JSON,
    },
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}

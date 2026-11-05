/**
 * Модуль уведомлений (v0.4.0, ADR-010).
 *
 * FCM_SERVER_KEY опционален: без него push-транспорт — заглушка,
 * работает только in-app доставка (dev, CI, локальный запуск).
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FCM_SERVER_KEY } from './notifications.constants';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [
    {
      provide: FCM_SERVER_KEY,
      useFactory: (): string | undefined => process.env.FCM_SERVER_KEY,
    },
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}

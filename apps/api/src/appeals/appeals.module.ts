/**
 * Модуль апелляций на блокировки 289-ФЗ (v0.6.0-E, ADR-035).
 *
 * Отдельный модуль, а не часть work-hours: жизненный цикл кейса —
 * арбитражный (как DisputesModule), а не учётный. WorkHoursService сам
 * расширил свои чтения (активная блокировка + её апелляция в строке
 * пары) — циклических зависимостей нет.
 */
import { Module } from '@nestjs/common';
import { AppealsController } from './appeals.controller';
import { AppealsService } from './appeals.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [AppealsController],
  providers: [AppealsService],
})
export class AppealsModule {}

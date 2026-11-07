/**
 * Уведомления (v0.4.0 ADR-010 → v0.6.0-A ADR-031).
 *
 * Чтения: свои in-app уведомления, отметка прочитанным, журнал push-доставок.
 * Регистрация push-каналов: FCM-токен (native) или Web Push-подписка (web) —
 * идемпотентные upsert'ы; unregister при logout. Публичный VAPID-ключ —
 * браузеру, чтобы подписаться Web Push.
 *
 * Отправки «извне» нет: уведомления порождаются только бизнес-событиями
 * (NotificationsService.send вызывают сервисы броней/долгов/доставок).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentUser, JwtAuthGuard } from '../auth/auth.guards';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RegisterPushSchema, UnregisterPushSchema } from '@agromoll/validation';
import type {
  NotificationLogListDto,
  PushRegistrationDto,
  RegisterPushInput,
  UnregisterPushInput,
  VapidPublicKeyDto,
} from '@agromoll/types';
import { NotificationsService } from './notifications.service';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Мои уведомления + счётчик непрочитанных. */
  @Get('me')
  async findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.findMine(user.id);
  }

  /** Публичный ключ VAPID (Web Push). null — сервер не настроен. */
  @Get('vapid-public')
  async vapidPublicKey(): Promise<VapidPublicKeyDto> {
    return { publicKey: this.notifications.getVapidPublicKey() };
  }

  /**
   * Журнал push-доставок (свои, для отладки «не пришло»):
   * канал, статус, текст ошибки. In-app уведомления — в /me.
   */
  @Get('log')
  async findLog(@CurrentUser() user: AuthenticatedUser): Promise<NotificationLogListDto> {
    return this.notifications.findLog(user.id);
  }

  /**
   * Регистрация push-канала: FCM-токен (ios/android) или Web Push-подписка.
   * Идемпотентно (upsert по token/endpoint) — клиент зовёт на каждом старте.
   */
  @Post('register')
  @HttpCode(201)
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(RegisterPushSchema)) input: RegisterPushInput,
  ): Promise<PushRegistrationDto> {
    if (input.platform === 'web') {
      await this.notifications.registerWebPush(user.id, input);
    } else {
      await this.notifications.registerDeviceToken(user.id, input);
    }
    return { registered: true };
  }

  /** Снятие регистрации при logout (best-effort, идемпотентно). */
  @Delete('unregister')
  @HttpCode(200)
  async unregister(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(UnregisterPushSchema)) input: UnregisterPushInput,
  ): Promise<PushRegistrationDto> {
    await this.notifications.unregister(user.id, input);
    return { registered: false };
  }

  /** Пометить прочитанным. 204 — успех, 404 — не найдено/чужое. */
  @Post(':id/read')
  @HttpCode(204)
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const ok = await this.notifications.markRead(user.id, id);
    if (!ok) {
      throw new NotFoundException('Уведомление не найдено');
    }
  }
}

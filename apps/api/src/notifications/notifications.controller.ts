/**
 * Уведомления: чтение своих + отметка прочитанным (v0.4.0, ADR-010).
 * Отправка — только внутренняя (NotificationsService.send), наружу
 * публичных POST нет: уведомления порождаются бизнес-событиями.
 */
import { Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard } from '../auth/auth.guards';
import type { AuthenticatedUser } from '../auth/auth.types';
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

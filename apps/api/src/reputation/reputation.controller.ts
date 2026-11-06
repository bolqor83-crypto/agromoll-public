/**
 * Публичный рейтинг (v0.5.0, подэтап A, ADR-013).
 *
 * - GET /reputation/me — мой рейтинг: свежий расчёт, подсказка прогресса
 *   («Сделайте ещё N сделок») и последние 20 событий журнала;
 * - GET /reputation/:userId — публичный профиль рейтинга (для бейджей
 *   на карточках контрагентов). Доступен любому аутентифицированному.
 */
import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import type { MyReputationDto, ReputationDto } from '@agromoll/types';
import { CurrentUser, JwtAuthGuard } from '../auth/auth.guards';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ReputationService } from './reputation.service';

@UseGuards(JwtAuthGuard)
@Controller('reputation')
export class ReputationController {
  constructor(private readonly reputation: ReputationService) {}

  /** Мой рейтинг: score, счётчики, прогресс до рейтинга, журнал. */
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MyReputationDto> {
    return this.reputation.getMyProfile(user.id);
  }

  /** Публичный профиль рейтинга пользователя. */
  @Get(':userId')
  async profile(@Param('userId', ParseUUIDPipe) userId: string): Promise<ReputationDto> {
    return this.reputation.getPublicProfile(userId);
  }
}

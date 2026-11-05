/**
 * Профиль пользователя (v0.3.0; v0.3.1 — отзыв сессий при смене роли).
 *
 * GET /users/me — профиль для мобильного клиента (после refresh-токена
 * клиенту нужно восстановить роль и имя).
 * PATCH /users/me/role — смена роли: выбор на экране входа и «Сменить роль»
 * теперь сохраняются на сервере (User.role), а не только в стейте клиента.
 * v0.3.1: смена роли отзывает все ДРУГИЕ сессии пользователя (ADR-008) —
 * если токен старой роли украли, «повышение» по нему не проживёт дольше
 * жизни access-токена (роль и так перечитывается из БД, refresh отзываем).
 */
import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { UpdateRoleSchema } from '@agromoll/validation';
import type { UpdateRoleInput } from '@agromoll/validation';
import type { UserDto } from '@agromoll/types';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, JwtAuthGuard } from '../auth/auth.guards';
import type { RequestWithUser } from '../auth/auth.guards';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService, toUserDto } from '../auth/auth.service';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /** Мой профиль: роль, имя, телефон. */
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<UserDto> {
    const profile = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    return toUserDto(profile);
  }

  /**
   * Сменить роль (buyer / seller / driver) — сохраняется в профиле.
   * Другие сессии пользователя отзываются: текущая (по familyId access-
   * токена) остаётся жить (ADR-008).
   */
  @Patch('me/role')
  async updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithUser,
    @Body(new ZodValidationPipe(UpdateRoleSchema)) body: UpdateRoleInput,
  ): Promise<UserDto> {
    // Сначала отзыв (fail-closed): не сменили роль — не отозвали и сессии.
    await this.auth.revokeOtherSessions(user.id, request.auth?.familyId);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { role: body.role },
    });
    return toUserDto(updated);
  }
}

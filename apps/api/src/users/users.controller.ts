/**
 * Профиль пользователя (v0.3.0).
 *
 * GET /users/me — профиль для мобильного клиента (после refresh-токена
 * клиенту нужно восстановить роль и имя).
 * PATCH /users/me/role — смена роли: выбор на экране входа и «Сменить роль»
 * теперь сохраняются на сервере (User.role), а не только в стейте клиента.
 */
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UpdateRoleSchema } from '@agromoll/validation';
import type { UpdateRoleInput } from '@agromoll/validation';
import type { UserDto } from '@agromoll/types';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, JwtAuthGuard } from '../auth/auth.guards';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { toUserDto } from '../auth/auth.service';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  /** Мой профиль: роль, имя, телефон. */
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<UserDto> {
    const profile = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    return toUserDto(profile);
  }

  /** Сменить роль (buyer / seller / driver) — сохраняется в профиле. */
  @Patch('me/role')
  async updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateRoleSchema)) body: UpdateRoleInput,
  ): Promise<UserDto> {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { role: body.role },
    });
    return toUserDto(updated);
  }
}

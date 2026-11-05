import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '@agromoll/types';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './auth.types';

/** Запрос с прикреплённым пользователем. */
export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

/** Заголовок заглушки аутентификации v0.2.0 (см. ADR-004). */
export const USER_ID_HEADER = 'x-user-id';

/**
 * Заглушка аутентификации: X-User-Id в заголовке.
 *
 * Guard читает заголовок, загружает пользователя из БД (роль и имя —
 * из БД, не от клиента) и прикрепляет к request.user.
 * Нет заголовка или пользователь не найден — 401.
 *
 * Заменяется на JWT на следующем этапе (см. ADR-004).
 */
@Injectable()
export class UserGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers[USER_ID_HEADER];

    const userId = Array.isArray(header) ? header[0] : header;
    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
      throw new UnauthorizedException('Требуется заголовок X-User-Id (заглушка auth v0.2.0)');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId.trim() },
      select: { id: true, role: true, displayName: true },
    });
    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    request.user = user;
    return true;
  }
}

export const ROLES_METADATA_KEY = 'agromoll:roles';

/** Декоратор @Roles('seller', ...): ограничивает эндпоинт списком ролей. */
export const Roles = (...roles: UserRole[]): MethodDecorator =>
  SetMetadata(ROLES_METADATA_KEY, roles);

/** Проверяет роль request.user против метаданных @Roles(...). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user || !required.includes(request.user.role)) {
      throw new ForbiddenException(`Доступно только для ролей: ${required.join(', ')}`);
    }
    return true;
  }
}

/** @CurrentUser() — текущий аутентифицированный пользователь в аргументах хендлера. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      throw new UnauthorizedException('Пользователь не аутентифицирован');
    }
    return request.user;
  },
);

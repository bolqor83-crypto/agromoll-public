/**
 * Guard'ы аутентификации v0.3.0 (телефон + JWT, см. ADR-007).
 *
 * JwtAuthGuard читает Authorization: Bearer <accessToken>, проверяет
 * подпись и срок, затем перечитывает пользователя из БД — роль всегда
 * свежая (смена роли действует сразу), а удалённый пользователь теряет
 * доступ даже с живым токеном. X-User-Id полностью удалён (переход v0.2.0 → v0.3.0).
 *
 * RolesGuard и @CurrentUser() перенесены без изменений логики:
 * проверка ролей идёт по request.user.role, который теперь приходит из БД.
 */
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
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { UserRole } from '@agromoll/types';
// ВАЖНО: обычный import (не `import type`) — Nest-инъекция требует
// runtime-метаданных design:paramtypes.
import { AuthService } from './auth.service';
import { DEV_ACCESS_SECRET } from './auth.constants';
import type { AuthenticatedUser, JwtPayload } from './auth.types';

/** Запрос с прикреплённым пользователем. */
export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

/** Схема заголовка: Authorization: Bearer <token>. */
const BEARER_PREFIX = 'bearer ';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers.authorization;

    if (!header || !header.toLowerCase().startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException('Требуется заголовок Authorization: Bearer <accessToken>');
    }
    const token = header.slice(BEARER_PREFIX.length).trim();
    if (token.length === 0) {
      throw new UnauthorizedException('Пустой access-токен');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? DEV_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Access-токен недействителен или истёк');
    }

    // Роль из БД, не из токена: смена роли действует сразу, а удалённый
    // пользователь не проходит даже с живым токеном.
    const user = await this.auth.getAuthenticatedUser(payload.sub);
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

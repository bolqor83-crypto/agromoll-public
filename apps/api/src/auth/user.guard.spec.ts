/**
 * Unit-тесты заглушки аутентификации: UserGuard (X-User-Id) и RolesGuard.
 */
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Roles, ROLES_METADATA_KEY, RolesGuard, UserGuard } from './user.guard';
import type { RequestWithUser } from './user.guard';
import type { PrismaService } from '../prisma/prisma.service';

function makeContext(request: Partial<RequestWithUser>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => function klass() {},
  } as unknown as ExecutionContext;
}

describe('UserGuard (заглушка X-User-Id)', () => {
  const prisma = { user: { findUnique: jest.fn() } } as unknown as PrismaService;
  const guard = new UserGuard(prisma);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('прикрепляет пользователя из БД к request', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u-1',
      role: 'seller',
      displayName: 'ФХ «Донская долина»',
    });
    const request: RequestWithUser = { headers: { 'x-user-id': 'u-1' } } as unknown as Request;

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user).toMatchObject({ id: 'u-1', role: 'seller' });
  });

  it('401 без заголовка', async () => {
    const request = { headers: {} } as unknown as Request;
    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('401 для неизвестного пользователя (роль подделать нельзя)', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const request = { headers: { 'x-user-id': 'ghost' } } as unknown as Request;

    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  function contextWithRoles(roles: string[] | undefined): ExecutionContext {
    const handler = function handler() {};
    if (roles !== undefined) {
      Reflect.defineMetadata(ROLES_METADATA_KEY, roles, handler);
    }
    return {
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u-1', role: 'buyer' } }) }),
      getHandler: () => handler,
      getClass: () => function klass() {},
    } as unknown as ExecutionContext;
  }

  it('пропускает, когда @Roles не задан', () => {
    expect(guard.canActivate(contextWithRoles(undefined))).toBe(true);
  });

  it('пропускает, когда роль в списке', () => {
    expect(guard.canActivate(contextWithRoles(['buyer']))).toBe(true);
  });

  it('403, когда роли нет в списке', () => {
    expect(() => guard.canActivate(contextWithRoles(['seller']))).toThrow(ForbiddenException);
  });

  it('403 без пользователя', () => {
    const handler = function handler() {};
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
      getHandler: () => handler,
      getClass: () => function klass() {},
    } as unknown as ExecutionContext;
    Reflect.defineMetadata(ROLES_METADATA_KEY, ['seller'], handler);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('декоратор @Roles кладёт метаданные', () => {
    const descriptor = Roles('seller', 'driver')({}, 'method', {
      value: function decorated() {},
    } as PropertyDescriptor);
    const roles = Reflect.getMetadata(ROLES_METADATA_KEY, (descriptor as PropertyDescriptor).value);
    expect(roles).toEqual(['seller', 'driver']);
  });
});

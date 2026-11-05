/**
 * Unit-тесты аутентификации v0.3.0: JwtAuthGuard и RolesGuard.
 */
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { Roles, ROLES_METADATA_KEY, RolesGuard, JwtAuthGuard } from './auth.guards';
import type { RequestWithUser } from './auth.guards';
import type { AuthService } from './auth.service';

function makeContext(request: Partial<RequestWithUser>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => function klass() {},
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard (Authorization: Bearer)', () => {
  const secret = 'test-access-secret';

  let jwt: JwtService;
  let auth: { getAuthenticatedUser: jest.Mock };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    // guard читает секрет из env — задаём один и тот же для подписи и проверки
    process.env.JWT_ACCESS_SECRET = secret;
    jwt = new JwtService({ secret });
    auth = { getAuthenticatedUser: jest.fn() };
    guard = new JwtAuthGuard(jwt, auth as unknown as AuthService);
  });

  afterAll(() => {
    delete process.env.JWT_ACCESS_SECRET;
  });

  it('прикрепляет пользователя из БД к request (роль свежая, не из токена)', async () => {
    const token = jwt.sign({ sub: 'u-1', role: 'buyer' });
    auth.getAuthenticatedUser.mockResolvedValue({
      id: 'u-1',
      role: 'seller', // роль сменилась после выпуска токена
      displayName: 'ФХ «Донская долина»',
      phone: '+79990000001',
    });
    const request: RequestWithUser = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as Request;

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user).toMatchObject({ id: 'u-1', role: 'seller' });
    expect(auth.getAuthenticatedUser).toHaveBeenCalledWith('u-1');
  });

  it('401 без заголовка Authorization', async () => {
    const request = { headers: {} } as unknown as Request;
    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('401 для схемы не Bearer', async () => {
    const request = { headers: { authorization: 'Basic dXNlcjpwYXNz' } } as unknown as Request;
    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('401 для мусорного токена', async () => {
    const request = { headers: { authorization: 'Bearer not-a-jwt' } } as unknown as Request;
    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('401 для токена, подписанного другим секретом', async () => {
    const alien = new JwtService({ secret: 'alien-secret' });
    const token = alien.sign({ sub: 'u-1', role: 'buyer' });
    const request = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('401 для пустого Bearer', async () => {
    const request = { headers: { authorization: 'Bearer ' } } as unknown as Request;
    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('401, когда пользователь удалён (токен жив)', async () => {
    const token = jwt.sign({ sub: 'ghost', role: 'buyer' });
    auth.getAuthenticatedUser.mockResolvedValue(null);
    const request = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;

    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('принимает Bearer в любом регистре', async () => {
    const token = jwt.sign({ sub: 'u-1', role: 'buyer' });
    auth.getAuthenticatedUser.mockResolvedValue({
      id: 'u-1',
      role: 'buyer',
      displayName: 'X',
      phone: null,
    });
    const request = { headers: { authorization: `bearer ${token}` } } as unknown as Request;
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
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

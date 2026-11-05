/**
 * Unit-тесты IdempotencyInterceptor (v0.3.0): резерв ключа, реплей,
 * 409 «в обработке», retry после failed, отсутствие заголовка.
 */
import { ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, throwError } from 'rxjs';
import { Prisma } from '@prisma/client';
import { Idempotent, IdempotencyInterceptor } from './idempotency.interceptor';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const USER: AuthenticatedUser = {
  id: 'u-1',
  role: 'buyer',
  displayName: 'Ларёк «У Ашота»',
  phone: '+79611234567',
};

function makeContext(headers: Record<string, string>, handler?: () => unknown) {
  const httpCode = 201;
  Reflect.defineMetadata('httpCode', httpCode, handler ?? (() => undefined));
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, user: USER, body: { listingId: 'l-1' } }),
      getResponse: () => ({ status: jest.fn() }),
    }),
    getHandler: () => handler ?? (() => undefined),
    getClass: () => function klass() {},
  } as never;
}

function makePrisma() {
  return {
    outboxOperation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService & {
    outboxOperation: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
}

const reflector = new Reflector();

describe('IdempotencyInterceptor', () => {
  it('эндпоинт без @Idempotent — обработчик без изменений', async () => {
    const prisma = makePrisma();
    const interceptor = new IdempotencyInterceptor(prisma, reflector);
    const handler = function plain() {};
    // @Idempotent НЕ вешаем

    const result = await new Promise((resolve) => {
      interceptor
        .intercept(makeContext({}, handler), { handle: () => of('plain-result') })
        .subscribe(resolve);
    });

    expect(result).toBe('plain-result');
    expect(prisma.outboxOperation.create).not.toHaveBeenCalled();
  });

  it('нет заголовка X-Idempotency-Key — обычное выполнение', async () => {
    const prisma = makePrisma();
    const interceptor = new IdempotencyInterceptor(prisma, reflector);
    const handler = function h() {};
    Idempotent('create_booking')({}, 'method', { value: handler } as PropertyDescriptor);

    const result = await new Promise((resolve) => {
      interceptor
        .intercept(makeContext({}, handler), { handle: () => of({ id: 'b-1' }) })
        .subscribe(resolve);
    });

    expect(result).toEqual({ id: 'b-1' });
    expect(prisma.outboxOperation.create).not.toHaveBeenCalled();
  });

  it('новый ключ: вставка received → выполнение → processed с результатом', async () => {
    const prisma = makePrisma();
    prisma.outboxOperation.create.mockResolvedValue({});
    const interceptor = new IdempotencyInterceptor(prisma, reflector);
    const handler = function h() {};
    Idempotent('create_booking')({}, 'method', { value: handler } as PropertyDescriptor);

    const result = await new Promise((resolve) => {
      interceptor
        .intercept(makeContext({ 'x-idempotency-key': 'key-1' }, handler), {
          handle: () => of({ id: 'b-1', status: 'requested' }),
        })
        .subscribe(resolve);
    });

    expect(result).toEqual({ id: 'b-1', status: 'requested' });
    expect(prisma.outboxOperation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clientUuid: 'key-1', state: 'received' }),
      }),
    );
    expect(prisma.outboxOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientUuid: 'key-1' },
        data: expect.objectContaining({ state: 'processed' }),
      }),
    );
  });

  it('повтор processed-ключа: реплей сохранённого результата без выполнения', async () => {
    const prisma = makePrisma();
    const conflict = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    prisma.outboxOperation.create.mockRejectedValue(conflict);
    prisma.outboxOperation.findUnique.mockResolvedValue({
      clientUuid: 'key-1',
      userId: USER.id,
      state: 'processed',
      result: { status: 201, body: { id: 'b-1', replayed: true } },
    });
    const interceptor = new IdempotencyInterceptor(prisma, reflector);
    const handler = function h() {};
    Idempotent('create_booking')({}, 'method', { value: handler } as PropertyDescriptor);

    let handlerCalled = false;
    const result = await new Promise((resolve) => {
      interceptor
        .intercept(makeContext({ 'x-idempotency-key': 'key-1' }, handler), {
          handle: () => {
            handlerCalled = true;
            return of({ id: 'should-not-happen' });
          },
        })
        .subscribe(resolve);
    });

    expect(handlerCalled).toBe(false);
    expect(result).toEqual({ id: 'b-1', replayed: true });
  });

  it('received-ключ (параллельный дубль) — 409 с кодом IDEMPOTENCY_IN_PROGRESS', async () => {
    const prisma = makePrisma();
    const conflict = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    prisma.outboxOperation.create.mockRejectedValue(conflict);
    prisma.outboxOperation.findUnique.mockResolvedValue({
      clientUuid: 'key-1',
      userId: USER.id,
      state: 'received',
    });
    const interceptor = new IdempotencyInterceptor(prisma, reflector);
    const handler = function h() {};
    Idempotent('create_booking')({}, 'method', { value: handler } as PropertyDescriptor);

    await expect(
      new Promise((_, reject) => {
        interceptor
          .intercept(makeContext({ 'x-idempotency-key': 'key-1' }, handler), {
            handle: () => of({}),
          })
          .subscribe({ error: reject });
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('чужой ключ — 409 без деталей', async () => {
    const prisma = makePrisma();
    const conflict = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    prisma.outboxOperation.create.mockRejectedValue(conflict);
    prisma.outboxOperation.findUnique.mockResolvedValue({
      clientUuid: 'key-1',
      userId: 'someone-else',
      state: 'processed',
      result: { status: 201, body: { secret: true } },
    });
    const interceptor = new IdempotencyInterceptor(prisma, reflector);
    const handler = function h() {};
    Idempotent('create_booking')({}, 'method', { value: handler } as PropertyDescriptor);

    await expect(
      new Promise((_, reject) => {
        interceptor
          .intercept(makeContext({ 'x-idempotency-key': 'key-1' }, handler), {
            handle: () => of({}),
          })
          .subscribe({ error: reject });
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('failed-ключ — повторное выполнение', async () => {
    const prisma = makePrisma();
    const conflict = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    prisma.outboxOperation.create.mockRejectedValue(conflict);
    prisma.outboxOperation.findUnique.mockResolvedValue({
      clientUuid: 'key-1',
      userId: USER.id,
      state: 'failed',
    });
    const interceptor = new IdempotencyInterceptor(prisma, reflector);
    const handler = function h() {};
    Idempotent('create_booking')({}, 'method', { value: handler } as PropertyDescriptor);

    const result = await new Promise((resolve) => {
      interceptor
        .intercept(makeContext({ 'x-idempotency-key': 'key-1' }, handler), {
          handle: () => of({ id: 'b-2', retried: true }),
        })
        .subscribe(resolve);
    });

    expect(result).toEqual({ id: 'b-2', retried: true });
    // строка переведена обратно в received перед повтором
    expect(prisma.outboxOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientUuid: 'key-1' },
        data: expect.objectContaining({ state: 'received' }),
      }),
    );
  });

  it('ошибка обработчика — state=failed, ошибка прокидывается', async () => {
    const prisma = makePrisma();
    prisma.outboxOperation.create.mockResolvedValue({});
    const interceptor = new IdempotencyInterceptor(prisma, reflector);
    const handler = function h() {};
    Idempotent('create_booking')({}, 'method', { value: handler } as PropertyDescriptor);

    await expect(
      new Promise((_, reject) => {
        interceptor
          .intercept(makeContext({ 'x-idempotency-key': 'key-err' }, handler), {
            handle: () => throwError(() => new Error('бронь больше остатка')),
          })
          .subscribe({ error: reject });
      }),
    ).rejects.toThrow('бронь больше остатка');

    expect(prisma.outboxOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientUuid: 'key-err' },
        data: expect.objectContaining({ state: 'failed' }),
      }),
    );
  });
});

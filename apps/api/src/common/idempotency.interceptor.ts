/**
 * Идемпотентность POST-эндпоинтов (v0.3.0, ADR-006).
 *
 * Механизм: клиент помечает мутацию заголовком X-Idempotency-Key (UUID,
 * «clientUuid» в локальном outbox). Интерцептор:
 *   1. Нет заголовка → обычное выполнение (механизм опциональный —
 *      обратная совместимость; мобильный клиент ключ присылает всегда).
 *   2. Ключ новый → строка OutboxOperation(state=received) → выполнение
 *      → state=processed + result ({status, body}) → ответ клиенту.
 *      Ошибка обработчика → state=failed, ошибка прокидывается; повтор
 *      с тем же ключом выполнит операцию заново.
 *   3. Ключ уже существует:
 *      processed → сохранённый result (status + тело) без выполнения;
 *      received  → 409 {code: IDEMPOTENCY_IN_PROGRESS} «в обработке»
 *                  (второй параллельный запрос с тем же ключом);
 *      failed    → повторное выполнение в той же строке.
 *   4. Ключ принадлежит другому пользователю → 409 без деталей
 *      (коллизия UUID практически невозможна, но отвечаем безопасно).
 *
 * «Ровно один раз» гарантирует уникальный индекс clientUuid: два
 * параллельных запроса с одним ключом не могут оба вставить строку.
 */
import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
// ВАЖНО: value-import, а не `import type` — Reflector участвует в DI
// (constructor(reflector: Reflector)). Type-only import стирает класс
// в рантайме, reflect-metadata видит design:type = Function, и Nest
// падает на компиляции модуля: «argument Function at index [1]».
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { catchError, from, mergeMap, of } from 'rxjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestWithUser } from '../auth/auth.guards';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Заголовок идемпотентности (UUID от клиента). */
export const IDEMPOTENCY_KEY_HEADER = 'x-idempotency-key';

/** Метаданные декоратора @Idempotent('create_booking'). */
export const IDEMPOTENT_METADATA_KEY = 'agromoll:idempotent';

/** Тип операции. Совпадает с enum OutboxOperationType в Prisma-схеме. */
export type IdempotentOperationType =
  | 'create_booking'
  | 'cancel_booking'
  | 'confirm_booking'
  | 'counter_offer_booking'
  | 'accept_counter_booking'
  | 'create_debt'
  | 'confirm_delivery'
  | 'settle_debt'
  | 'dispute_debt'
  | 'resolve_debt'
  | 'create_delivery'
  | 'assign_delivery'
  | 'start_delivery'
  | 'deliver_delivery'
  | 'cancel_delivery';

/** Пометить POST-эндпоинт идемпотентным. */
export const Idempotent = (operationType: IdempotentOperationType): MethodDecorator =>
  SetMetadata(IDEMPOTENT_METADATA_KEY, operationType);

/** Сохранённый результат: статус + тело ответа. */
interface StoredResult {
  status: number;
  body: unknown;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const operationType = this.reflector.getAllAndOverride<IdempotentOperationType | undefined>(
      IDEMPOTENT_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    // Эндпоинт не помечен @Idempotent — механизм не применяется.
    if (!operationType) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const response = context.switchToHttp().getResponse<Response>();
    const user = request.user as AuthenticatedUser | undefined;
    const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
    const clientUuid = (Array.isArray(rawKey) ? rawKey[0] : rawKey)?.trim();

    // Нет заголовка — обычное выполнение.
    if (!clientUuid || !user) {
      return next.handle();
    }

    const payload = (request.body ?? {}) as Prisma.InputJsonValue;

    // Резервируем ключ ДО выполнения обработчика.
    return from(this.reserve(operationType, clientUuid, user, payload)).pipe(
      mergeMap((outcome) => {
        if (outcome.kind === 'replay') {
          // Повтор: отвечаем сохранёнными статусом и телом.
          response.status(outcome.result.status);
          return of(outcome.result.body);
        }
        if (outcome.kind === 'in_progress') {
          throw new ConflictException({
            code: 'IDEMPOTENCY_IN_PROGRESS',
            message: 'Операция с этим ключом уже в обработке — повторите через пару секунд',
          });
        }
        // fresh | retry_failed: выполняем обработчик, фиксируем результат.
        const status = this.expectedStatus(context);
        return next.handle().pipe(
          mergeMap(async (body) => {
            await this.markProcessed(clientUuid, { status, body });
            return body;
          }),
          catchError(async (error: unknown) => {
            await this.markFailed(clientUuid);
            throw error;
          }),
        );
      }),
    );
  }

  /** Статус, который Nest поставит этому ответу (201 по умолчанию). */
  private expectedStatus(context: ExecutionContext): number {
    const httpCode = Reflect.getMetadata('httpCode', context.getHandler()) as number | undefined;
    return httpCode ?? 201;
  }

  /** Вставка резерва или анализ существующей строки. */
  private async reserve(
    operationType: IdempotentOperationType,
    clientUuid: string,
    user: AuthenticatedUser,
    payload: Prisma.InputJsonValue,
  ): Promise<
    | { kind: 'fresh' }
    | { kind: 'retry_failed' }
    | { kind: 'in_progress' }
    | { kind: 'replay'; result: StoredResult }
  > {
    try {
      await this.prisma.outboxOperation.create({
        data: { clientUuid, userId: user.id, operationType, payload, state: 'received' },
      });
      return { kind: 'fresh' };
    } catch (error) {
      const isUnique =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!isUnique) {
        throw error;
      }
    }

    const existing = await this.prisma.outboxOperation.findUnique({ where: { clientUuid } });
    if (!existing) {
      // строку только что перезаписали/удалили — резервируем ещё раз
      await this.prisma.outboxOperation.create({
        data: { clientUuid, userId: user.id, operationType, payload, state: 'received' },
      });
      return { kind: 'fresh' };
    }

    // Чужой пользователь: не раскрываем детали, отвечаем как «в обработке».
    if (existing.userId !== user.id || existing.state === 'received') {
      return { kind: 'in_progress' };
    }
    if (existing.state === 'processed') {
      const stored = existing.result as StoredResult | null;
      if (stored && typeof stored.status === 'number') {
        return { kind: 'replay', result: stored };
      }
      return { kind: 'in_progress' }; // результата нет (аномалия) — не выполняем повторно
    }
    // failed — выполняем заново под тем же ключом.
    await this.prisma.outboxOperation.update({
      where: { clientUuid },
      data: { state: 'received', result: Prisma.DbNull, payload },
    });
    return { kind: 'retry_failed' };
  }

  private async markProcessed(clientUuid: string, result: StoredResult): Promise<void> {
    await this.prisma.outboxOperation
      .update({
        where: { clientUuid },
        data: {
          state: 'processed',
          result: result as unknown as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      })
      .catch(() => undefined);
  }

  private async markFailed(clientUuid: string): Promise<void> {
    await this.prisma.outboxOperation
      .update({ where: { clientUuid }, data: { state: 'failed' } })
      .catch(() => undefined);
  }
}

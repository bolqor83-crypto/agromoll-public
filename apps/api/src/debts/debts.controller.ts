/**
 * Долги: REST API подэтапа A v0.4.0 (ADR-010).
 *
 * Платформа не является платёжным агентом — эндпоинты только учтут
 * договорённость сторон. Ролей не ограничиваем: дать в долг может
 * любой участник рынка (экраны «Долги» — у покупателя и продавца).
 * Принадлежность конкретному долгу — вторая линия обороны (сервис).
 *
 * Идемпотентные POST (X-Idempotency-Key, ADR-006): create, settle,
 * dispute, resolve. reminder — НЕ идемпотентный: его защита от
 * повторов — кулдаун 24 ч (429 DEBT_REMINDER_COOLDOWN).
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateDebtSchema,
  DebtStatusSchema,
  DisputeDebtSchema,
} from '@agromoll/validation';
import type { CreateDebtInput, DisputeDebtInput } from '@agromoll/validation';
import type { ZodType } from 'zod';
import type { DebtStatus } from '@agromoll/types';
import { CurrentUser, JwtAuthGuard } from '../auth/auth.guards';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../common/idempotency.interceptor';
import { DebtsService } from './debts.service';

@Controller('debts')
@UseGuards(JwtAuthGuard)
export class DebtsController {
  constructor(private readonly debts: DebtsService) {}

  /** Записать «отпустил в долг» (кредитор — текущий пользователь). */
  @Post()
  @Idempotent('create_debt')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateDebtSchema)) body: CreateDebtInput,
  ) {
    return this.debts.create({
      creditorId: user.id,
      debtorId: body.debtorId,
      amount: body.amount,
      currency: body.currency,
      description: body.description,
      listingId: body.listingId,
      bookingId: body.bookingId,
    });
  }

  /**
   * Мои долги: где я кредитор («мне должны») и где дебитор («я должен»).
   * Направление клиент определяет сравнением creditorId/debtorId со своим id.
   * Фильтры: ?status=, ?dateFrom=ISO, ?dateTo=ISO.
   */
  @Get()
  async findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.debts.findMine({
      userId: user.id,
      status: parseStatusFilter(status),
      dateFrom: parseDateFilter(dateFrom, 'dateFrom'),
      dateTo: parseDateFilter(dateTo, 'dateTo'),
    });
  }

  /** Сводка для виджета главного экрана: должны мне / должен я. */
  @Get('summary')
  async summary(@CurrentUser() user: AuthenticatedUser) {
    return this.debts.summary(user.id);
  }

  /** Контрагенты для формы: с кем уже были сделки (по броням). */
  @Get('counterparties')
  async counterparties(@CurrentUser() user: AuthenticatedUser) {
    return this.debts.counterparties(user.id);
  }

  /** Погасить (любая сторона). Идемпотентно. */
  @Post(':id/settle')
  @Idempotent('settle_debt')
  async settle(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.debts.settle({ debtId: id, actorId: user.id });
  }

  /** Открыть спор (любая сторона). Идемпотентно. */
  @Post(':id/dispute')
  @Idempotent('dispute_debt')
  async dispute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(DisputeDebtSchema)) body: DisputeDebtInput,
  ) {
    return this.debts.dispute({ debtId: id, actorId: user.id, reason: body.reason });
  }

  /** Разрешить спор обоюдно (два подтверждения разных сторон). */
  @Post(':id/resolve')
  @Idempotent('resolve_debt')
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.debts.resolve({ debtId: id, actorId: user.id });
  }

  /** Напомнить дебитору (только кредитор; кулдаун 24 ч → 429). */
  @Post(':id/reminder')
  async remind(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.debts.remind({ debtId: id, actorId: user.id });
  }
}

/** Фильтр статуса из query: пусто → не фильтровать, мусор → 400. */
function parseStatusFilter(value: string | undefined): DebtStatus | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const schema: ZodType<DebtStatus> = DebtStatusSchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(`Некорректный статус долга: ${value}`);
  }
  return parsed.data;
}

/** ISO-дата из query: пусто → не фильтровать, мусор → 400. */
function parseDateFilter(value: string | undefined, name: string): Date | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Некорректная дата «${name}»: ${value}`);
  }
  return date;
}

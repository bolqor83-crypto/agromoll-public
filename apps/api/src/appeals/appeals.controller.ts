/**
 * Контроллер апелляций на блокировки 289-ФЗ (v0.6.0-E, ADR-035).
 *
 * Роли на эндпоинтах — первая линия обороны (RolesGuard), принадлежность
 * к паре/кейсу — вторая (методы сервиса). Стороны пары не решают кейсы,
 * арбитр не подаёт апелляций (он не сторона пары — сервис это проверяет).
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  AppealMessageSchema,
  OpenAppealSchema,
  ResolveAppealSchema,
} from '@agromoll/validation';
import type {
  AppealMessageInput,
  OpenAppealInput,
  ResolveAppealInput,
} from '@agromoll/validation';
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../auth/auth.guards';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../common/idempotency.interceptor';
import { AppealsService } from './appeals.service';

@Controller('appeals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AppealsController {
  constructor(private readonly appeals: AppealsService) {}

  /**
   * Открыть апелляцию на блокировку пары — только стороны рынка
   * (buyer/seller/driver): стороной пары бывают seller и driver,
   * проверка принадлежности — в сервисе.
   */
  @Post()
  @Roles('buyer', 'seller', 'driver')
  @Idempotent('open_appeal')
  async open(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(OpenAppealSchema)) body: OpenAppealInput,
  ) {
    return this.appeals.open(user.id, body);
  }

  /** Мои апелляции: поданные мной и по моим парам. */
  @Get('mine')
  async findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.appeals.findMine(user.id);
  }

  /** Очередь апелляций: активные кейсы, старые сверху — только арбитр. */
  @Get('queue')
  @Roles('arbitrator')
  async findQueue() {
    return this.appeals.findQueue();
  }

  /** Детали кейса + история месяцев часов пары (доказательство) + переписка. */
  @Get(':id')
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.appeals.findOne(user, id);
  }

  /** Список сообщений кейса (v0.7.0-C, ADR-037): паре — публичные, арбитру — все. */
  @Get(':id/messages')
  async listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.appeals.listMessages(user, id);
  }

  /** Сообщение в переписке кейса (append-only; isInternal — только арбитр). */
  @Post(':id/messages')
  @Idempotent('appeal_message')
  async postMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AppealMessageSchema)) body: AppealMessageInput,
  ) {
    return this.appeals.postMessage(user, id, body);
  }

  /** Взять апелляцию в работу: open → under_review. Только арбитр. */
  @Post(':id/assign')
  @Roles('arbitrator')
  @Idempotent('assign_appeal')
  async assign(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.appeals.assign(user.id, id);
  }

  /** Решение: снять блокировку или отклонить. Только арбитр. */
  @Post(':id/resolve')
  @Roles('arbitrator')
  @Idempotent('resolve_appeal')
  async resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ResolveAppealSchema)) body: ResolveAppealInput,
  ) {
    return this.appeals.resolve(user.id, id, body);
  }
}

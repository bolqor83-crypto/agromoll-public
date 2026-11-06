/**
 * Доставка попутчиками (v0.5.0, подэтап C, ADR-015).
 *
 * - POST /deliveries — покупатель создаёт запрос (офлайн — через outbox);
 * - GET /deliveries/open — радар водителя (попутные его маршруту);
 * - GET /deliveries/me — мои (покупателю — созданные, водителю — взятые);
 * - POST /deliveries/:id/assign — взять (409 при блокировке 289-ФЗ);
 * - POST /deliveries/:id/start — выехал;
 * - POST /deliveries/:id/deliver — передал (закрытие смены пары);
 * - POST /deliveries/:id/cancel — отмена (после выезда — только водитель).
 *
 * Все мутации идемпотентны (X-Idempotency-Key, ADR-006).
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { DeliveryDto } from '@agromoll/types';
import { CancelDeliverySchema, CreateDeliverySchema } from '@agromoll/validation';
import type { CancelDeliveryInput, CreateDeliveryInput } from '@agromoll/validation';
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../auth/auth.guards';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Idempotent } from '../common/idempotency.interceptor';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DeliveriesService } from './deliveries.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  /** Создать запрос доставки — только покупатель. */
  @Post()
  @Roles('buyer')
  @Idempotent('create_delivery')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateDeliverySchema)) body: CreateDeliveryInput,
  ): Promise<DeliveryDto> {
    return this.deliveries.create(user.id, body);
  }

  /** Радар: открытые заказы (попутные маршрутам водителя). */
  @Get('open')
  @Roles('driver')
  async open(@CurrentUser() user: AuthenticatedUser): Promise<DeliveryDto[]> {
    return this.deliveries.findOpen(user.id);
  }

  /** Мои доставки: buyer — созданные, driver — взятые. */
  @Get('me')
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<DeliveryDto[]> {
    return this.deliveries.findMine(user.id);
  }

  /** Взять заказ — только водитель. 409 DELIVERY_PAIR_BLOCKED (289-ФЗ). */
  @Post(':id/assign')
  @Roles('driver')
  @Idempotent('assign_delivery')
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DeliveryDto> {
    return this.deliveries.assign(id, user.id);
  }

  /** Выехал к точке забора. */
  @Post(':id/start')
  @Roles('driver')
  @Idempotent('start_delivery')
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DeliveryDto> {
    return this.deliveries.start(id, user.id);
  }

  /** Передача завершена (QR-подтверждение — на клиенте, ADR-015). */
  @Post(':id/deliver')
  @Roles('driver')
  @Idempotent('deliver_delivery')
  async deliver(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DeliveryDto> {
    return this.deliveries.deliver(id, user.id);
  }

  /** Отмена: до выезда — любая сторона, после — водитель с причиной. */
  @Post(':id/cancel')
  @Idempotent('cancel_delivery')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CancelDeliverySchema)) body: CancelDeliveryInput,
  ): Promise<DeliveryDto> {
    return this.deliveries.cancel(id, user.id, body.reason);
  }
}

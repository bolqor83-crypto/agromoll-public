/**
 * REST API учёта часов 289-ФЗ (v0.4.0, ADR-011).
 *
 * Только часы — никаких денег. Сессию начинает водитель (или флоу
 * доставки — триггер в подэтапе C), завершает любая сторона пары.
 * Проверка пары перед взятием заказа — GET /check: клиент показывает
 * мягкие предупреждения и экран паузы (не «вы нарушили закон»).
 */
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  Body,
} from '@nestjs/common';
import { StartWorkSessionSchema } from '@agromoll/validation';
import type { StartWorkSessionInput } from '@agromoll/validation';
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../auth/auth.guards';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WorkHoursService } from './work-hours.service';

@Controller('work-hours')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkHoursController {
  constructor(private readonly workHours: WorkHoursService) {}

  /** Мои пары за текущий месяц (driver — по продавцам, seller — по водителям). */
  @Get('me')
  async findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.workHours.findMine(user.id);
  }

  /**
   * Можно ли паре работать: блокировка, часы и серия — всё для мягких
   * предупреждений UI. Публично для участников рынка (id — UUID).
   */
  @Get('check/:driverId/:sellerId')
  async checkPair(
    @Param('driverId', ParseUUIDPipe) driverId: string,
    @Param('sellerId', ParseUUIDPipe) sellerId: string,
  ) {
    return this.workHours.checkPair(driverId, sellerId);
  }

  /** Открытая смена водителя (для экрана «Мои часы»). */
  @Get('open-session')
  async findOpenSession(@CurrentUser() user: AuthenticatedUser) {
    return this.workHours.findOpenSession(user.id);
  }

  /** Начать смену с продавцом — только driver. 409 если пара заблокирована. */
  @Post('sessions')
  @Roles('driver')
  async startSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(StartWorkSessionSchema)) body: StartWorkSessionInput,
  ) {
    return this.workHours.startSession(user.id, body.sellerId);
  }

  /** Завершить смену — водитель или продавец пары (идемпотентно). */
  @Post('sessions/:id/end')
  async endSession(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workHours.endSession(id, user.id);
  }
}

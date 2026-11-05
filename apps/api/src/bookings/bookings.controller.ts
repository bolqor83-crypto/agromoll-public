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
  BookingStatusSchema,
  CancelBookingSchema,
  CounterOfferSchema,
  CreateBookingSchema,
} from '@agromoll/validation';
import type {
  CancelBookingInput,
  CounterOfferInput,
  CreateBookingInput,
} from '@agromoll/validation';
import type { ZodType } from 'zod';
import type { BookingStatus } from '@agromoll/types';
import { CurrentUser, Roles, RolesGuard, JwtAuthGuard } from '../auth/auth.guards';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { toBookingDto } from '../common/serialization';
import { BookingsService } from './bookings.service';

/**
 * Флоу брони: запрос → корректировка → подтверждение.
 *
 * Роли на эндпоинтах — первая линия обороны (RolesGuard),
 * принадлежность конкретной брони — вторая (машина состояний в сервисе).
 */
@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** Создать запрос брони — только buyer. */
  @Post()
  @Roles('buyer')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateBookingSchema)) body: CreateBookingInput,
  ) {
    const booking = await this.bookings.create({
      listingId: body.listingId,
      buyerId: user.id,
      requestedQuantity: body.requestedQuantity,
    });
    return toBookingDto(booking);
  }

  /**
   * Мои брони: buyer видит свои запросы, seller — входящие по его листингам.
   * Опциональный фильтр ?status=.
   */
  @Get()
  async findMine(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    const statusFilter = parseStatusFilter(status);
    if (user.role === 'buyer') {
      return this.bookings.findByBuyer(user.id, statusFilter);
    }
    if (user.role === 'seller') {
      return this.bookings.findIncomingForSeller(user.id, statusFilter);
    }
    // Доставщик в флоу брони не участвует — пустой список.
    return [];
  }

  /** Предложить корректировку — только seller лота. */
  @Post(':id/counter-offer')
  @Roles('seller')
  async counterOffer(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CounterOfferSchema)) body: CounterOfferInput,
  ) {
    const booking = await this.bookings.counterOffer({
      bookingId: id,
      actorId: user.id,
      offeredQuantity: body.offeredQuantity,
      pickupTime: body.pickupTime,
      note: body.note,
    });
    return toBookingDto(booking);
  }

  /** Принять корректировку — только buyer. */
  @Post(':id/accept-counter')
  @Roles('buyer')
  async acceptCounter(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const booking = await this.bookings.acceptCounter({ bookingId: id, actorId: user.id });
    return toBookingDto(booking);
  }

  /** Подтвердить запрос как есть — только seller лота. */
  @Post(':id/confirm')
  @Roles('seller')
  async confirm(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const booking = await this.bookings.confirm({ bookingId: id, actorId: user.id });
    return toBookingDto(booking);
  }

  /** Отменить — покупатель брони или продавец лота (проверка в сервисе). */
  @Post(':id/cancel')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CancelBookingSchema)) body: CancelBookingInput,
  ) {
    const booking = await this.bookings.cancel({
      bookingId: id,
      actorId: user.id,
      reason: body.reason,
    });
    return toBookingDto(booking);
  }
}

/** Фильтр статуса из query: пусто → не фильтровать, мусор → 400. */
function parseStatusFilter(value: string | undefined): BookingStatus | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const schema: ZodType<BookingStatus> = BookingStatusSchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(`Некорректный статус брони: ${value}`);
  }
  return parsed.data;
}

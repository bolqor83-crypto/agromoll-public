import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ZodType } from 'zod';
import {
  AttachListingPhotoSchema,
  CreateListingSchema,
  ListingCategorySchema,
  ListingPhotoUploadUrlSchema,
  ListingStatusSchema,
  UpdateListingSchema,
} from '@agromoll/validation';
import type {
  AttachListingPhotoInput,
  CreateListingInput,
  ListingPhotoUploadUrlInput,
  UpdateListingInput,
} from '@agromoll/validation';
import { CurrentUser, Roles, RolesGuard, JwtAuthGuard } from '../auth/auth.guards';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Idempotent } from '../common/idempotency.interceptor';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ListingsService } from './listings.service';

/**
 * Листинги. Чтение (лента и карточка) — публично; создание — только seller;
 * изменение — только владелец (проверка в сервисе).
 */
@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateListingSchema)) body: CreateListingInput,
  ) {
    return this.listings.create(user.id, body);
  }

  /** Лента: фильтры category / status / lineNumber; без status — только активные. */
  @Get()
  findMany(
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('lineNumber') lineNumber?: string,
  ) {
    return this.listings.findMany({
      category: parseEnumFilter('category', category, ListingCategorySchema),
      status: parseEnumFilter('status', status, ListingStatusSchema),
      lineNumber: parseLineNumber(lineNumber),
    });
  }

  /** Витрина продавца — свои лоты. */
  @Get('mine')
  @UseGuards(JwtAuthGuard)
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.listings.findMine(user.id);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.listings.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateListingSchema)) body: UpdateListingInput,
  ) {
    return this.listings.update(id, user.id, body);
  }

  // ─── Фото товаров (v0.7.0-D, ADR-038) ──────────────────────────────────
  // Владелец лота (проверка в сервисе, не ролями: seller создаёт лоты,
  // но владелец — конкретный seller). Файлы идут напрямую в S3 по
  // presigned URL — API не перекачивает мегабайты.

  /** Presigned URL для прямой загрузки фото. */
  @Post(':id/photos/upload-url')
  @UseGuards(JwtAuthGuard)
  createPhotoUploadUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(ListingPhotoUploadUrlSchema)) body: ListingPhotoUploadUrlInput,
  ) {
    return this.listings.createPhotoUploadUrl(user.id, id, body);
  }

  /** Приложить фото: objectKey (S3) или dataUrl (fallback ≤ 500 КБ). */
  @Post(':id/photos')
  @UseGuards(JwtAuthGuard)
  @Idempotent('listing_photo')
  attachPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(AttachListingPhotoSchema)) body: AttachListingPhotoInput,
  ) {
    return this.listings.attachPhoto(user.id, id, body);
  }

  /** Удалить фото (позиции остальных пересобираются). */
  @Delete(':id/photos/:photoId')
  @UseGuards(JwtAuthGuard)
  deletePhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.listings.deletePhoto(user.id, id, photoId);
  }
}

/** Опциональный enum-фильтр из query: undefined → не фильтровать, мусор → 400. */
function parseEnumFilter<T extends string>(
  name: string,
  value: string | undefined,
  schema: ZodType<T>,
): T | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(`Некорректное значение фильтра «${name}»: ${value}`);
  }
  return parsed.data;
}

function parseLineNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`Некорректный номер линии: ${value}`);
  }
  return parsed;
}

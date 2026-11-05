import { z } from 'zod';
import {
  BOOKING_ACTIONS,
  BOOKING_STATUSES,
  LISTING_CATEGORIES,
  LISTING_STATUSES,
  LISTING_UNITS,
  USER_ROLES,
} from '@agromoll/types';

/**
 * Пакет валидации «АгроМолл».
 *
 * Единый источник схем для API (ZodValidationPipe в NestJS) и, в будущем,
 * для мобильного клиента (проверка ответов API перед рендером).
 */

/** Роль пользователя. Дублирует enum UserRole из Prisma-схемы (apps/api). */
export const UserRoleSchema = z.enum(USER_ROLES);

export const ListingCategorySchema = z.enum(LISTING_CATEGORIES);
export const ListingUnitSchema = z.enum(LISTING_UNITS);
export const ListingStatusSchema = z.enum(LISTING_STATUSES);
export const BookingStatusSchema = z.enum(BOOKING_STATUSES);
export const BookingActionSchema = z.enum(BOOKING_ACTIONS);

/** Создание листинга: POST /listings (только seller). */
export const CreateListingSchema = z.object({
  title: z.string().trim().min(2, 'Название слишком короткое').max(200),
  category: ListingCategorySchema,
  unit: ListingUnitSchema,
  /** Цена за единицу, ₽. Decimal передаётся строкой, чтобы не терять точность. */
  pricePerUnit: z.coerce.number().positive('Цена должна быть положительной').max(1_000_000),
  quantityAvailable: z.coerce
    .number()
    .int()
    .positive('Количество должно быть положительным')
    .max(1_000_000),
  /** Номер линии/ряда на рынке. */
  lineNumber: z.coerce.number().int().positive().max(10_000).optional(),
  isPerishable: z.boolean().optional().default(false),
});

export type CreateListingInput = z.infer<typeof CreateListingSchema>;

/** Частичное обновление листинга: PATCH /listings/:id (только владелец). */
export const UpdateListingSchema = CreateListingSchema.partial()
  .extend({ status: ListingStatusSchema.optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Пустое обновление' });

export type UpdateListingInput = z.infer<typeof UpdateListingSchema>;

/** Создание брони: POST /bookings (только buyer). */
export const CreateBookingSchema = z.object({
  listingId: z.string().uuid(),
  requestedQuantity: z.coerce
    .number()
    .int()
    .positive('Количество должно быть положительным')
    .max(1_000_000),
});

export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;

/**
 * Корректировка брони: POST /bookings/:id/counter-offer (только seller).
 * Предложить можно другое количество и/или другое время/условия выкупа.
 */
export const CounterOfferSchema = z
  .object({
    offeredQuantity: z.coerce.number().int().positive().max(1_000_000).optional(),
    /** Свободная строка: «после 9:00», «ящиками по 20 кг» и т.п. */
    pickupTime: z.string().trim().max(200).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine(
    (value) =>
      value.offeredQuantity !== undefined ||
      value.pickupTime !== undefined ||
      value.note !== undefined,
    { message: 'Укажите предложенное количество, время или комментарий' },
  );

export type CounterOfferInput = z.infer<typeof CounterOfferSchema>;

/** Отмена брони: POST /bookings/:id/cancel (любая сторона). */
export const CancelBookingSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export type CancelBookingInput = z.infer<typeof CancelBookingSchema>;

/** Переменные окружения API. */
export const apiEnvSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  /** TTL запроса брони в минутах. По умолчанию 30 — «живой» рынок 4:00–14:00. */
  BOOKING_TTL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 60)
    .default(30),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

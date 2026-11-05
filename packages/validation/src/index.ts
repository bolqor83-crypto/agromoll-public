import { z } from 'zod';
import {
  BOOKING_ACTIONS,
  BOOKING_STATUSES,
  LISTING_CATEGORIES,
  LISTING_STATUSES,
  LISTING_UNITS,
  USER_ROLES,
  normalizePhone,
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

/**
 * Телефон в любом российском написании: +7 (961) 123-45-67, 8 961 123 45 67…
 * Нормализуется к E.164 (+7XXXXXXXXXX) через normalizePhone из @agromoll/types.
 */
export const PhoneSchema = z
  .string()
  .trim()
  .min(10, 'Телефон слишком короткий')
  .max(20, 'Телефон слишком длинный')
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (normalized === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Введите российский номер: +7 XXX XXX-XX-XX',
      });
      return z.NEVER;
    }
    return normalized;
  });

/** Запрос SMS-кода: POST /auth/request-code (v0.3.0). */
export const RequestCodeSchema = z.object({
  phone: PhoneSchema,
});

export type RequestCodeInput = z.infer<typeof RequestCodeSchema>;

/**
 * Проверка SMS-кода: POST /auth/verify.
 * 6 цифр в проде; 4 — код-заглушка «0000» в dev (ADR-007).
 */
export const VerifyCodeSchema = z.object({
  phone: PhoneSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{4,6}$/, 'Код — 4–6 цифр'),
});

export type VerifyCodeInput = z.infer<typeof VerifyCodeSchema>;

/** Обновление пары токенов: POST /auth/refresh (ротация, v0.3.1). */
export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Не передан refreshToken'),
});

export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;

/**
 * Выход: POST /auth/logout (v0.3.1). accessToken опционален — если клиент
 * передал, его jti попадает в блэклист на остаток жизни токена.
 */
export const LogoutSchema = z.object({
  refreshToken: z.string().min(1, 'Не передан refreshToken'),
  accessToken: z.string().min(1).optional(),
});

export type LogoutInput = z.infer<typeof LogoutSchema>;

/** Смена роли: PATCH /users/me/role (любая роль на выбор). */
export const UpdateRoleSchema = z
  .object({
    role: UserRoleSchema,
  })
  .strict();

export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>;

// ─── Схемы ответов API (v0.3.0, подэтап C) ─────────────────────────────────
//
// Каждый ответ API валидируется на клиенте перед рендером: защита от
// «старый клиент + новый сервер», багов сериализации и частично от MITM.
// Схемы строгие к типам известных полей, но .passthrough() — лишние поля
// сервера не ломают старый клиент (обратная совместимость).

/** ISO-дата. */
const IsoDateString = z.string().datetime({ offset: true });

/** Ответ GET /listings/:id и POST /listings. */
export const ListingResponseSchema = z
  .object({
    id: z.string().min(1),
    sellerId: z.string().min(1),
    sellerName: z.string().optional(),
    title: z.string().min(1),
    category: ListingCategorySchema,
    unit: ListingUnitSchema,
    /** Decimal от Prisma приходит строкой — точность денег не теряется. */
    pricePerUnit: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Цена ждём строкой вида «85.50»'),
    quantityAvailable: z.number().int().nonnegative(),
    quantityReserved: z.number().int().nonnegative(),
    quantityAvailableForBooking: z.number().int(),
    lineNumber: z.number().int().positive().nullable(),
    isPerishable: z.boolean(),
    status: ListingStatusSchema,
    createdAt: IsoDateString,
    updatedAt: IsoDateString,
  })
  .passthrough();

export type ListingResponse = z.infer<typeof ListingResponseSchema>;

/** Ответ GET /listings (лента, витрина). */
export const ListingsResponseSchema = z.array(ListingResponseSchema);

/** Ответ эндпоинтов броней (создание, отмена, подтверждение, корректировка). */
export const BookingResponseSchema = z
  .object({
    id: z.string().min(1),
    listingId: z.string().min(1),
    listingTitle: z.string().optional(),
    listingUnit: ListingUnitSchema.optional(),
    buyerId: z.string().min(1),
    buyerName: z.string().optional(),
    requestedQuantity: z.number().int().positive(),
    confirmedQuantity: z.number().int().positive().nullable(),
    status: BookingStatusSchema,
    expiresAt: IsoDateString,
    createdAt: IsoDateString,
    updatedAt: IsoDateString,
  })
  .passthrough();

export type BookingResponse = z.infer<typeof BookingResponseSchema>;

/** Ответ GET /bookings (мои брони / входящие). */
export const BookingsResponseSchema = z.array(BookingResponseSchema);

/** Ответ GET /users/me и PATCH /users/me/role. */
export const UserResponseSchema = z
  .object({
    id: z.string().min(1),
    role: UserRoleSchema,
    displayName: z.string().min(1),
    phone: z.string().nullable(),
    phoneVerified: z.boolean(),
    createdAt: IsoDateString,
  })
  .passthrough();

export type UserResponse = z.infer<typeof UserResponseSchema>;

/** Ответ POST /auth/verify: токены + профиль. */
export const AuthResponseSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    user: UserResponseSchema,
  })
  .passthrough();

export type AuthResponse = z.infer<typeof AuthResponseSchema>;

/** Ответ POST /auth/refresh: новая ПАРА токенов (ротация, v0.3.1). */
export const RefreshResponseSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
  })
  .passthrough();

export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

/** Ответ POST /auth/request-code. */
export const RequestCodeResponseSchema = z
  .object({
    expiresInSec: z.number().positive(),
  })
  .passthrough();

/**
 * Форма ошибки API (NestJS ExceptionFilter): message может быть строкой
 * или массивом (ValidationPipe), code — наш доменный код.
 */
export const ErrorResponseSchema = z
  .object({
    statusCode: z.number().optional(),
    message: z.union([z.string(), z.array(z.string())]).optional(),
    code: z.string().optional(),
  })
  .passthrough();

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

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

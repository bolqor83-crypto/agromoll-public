import { z } from 'zod';
import {
  BOOKING_ACTIONS,
  BOOKING_STATUSES,
  DEBT_ACTIONS,
  DEBT_STATUSES,
  LISTING_CATEGORIES,
  LISTING_STATUSES,
  LISTING_UNITS,
  NOTIFICATION_TYPES,
  QUALITY_FLAGS,
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
/** Оценка качества поставки при приёмке (v0.4.0-C, ADR-012). */
export const QualityFlagSchema = z.enum(QUALITY_FLAGS);

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

/**
 * Отмена брони: POST /bookings/:id/cancel (любая сторона).
 *
 * Схема НЕ strict: мобильный outbox шлёт в теле весь payload операции
 * ({ bookingId, reason? }) — bookingId лишний на этом эндпоинте (id в URL),
 * поэтому просто strip-ается. strict-режим здесь ломал бы отмену с реального
 * клиента (400 «Unrecognized key: bookingId»), при этом e2e с «чистым»
 * телом { reason } баг не ловил — тесты ходят напрямую, мимо outbox.
 */
export const CancelBookingSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export type CancelBookingInput = z.infer<typeof CancelBookingSchema>;

/**
 * Подтверждение приёмки: POST /bookings/:id/confirm-delivery (только buyer,
 * v0.4.0-C, ADR-012). НЕ strict по той же причине: outbox шлёт bookingId.
 */
export const ConfirmDeliverySchema = z.object({
  /** Фактически полученное количество. */
  receivedQuantity: z.coerce
    .number()
    .int('Количество — целое число')
    .positive('Количество должно быть положительным')
    .max(1_000_000),
  /** Оценка качества. По умолчанию ok; при недостаче сервер поставит minor. */
  qualityFlag: QualityFlagSchema.optional().default('ok'),
  qualityNotes: z.string().trim().max(500).optional(),
});

export type ConfirmDeliveryInput = z.infer<typeof ConfirmDeliverySchema>;

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

// ─── Долги (v0.4.0, ADR-010) ───────────────────────────────────────────────

export const DebtStatusSchema = z.enum(DEBT_STATUSES);
export const DebtActionSchema = z.enum(DEBT_ACTIONS);
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);

/** Максимальная сумма долга: защита от опечаток (ADR-010). */
export const DEBT_MAX_AMOUNT = 1_000_000;

/**
 * Создание долга: POST /debts (кредитор, любая роль — дать в долг может
 * каждый участник рынка, ADR-010).
 */
export const CreateDebtSchema = z
  .object({
    debtorId: z.string().uuid('Выберите контрагента'),
    /** Сумма в рублях: > 0 и ≤ 1 000 000 (защита от опечаток). */
    amount: z.coerce
      .number()
      .positive('Сумма должна быть положительной')
      .max(DEBT_MAX_AMOUNT, 'Сумма не может превышать 1 000 000 ₽')
      .refine((value) => Math.round(value * 100) === value * 100, {
        message: 'Максимум две цифры после запятой (копейки)',
      }),
    /** В MVP только рубли — единая валюта рынка. */
    currency: z
      .enum(['RUB'], { errorMap: () => ({ message: 'Долги учитываются только в рублях' }) })
      .optional()
      .default('RUB'),
    description: z.string().trim().max(500, 'Описание слишком длинное').optional(),
    listingId: z.string().uuid().optional(),
    bookingId: z.string().uuid().optional(),
  })
  .strict();

export type CreateDebtInput = z.infer<typeof CreateDebtSchema>;

/**
 * Спор по долгу: POST /debts/:id/dispute (любая сторона).
 * Причина опциональна — контекст для журнала DebtEvent.
 * НЕ strict: outbox шлёт { debtId, reason? } — debtId strip-ается
 * (id живёт в URL), см. примечание у CancelBookingSchema.
 */
export const DisputeDebtSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export type DisputeDebtInput = z.infer<typeof DisputeDebtSchema>;

// ─── Учёт часов 289-ФЗ (v0.4.0, ADR-011) ──────────────────────────────────

/** Начало смены: POST /work-hours/sessions (только driver). */
export const StartWorkSessionSchema = z
  .object({
    sellerId: z.string().uuid('Выберите продавца'),
  })
  .strict();

export type StartWorkSessionInput = z.infer<typeof StartWorkSessionSchema>;

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
    confirmedAt: IsoDateString.nullable(),
    deliveryConfirmedAt: IsoDateString.nullable(),
    receivedQuantity: z.number().int().positive().nullable(),
    qualityNotes: z.string().nullable(),
    qualityFlag: QualityFlagSchema,
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
    totalConfirmations: z.number().int().nonnegative(),
    totalDisputes: z.number().int().nonnegative(),
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

/** Ответ эндпоинтов долгов (v0.4.0): Decimal — строкой. */
export const DebtResponseSchema = z
  .object({
    id: z.string().min(1),
    creditorId: z.string().min(1),
    creditorName: z.string().optional(),
    debtorId: z.string().min(1),
    debtorName: z.string().optional(),
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Сумму ждём строкой вида «12500.00»'),
    currency: z.string().min(1),
    description: z.string().nullable(),
    listingId: z.string().nullable(),
    bookingId: z.string().nullable(),
    status: DebtStatusSchema,
    isOverdue: z.boolean(),
    canRemind: z.boolean(),
    nextReminderAt: IsoDateString.nullable(),
    resolveRequestedById: z.string().nullable(),
    createdAt: IsoDateString,
    updatedAt: IsoDateString,
    settledAt: IsoDateString.nullable(),
  })
  .passthrough();

export type DebtResponse = z.infer<typeof DebtResponseSchema>;

/** Ответ GET /debts (мои долги обеих сторон). */
export const DebtsResponseSchema = z.array(DebtResponseSchema);

/** Часть сводки: сумма строкой + счётчики. */
const DebtsSummaryPartSchema = z.object({
  total: z.string().regex(/^\d+(\.\d{1,2})?$/),
  count: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
});

/** Ответ GET /debts/summary (виджет главного экрана). */
export const DebtsSummaryResponseSchema = z
  .object({
    owedToMe: DebtsSummaryPartSchema,
    iOwe: DebtsSummaryPartSchema,
  })
  .passthrough();

export type DebtsSummaryResponse = z.infer<typeof DebtsSummaryResponseSchema>;

/** Ответ GET /debts/counterparties (с кем были сделки). */
export const CounterpartiesResponseSchema = z.array(
  z
    .object({
      id: z.string().min(1),
      displayName: z.string().min(1),
      lastDealAt: IsoDateString,
    })
    .passthrough(),
);

/** Ответ POST /debts/:id/reminder. */
export const ReminderResponseSchema = z
  .object({
    sentAt: IsoDateString,
    nextReminderAt: IsoDateString,
  })
  .passthrough();

export type ReminderResponse = z.infer<typeof ReminderResponseSchema>;

/** Ответ GET /notifications/me (v0.4.0). */
export const NotificationsListResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string().min(1),
          type: NotificationTypeSchema,
          title: z.string().min(1),
          body: z.string().min(1),
          data: z.record(z.unknown()).nullable(),
          readAt: IsoDateString.nullable(),
          createdAt: IsoDateString,
        })
        .passthrough(),
    ),
    unreadCount: z.number().int().nonnegative(),
  })
  .passthrough();

export type NotificationsListResponse = z.infer<typeof NotificationsListResponseSchema>;

/** Ответ эндпоинтов рабочих сессий (v0.4.0, ADR-011). */
export const WorkHoursSessionResponseSchema = z
  .object({
    id: z.string().min(1),
    driverId: z.string().min(1),
    driverName: z.string().min(1),
    sellerId: z.string().min(1),
    sellerName: z.string().min(1),
    startedAt: IsoDateString,
    endedAt: IsoDateString.nullable(),
    durationMinutes: z.number().int().positive().nullable(),
    month: z.string().regex(/^\d{4}-\d{2}$/, 'Месяц в формате YYYY-MM'),
  })
  .passthrough();

export type WorkHoursSessionResponse = z.infer<typeof WorkHoursSessionResponseSchema>;

/** Ответ GET /work-hours/me — пары текущего месяца. */
export const WorkHoursPairsResponseSchema = z.array(
  z
    .object({
      counterpartId: z.string().min(1),
      counterpartName: z.string().min(1),
      month: z.string().regex(/^\d{4}-\d{2}$/),
      totalMinutes: z.number().int().nonnegative(),
      monthCounted: z.boolean(),
      series: z.number().int().nonnegative(),
      blocked: z.boolean(),
      activeSessionId: z.string().nullable(),
    })
    .passthrough(),
);

/** Ответ GET /work-hours/check/:driverId/:sellerId. */
export const WorkHoursCheckResponseSchema = z
  .object({
    driverId: z.string().min(1),
    sellerId: z.string().min(1),
    blocked: z.boolean(),
    reason: z.string().nullable(),
    unblockAt: IsoDateString.nullable(),
    totalMinutesCurrent: z.number().int().nonnegative(),
    monthCounted: z.boolean(),
    series: z.number().int().nonnegative(),
  })
  .passthrough();

export type WorkHoursCheckResponse = z.infer<typeof WorkHoursCheckResponseSchema>;

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
  /** Кулдаун напоминаний о долге в часах (ADR-010). */
  DEBT_REMINDER_COOLDOWN_HOURS: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 7)
    .default(24),
  /** Лимит часов в месяц на пару «водитель — продавец» (ADR-011). */
  WORK_HOURS_MONTHLY_LIMIT: z.coerce.number().int().positive().max(200).default(60),
  /** Месяцев подряд с ≥лимитом до блокировки пары (ADR-011). */
  WORK_MONTHS_SERIES: z.coerce.number().int().positive().max(24).default(6),
  /** Окно авто-подтверждения приёмки в часах (ADR-012). */
  BOOKING_AUTO_CONFIRM_HOURS: z.coerce.number().int().positive().max(24 * 30).default(24),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

import { z } from 'zod';
import {
  APPEAL_DECISIONS,
  APPEAL_STATUSES,
  BOOKING_ACTIONS,
  DELIVERY_STATUSES,
  BOOKING_STATUSES,
  DEBT_ACTIONS,
  DEBT_STATUSES,
  DEVICE_PLATFORMS,
  DISPUTE_BOOKING_OUTCOMES,
  DISPUTE_DEBT_OUTCOMES,
  DISPUTE_DELIVERY_OUTCOMES,
  DISPUTE_OUTCOMES,
  DISPUTE_RESOLUTIONS,
  DISPUTE_STATUSES,
  DISPUTE_TYPES,
  LISTING_CATEGORIES,
  LISTING_STATUSES,
  LISTING_UNITS,
  MARKET_ROLES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  GEO_POINT_KINDS,
  GEO_VEHICLE_TYPES,
  QUALITY_FLAGS,
  REPUTATION_ACTIONS,
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

// ─── Фото товаров (v0.7.0-D, ADR-038) ─────────────────────────────────

/** Максимум фото на лот: карусель в деталях + обложка в карточке.
 *  Больше пяти — покупатель всё равно не листает (торговая практика). */
export const LISTING_MAX_PHOTOS = 5;

/** Разрешённые типы фото товара: только изображения — это витрина,
 *  а не арбитраж (pdf остался доказательствам, ADR-036). */
export const LISTING_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ListingPhotoMimeType = (typeof LISTING_PHOTO_MIME_TYPES)[number];

/** Максимум фото в хранилище (presigned-путь): с запасом на камеры 4:3. */
export const LISTING_PHOTO_S3_MAX_BYTES = 10 * 1024 * 1024;

/** Максимум fallback-фото (data:-URL в БД): 500 КБ ДО base64 —
 *  тот же лимит, что у доказательств (ADR-036): БД не пухнет. */
export const LISTING_PHOTO_FALLBACK_MAX_BYTES = 500 * 1024;

/** Максимальная длина base64-хвоста в data:-URL для 500 КБ (с padding). */
const LISTING_PHOTO_FALLBACK_MAX_BASE64_LENGTH = Math.ceil(
  (LISTING_PHOTO_FALLBACK_MAX_BYTES / 3) * 4 + 4,
);

/**
 * Запрос presigned URL: POST /listings/:id/photos/upload-url (только
 * владелец лота). Клиент объявляет тип и размер заранее — лимиты
 * проверяются до подписания ссылки.
 */
export const ListingPhotoUploadUrlSchema = z
  .object({
    mimeType: z.enum(LISTING_PHOTO_MIME_TYPES),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(LISTING_PHOTO_S3_MAX_BYTES, 'Файл больше 10 МБ'),
  })
  .strict();

export type ListingPhotoUploadUrlInput = z.infer<typeof ListingPhotoUploadUrlSchema>;

/**
 * Приложить фото: POST /listings/:id/photos (только владелец).
 *
 * Дискриминатор storage — как у доказательств (ADR-036):
 *  - 's3'  — клиент загрузил файл по presigned URL, подтверждает
 *            objectKey (сервис сверит с HEAD объекта);
 *  - 'data' — fallback ≤ 500 КБ, когда хранилище не настроено.
 */
export const AttachListingPhotoSchema = z.discriminatedUnion('storage', [
  z
    .object({
      storage: z.literal('s3'),
      /** Ключ, выданный POST /listings/:id/photos/upload-url. */
      objectKey: z
        .string()
        .regex(
          /^listings\/[0-9a-f-]{36}\/[\w.-]+$/,
          'objectKey выдан эндпоинтом upload-url',
        ),
      fileName: z.string().trim().min(1).max(255),
      mimeType: z.enum(LISTING_PHOTO_MIME_TYPES),
      sizeBytes: z.number().int().positive().max(LISTING_PHOTO_S3_MAX_BYTES),
    })
    .strict(),
  z
    .object({
      storage: z.literal('data'),
      fileName: z.string().trim().min(1).max(255),
      mimeType: z.enum(LISTING_PHOTO_MIME_TYPES),
      /** data:<mime>;base64,<payload>; лимит — до декодирования 500 КБ. */
      dataUrl: z
        .string()
        .regex(
          /^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/,
          'dataUrl вида data:image/jpeg;base64,…',
        )
        .max(
          LISTING_PHOTO_FALLBACK_MAX_BASE64_LENGTH + 64,
          'Файл больше 500 КБ — fallback только для маленьких фото, используйте хранилище',
        ),
    })
    .strict(),
]);

export type AttachListingPhotoInput = z.infer<typeof AttachListingPhotoSchema>;

/** Фото товара в DTO ответа: позиция + ссылка для показа. */
export const ListingPhotoResponseSchema = z.object({
  id: z.string().min(1),
  /** Порядок в карусели 0..4; обложка — position 0. */
  position: z.number().int().nonnegative(),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  /** Presigned GET (живёт часы) или data:-URL (fallback). */
  url: z.string().min(1),
});

export type ListingPhotoResponse = z.infer<typeof ListingPhotoResponseSchema>;

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

/** Смена роли: PATCH /users/me/role (рыночные роли на выбор).
 *
 * arbitrator недоступен для самоназначения (ADR-033): арбитра назначают
 * вручную — иначе любой мог бы «рассмотреть» собственный спор.
 */
export const UpdateRoleSchema = z
  .object({
    role: z.enum(MARKET_ROLES),
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

/** Сводка рейтинга для бейджа на карточках (v0.5.0, ADR-013).
 *  null/отсутствует — рейтинга нет (порог не достигнут или старый сервер). */
export const RatingSummarySchema = z
  .object({
    score: z.number().min(0).max(5),
    dealsCount: z.number().int().nonnegative(),
  })
  .passthrough();

export type RatingSummary = z.infer<typeof RatingSummarySchema>;

/** Ответ GET /listings/:id и POST /listings. */
export const ListingResponseSchema = z
  .object({
    id: z.string().min(1),
    sellerId: z.string().min(1),
    sellerName: z.string().optional(),
    sellerRating: RatingSummarySchema.nullable().optional(),
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
    /** Обложка (первое фото, v0.7.0-D): presigned GET / data:-URL /
     *  null — фото нет, карточка покажет иконку категории. Заполняется
     *  в списках (лента/витрина) — карточке одного фото достаточно. */
    coverUrl: z.string().nullable().optional(),
    /** Все фото с ссылками — только в деталях (GET /listings/:id):
     *  тащить пятерку ссылок в каждый элемент ленты незачем. */
    photos: z.array(ListingPhotoResponseSchema).optional(),
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
    sellerRating: RatingSummarySchema.nullable().optional(),
    buyerRating: RatingSummarySchema.nullable().optional(),
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
    creditorRating: RatingSummarySchema.nullable().optional(),
    debtorRating: RatingSummarySchema.nullable().optional(),
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

// ─── Публичный рейтинг (v0.5.0, ADR-013) ──────────────────────────────

/** Действие журнала рейтинга. */
export const ReputationActionSchema = z.enum(REPUTATION_ACTIONS);

/** Строка журнала рейтинга в ответах API. */
export const ReputationEventSchema = z
  .object({
    id: z.string().min(1),
    action: ReputationActionSchema,
    delta: z.number(),
    reason: z.string().nullable(),
    createdAt: IsoDateString,
  })
  .passthrough();

export type ReputationEventResponse = z.infer<typeof ReputationEventSchema>;

/** Ответ GET /reputation/:userId — публичный профиль рейтинга. */
export const ReputationResponseSchema = z
  .object({
    userId: z.string().min(1),
    score: z.number().min(0).max(5).nullable(),
    reason: z.literal('min_deals_not_reached').optional(),
    dealsCount: z.number().int().nonnegative(),
    disputesCount: z.number().int().nonnegative(),
    autoConfirmedCount: z.number().int().nonnegative(),
    lastCalculatedAt: IsoDateString.nullable(),
  })
  .passthrough();

export type ReputationResponse = z.infer<typeof ReputationResponseSchema>;

/** Ответ GET /reputation/me — мой рейтинг + история событий. */
export const MyReputationResponseSchema = ReputationResponseSchema.extend({
  dealsToRating: z.number().int().nonnegative(),
  events: z.array(ReputationEventSchema),
});

export type MyReputationResponse = z.infer<typeof MyReputationResponseSchema>;

// ─── Геозоны (v0.5.0, ADR-014) ──────────────────────────────────────────────

/** Вид геозоны. */
export const GeoPointKindSchema = z.enum(GEO_POINT_KINDS);

/** Тип транспорта коридора. */
export const GeoVehicleTypeSchema = z.enum(GEO_VEHICLE_TYPES);

/** Координата {lat, lng}. */
export const GeoCoordSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();

/** Радиус поиска: 10 м…5 км (спецификация v0.5.0-B). */
export const GEO_RADIUS_METERS = z
  .number()
  .int('Радиус — целое число метров')
  .min(10, 'Радиус не меньше 10 м')
  .max(5000, 'Радиус не больше 5000 м');

/** Ответ эндпоинтов геозон. */
export const GeoPointResponseSchema = z
  .object({
    id: z.string().min(1),
    ownerId: z.string().min(1),
    kind: GeoPointKindSchema,
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    address: z.string().nullable(),
    label: z.string().nullable(),
    radiusMeters: z.number().int().positive(),
    isActive: z.boolean(),
    corridorFrom: GeoCoordSchema.nullable(),
    corridorTo: GeoCoordSchema.nullable(),
    vehicleType: GeoVehicleTypeSchema,
    maxWeightKg: z.number().int().positive().nullable(),
    isRefrigerated: z.boolean(),
    createdAt: IsoDateString,
    updatedAt: IsoDateString,
    distanceMeters: z.number().nonnegative().optional(),
  })
  .passthrough();

export type GeoPointResponse = z.infer<typeof GeoPointResponseSchema>;

/** Ответ GET /geo/points/nearby и GET /geo/points/mine. */
export const GeoPointsResponseSchema = z.array(GeoPointResponseSchema);

/** Тело POST /geo/points — точка покупателя или линия продавца. */
export const CreateGeoPointSchema = z
  .object({
    kind: z.enum(['buyer_point', 'seller_line'], {
      errorMap: () => ({
        message: 'Здесь только buyer_point или seller_line; коридоры — POST /geo/corridors',
      }),
    }),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    address: z.string().trim().max(300).optional(),
    label: z.string().trim().max(100).optional(),
    radiusMeters: GEO_RADIUS_METERS.optional().default(50),
  })
  .strict();

export type CreateGeoPointInput = z.infer<typeof CreateGeoPointSchema>;

/** Тело POST /geo/corridors — маршрут доставщика (ADR-014). */
export const CreateGeoCorridorSchema = z
  .object({
    corridorFrom: GeoCoordSchema,
    corridorTo: GeoCoordSchema,
    vehicleType: GeoVehicleTypeSchema.optional().default('car'),
    maxWeightKg: z.number().int().positive().max(20000).optional(),
    isRefrigerated: z.boolean().optional().default(false),
    address: z.string().trim().max(300).optional(),
    label: z.string().trim().max(100).optional(),
  })
  .strict();

export type CreateGeoCorridorInput = z.infer<typeof CreateGeoCorridorSchema>;

/** Тело PATCH /geo/points/:id — только владелец, без смены вида. */
export const UpdateGeoPointSchema = z
  .object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    address: z.string().trim().max(300).optional(),
    label: z.string().trim().max(100).optional(),
    radiusMeters: GEO_RADIUS_METERS.optional(),
  })
  .strict();

export type UpdateGeoPointInput = z.infer<typeof UpdateGeoPointSchema>;

/** Query GET /geo/points/nearby и /geo/corridors/nearby: lat, lng, radiusMeters.
 *  Параметры URL приходят строками — отсюда z.coerce. */
export const GeoNearbyQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusMeters: z.coerce
      .number()
      .int('Радиус — целое число метров')
      .min(10, 'Радиус не меньше 10 м')
      .max(5000, 'Радиус не больше 5000 м')
      .optional(),
    kind: z.enum(['buyer_point', 'seller_line']).optional(),
  })
  .strict();

export type GeoNearbyQuery = z.infer<typeof GeoNearbyQuerySchema>;

// ─── Доставка попутчиками (v0.5.0, ADR-015) ─────────────────────────────────

/** Статус доставки. */
export const DeliveryStatusSchema = z.enum(DELIVERY_STATUSES);

/** Точка маршрута в ответах API. */
const DeliveryPointSchema = z
  .object({
    id: z.string().min(1),
    ownerId: z.string().min(1),
    ownerName: z.string().min(1),
    label: z.string().nullable(),
    address: z.string().nullable(),
    latitude: z.number(),
    longitude: z.number(),
  })
  .passthrough();

/** Ответ эндпоинтов доставки. */
export const DeliveryResponseSchema = z
  .object({
    id: z.string().min(1),
    buyerId: z.string().min(1),
    buyerName: z.string().min(1),
    bookingId: z.string().nullable(),
    pickup: DeliveryPointSchema,
    dropoff: DeliveryPointSchema,
    weightKg: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Вес ждём строкой вида «12.50»'),
    description: z.string().nullable(),
    status: DeliveryStatusSchema,
    assignedDriverId: z.string().nullable(),
    assignedDriverName: z.string().nullable(),
    assignedAt: IsoDateString.nullable(),
    deliveredAt: IsoDateString.nullable(),
    expiresAt: IsoDateString,
    createdAt: IsoDateString,
    updatedAt: IsoDateString,
    pickupCode: z.string().nullable(),
    dropoffCode: z.string().nullable(),
    corridorDistanceMeters: z.number().nonnegative().nullable(),
  })
  .passthrough();

export type DeliveryResponse = z.infer<typeof DeliveryResponseSchema>;

/** Ответ GET /deliveries (лента радара / мои). */
export const DeliveriesResponseSchema = z.array(DeliveryResponseSchema);

/** Максимальный вес заказа: вместимость «Газели» с запасом (ADR-015). */
export const DELIVERY_MAX_WEIGHT_KG = 20000;

/** Тело POST /deliveries — покупатель просит подвезти (ADR-015). */
export const CreateDeliverySchema = z
  .object({
    /** Откуда забрать: линия продавца (geo point id). */
    pickupPointId: z.string().uuid('Выберите точку забора'),
    /** Куда привезти: точка покупателя (geo point id). */
    dropoffPointId: z.string().uuid('Выберите точку доставки'),
    weightKg: z.coerce
      .number()
      .positive('Вес должен быть положительным')
      .max(DELIVERY_MAX_WEIGHT_KG, 'Максимум 20 000 кг — это уже не попутная доставка')
      .refine((value) => Math.round(value * 100) === value * 100, {
        message: 'Максимум две цифры после запятой',
      }),
    description: z.string().trim().max(500).optional(),
    /** Доставка по конкретной брони (опционально). */
    bookingId: z.string().uuid().optional(),
  })
  .strict();

export type CreateDeliveryInput = z.infer<typeof CreateDeliverySchema>;

/** Тело POST /deliveries/:id/cancel — причина обязательна после старта. */
export const CancelDeliverySchema = z
  .object({
    reason: z.string().trim().max(300).optional(),
  })
  .strict();

export type CancelDeliveryInput = z.infer<typeof CancelDeliverySchema>;

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

// ─── Push-уведомления (v0.6.0-A, ADR-031) ───────────────────────────────────

/** Платформа устройства push. */
export const DevicePlatformSchema = z.enum(DEVICE_PLATFORMS);

/**
 * POST /notifications/register — регистрация push-канала (идемпотентна).
 *
 * Дискриминированное объединение по platform: native (ios/android)
 * регистрирует FCM-токен, web — подписку Web Push (endpoint + ключи
 * шифрования RFC 8291). Сервер делает upsert по token/endpoint.
 */
export const RegisterPushSchema = z.discriminatedUnion('platform', [
  z
    .object({
      platform: z.enum(['ios', 'android']),
      /** FCM/Expo-токен устройства (непустая строка). */
      token: z.string().trim().min(16, 'Токен устройства слишком короткий').max(4096),
    })
    .strict(),
  z
    .object({
      platform: z.literal('web'),
      /** URL Push-сервиса браузера. */
      endpoint: z.string().trim().url('endpoint должен быть URL').max(2048),
      /** Клиентский открытый ключ (base64url, RFC 8291). */
      p256dh: z.string().trim().min(16).max(512),
      /** Секрет аутентификации (base64url, RFC 8291). */
      auth: z.string().trim().min(8).max(512),
    })
    .strict(),
]);

export type RegisterPushInput = z.infer<typeof RegisterPushSchema>;

/**
 * DELETE /notifications/unregister — снятие регистрации при logout.
 * Тело — что снимать: FCM-токен или endpoint веб-подписки.
 */
export const UnregisterPushSchema = z
  .object({
    token: z.string().trim().min(16).max(4096).optional(),
    endpoint: z.string().trim().url().max(2048).optional(),
  })
  .refine((v) => Boolean(v.token ?? v.endpoint), {
    message: 'Укажите token или endpoint',
  });

export type UnregisterPushInput = z.infer<typeof UnregisterPushSchema>;

/** Ответ POST /notifications/register и DELETE /notifications/unregister. */
export const PushRegistrationResponseSchema = z.object({ registered: z.boolean() });

/** Строка журнала push-доставок. */
const NotificationLogItemSchema = z
  .object({
    id: z.string().min(1),
    channel: z.enum(NOTIFICATION_CHANNELS),
    title: z.string().min(1),
    body: z.string().min(1),
    status: z.enum(['sent', 'failed', 'delivered']),
    error: z.string().nullable(),
    createdAt: IsoDateString,
  })
  .passthrough();

/** Ответ GET /notifications/log — история push-доставок (только свои). */
export const NotificationLogResponseSchema = z
  .object({ items: z.array(NotificationLogItemSchema) })
  .passthrough();

/** Ответ GET /notifications/vapid-public. */
export const VapidPublicKeyResponseSchema = z.object({ publicKey: z.string().nullable() });

// ─── Арбитраж споров (v0.6.0-C, ADR-033) ───────────────────────────────────

/** Тип спорного объекта. */
export const DisputeTypeSchema = z.enum(DISPUTE_TYPES);

/** Итог решения арбитра (resolve): решение по существу или dismiss. */
export const DisputeOutcomeSchema = z.enum(DISPUTE_OUTCOMES);

/** Максимальный размер fallback-доказательства (data:-URL в БД): 500 КБ
 * ДО base64 — защита БД от распухания, S3-путь без такого лимита (ADR-036). */
export const DISPUTE_EVIDENCE_FALLBACK_MAX_BYTES = 500 * 1024;

/** Максимальная длина base64-хвоста в data:-URL для 500 КБ (с запасом на padding). */
const DISPUTE_EVIDENCE_FALLBACK_MAX_BASE64_LENGTH = Math.ceil(
  (DISPUTE_EVIDENCE_FALLBACK_MAX_BYTES / 3) * 4 + 4,
);

/** Максимальный размер файла в S3-хранилище (presigned-путь). */
export const DISPUTE_EVIDENCE_S3_MAX_BYTES = 10 * 1024 * 1024;

/** Разрешённые типы доказательств: фото и сканы накладных (ADR-036). */
export const DISPUTE_EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

/**
 * Открыть спор: POST /disputes.
 *
 * reason — суть претензии; попадает первым сообщением в переписку кейса
 * и виден арбитру в очереди. Проверка «пользователь — сторона объекта»
 * — в сервисе (по типу объекта), здесь только форма.
 */
export const OpenDisputeSchema = z
  .object({
    type: DisputeTypeSchema,
    referenceId: z.string().uuid('referenceId должен быть UUID'),
    reason: z.string().trim().min(10, 'Опишите суть спора (минимум 10 символов)').max(2000),
  })
  .strict();

export type OpenDisputeInput = z.infer<typeof OpenDisputeSchema>;

/** Сообщение в кейсе: POST /disputes/:id/messages. */
export const DisputeMessageSchema = z
  .object({
    body: z.string().trim().min(1, 'Сообщение не может быть пустым').max(2000),
    /** Служебная заметка — только арбитру (проверка роли в сервисе). */
    isInternal: z.boolean().optional().default(false),
  })
  .strict();

export type DisputeMessageInput = z.infer<typeof DisputeMessageSchema>;

/**
 * Доказательство: POST /disputes/:id/evidence (v0.7.0-B, ADR-036).
 *
 * Два пути, явный дискриминатор storage:
 *  - 's3'  — клиент уже загрузил файл по presigned URL; подтверждает
 *            objectKey (выданный эндпоинтом upload-url), MIME и размер
 *            (сервис сверит с HEAD объекта в хранилище);
 *  - 'data' — fallback: data:-URL (data:image/jpeg;base64,…), ≤ 500 КБ
 *            декодированного размера; для критических случаев, когда
 *            хранилище недоступно.
 */
export const DisputeEvidenceSchema = z.discriminatedUnion('storage', [
  z
    .object({
      storage: z.literal('s3'),
      /** Ключ, выданный POST /disputes/:id/evidence/upload-url. */
      objectKey: z
        .string()
        .regex(/^disputes\/[0-9a-f-]{36}\/[\w.-]+$/, 'objectKey выдан эндпоинтом upload-url'),
      fileName: z.string().trim().min(1).max(255),
      mimeType: z.enum(DISPUTE_EVIDENCE_MIME_TYPES),
      sizeBytes: z.number().int().positive().max(DISPUTE_EVIDENCE_S3_MAX_BYTES),
    })
    .strict(),
  z
    .object({
      storage: z.literal('data'),
      fileName: z.string().trim().min(1).max(255),
      mimeType: z.enum(DISPUTE_EVIDENCE_MIME_TYPES),
      /**
       * data:<mime>;base64,<payload>. Формат и лимит — здесь; сверку MIME
       * из dataUrl с полем mimeType делает сервис (полевая refine не видит
       * соседей, а обёртка объекта ломает discriminatedUnion).
       */
      dataUrl: z
        .string()
        .regex(/^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/, 'dataUrl вида data:image/jpeg;base64,…')
        .max(
          DISPUTE_EVIDENCE_FALLBACK_MAX_BASE64_LENGTH + 64,
          'Файл больше 500 КБ — fallback только для маленьких файлов, используйте хранилище',
        ),
    })
    .strict(),
]);

export type DisputeEvidenceInput = z.infer<typeof DisputeEvidenceSchema>;

/**
 * Запрос presigned URL: POST /disputes/:id/evidence/upload-url.
 *
 * Клиент объявляет тип и размер ЗАРАНЕЕ: сервис проверяет лимиты до
 * выдачи ссылки (зачем подписывать ссылку на 100 МБ) и подбирает
 * расширение object key.
 */
export const DisputeEvidenceUploadUrlSchema = z
  .object({
    mimeType: z.enum(DISPUTE_EVIDENCE_MIME_TYPES),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(DISPUTE_EVIDENCE_S3_MAX_BYTES, 'Файл больше 10 МБ'),
  })
  .strict();

export type DisputeEvidenceUploadUrlInput = z.infer<typeof DisputeEvidenceUploadUrlSchema>;

/**
 * Решение арбитра: POST /disputes/:id/resolve.
 *
 * bookingOutcome/debtOutcome обязательны ДЛЯ СООТВЕТСТВУЮЩЕГО типа кейса
 * (кроме no_fault/dismiss — объект размораживается без наших вмешательств);
 * перекрёстные поля (bookingOutcome в долговом споре) — ошибка схемы.
 */
export const ResolveDisputeSchema = z
  .object({
    outcome: DisputeOutcomeSchema,
    notes: z.string().trim().max(2000).optional(),
    /** Судьба брони (кейс type=booking). */
    bookingOutcome: z.enum(DISPUTE_BOOKING_OUTCOMES).optional(),
    /** Судьба долга (кейс type=debt). */
    debtOutcome: z.enum(DISPUTE_DEBT_OUTCOMES).optional(),
    /** Новая сумма долга: обязательна при debtOutcome=settle_adjusted. */
    adjustedAmount: z.number().positive().max(1_000_000).optional(),
    /** Судьба доставки (кейс type=delivery): none — оставить сторонам. */
    deliveryOutcome: z.enum(DISPUTE_DELIVERY_OUTCOMES).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const isFinal = value.outcome !== 'no_fault' && value.outcome !== 'dismiss';
    if (!isFinal) {
      // Вины нет / кейс отклонён — судьбу объекта решают сами стороны.
      for (const key of [
        'bookingOutcome',
        'debtOutcome',
        'adjustedAmount',
        'deliveryOutcome',
      ] as const) {
        if (value[key] !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'При no_fault/dismiss судьба объекта не указывается',
          });
        }
      }
      return;
    }
    if (value.bookingOutcome !== undefined && value.debtOutcome !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bookingOutcome'],
        message: 'Укажите bookingOutcome ИЛИ debtOutcome, не оба',
      });
    }
    if (value.debtOutcome === 'settle_adjusted' && value.adjustedAmount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['adjustedAmount'],
        message: 'При settle_adjusted укажите новую сумму долга',
      });
    }
    if (value.debtOutcome !== 'settle_adjusted' && value.adjustedAmount !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['adjustedAmount'],
        message: 'adjustedAmount допустим только при settle_adjusted',
      });
    }
  });

export type ResolveDisputeInput = z.infer<typeof ResolveDisputeSchema>;

// ─── Ответы API арбитража (v0.6.0-C, ADR-033) ──────────────────────────────

/** Участник кейса в DTO. */
export const DisputePartyResponseSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  role: UserRoleSchema,
});

/** Сообщение кейса в DTO (isInternal уже отфильтрованы для не-арбитра). */
export const DisputeMessageResponseSchema = z.object({
  id: z.string().min(1),
  author: DisputePartyResponseSchema,
  body: z.string().min(1),
  isInternal: z.boolean(),
  createdAt: IsoDateString,
});

/** Доказательство в DTO — только метаданные. */
export const DisputeEvidenceResponseSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  uploadedBy: DisputePartyResponseSchema,
  createdAt: IsoDateString,
});

/** Ответ POST /disputes/:id/evidence/upload-url (v0.7.0-B, ADR-036). */
export const DisputeEvidenceUploadUrlResponseSchema = z.object({
  objectKey: z.string().min(1),
  uploadUrl: z.string().url(),
  /** Срок жизни ссылки, секунды. */
  expiresIn: z.number().int().positive(),
});

/** Элемент GET /disputes/:id/evidence: метаданные + ссылка для просмотра. */
export const DisputeEvidenceItemResponseSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  uploadedBy: DisputePartyResponseSchema,
  createdAt: IsoDateString,
  /** Presigned GET (живёт часы) или data:-URL (fallback). */
  url: z.string().min(1),
});

/** Ответ GET /disputes/:id/evidence. */
export const DisputeEvidenceListResponseSchema = z.object({
  items: z.array(DisputeEvidenceItemResponseSchema),
});

/** Кейс арбитража в DTO (список). */
export const DisputeResponseSchema = z.object({
  id: z.string().min(1),
  type: DisputeTypeSchema,
  referenceId: z.string().min(1),
  subject: z.string().min(1),
  status: z.enum(DISPUTE_STATUSES),
  firstParty: DisputePartyResponseSchema,
  secondParty: DisputePartyResponseSchema,
  openedBy: DisputePartyResponseSchema,
  openedAt: IsoDateString,
  assignedTo: DisputePartyResponseSchema.nullable(),
  assignedAt: IsoDateString.nullable(),
  resolution: z.enum(DISPUTE_RESOLUTIONS).nullable(),
  resolvedAt: IsoDateString.nullable(),
  notes: z.string().nullable(),
  messagesCount: z.number().int().nonnegative(),
  evidenceCount: z.number().int().nonnegative(),
});

/** Кейс с перепиской (GET /disputes/:id). */
export const DisputeDetailResponseSchema = DisputeResponseSchema.extend({
  messages: z.array(DisputeMessageResponseSchema),
  evidence: z.array(DisputeEvidenceResponseSchema),
});

/** Ответ GET /disputes и GET /disputes/queue. */
export const DisputesListResponseSchema = z
  .object({ items: z.array(DisputeResponseSchema) })
  .passthrough();

// ─── Апелляции на блокировки 289-ФЗ (v0.6.0-E, ADR-035) ────────────────────

/** Решение арбитра по апелляции (resolve). */
export const AppealDecisionSchema = z.enum(APPEAL_DECISIONS);

/**
 * Открыть апелляцию: POST /appeals.
 *
 * blockedPairId — активная блокировка пары (id приходит в строке пары
 * «Мои часы»); reason — почему блокировка ошибочна. Проверка «пользователь
 * — сторона пары» в сервисе, здесь только форма.
 */
export const OpenAppealSchema = z
  .object({
    blockedPairId: z.string().uuid('blockedPairId должен быть UUID'),
    reason: z.string().trim().min(10, 'Опишите суть апелляции (минимум 10 символов)').max(2000),
  })
  .strict();

export type OpenAppealInput = z.infer<typeof OpenAppealSchema>;

/**
 * Сообщение в переписке апелляции: POST /appeals/:id/messages
 * (v0.7.0-C, ADR-037). Форма — как DisputeMessageSchema: isInternal
 * — только арбитру (проверка роли в сервисе).
 */
export const AppealMessageSchema = z
  .object({
    body: z.string().trim().min(1, 'Сообщение не может быть пустым').max(2000),
    /** Служебная заметка — только арбитру (проверка роли в сервисе). */
    isInternal: z.boolean().optional().default(false),
  })
  .strict();

export type AppealMessageInput = z.infer<typeof AppealMessageSchema>;

/**
 * Решение по апелляции: POST /appeals/:id/resolve.
 *
 * unblock — блокировка снимается в той же транзакции, reject — остаётся.
 * notes — публичное обоснование (для сторон пары).
 */
export const ResolveAppealSchema = z
  .object({
    decision: AppealDecisionSchema,
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

export type ResolveAppealInput = z.infer<typeof ResolveAppealSchema>;

/** Апелляция в DTO (список). */
export const AppealResponseSchema = z.object({
  id: z.string().min(1),
  blockedPairId: z.string().min(1),
  driver: DisputePartyResponseSchema,
  seller: DisputePartyResponseSchema,
  appellant: DisputePartyResponseSchema,
  reason: z.string().min(1),
  status: z.enum(APPEAL_STATUSES),
  openedAt: IsoDateString,
  assignedTo: DisputePartyResponseSchema.nullable(),
  assignedAt: IsoDateString.nullable(),
  resolvedAt: IsoDateString.nullable(),
  notes: z.string().nullable(),
});

/** Сообщение переписки апелляции в DTO (v0.7.0-C, ADR-037). */
export const AppealMessageResponseSchema = z.object({
  id: z.string().min(1),
  author: DisputePartyResponseSchema,
  body: z.string().min(1),
  isInternal: z.boolean(),
  createdAt: IsoDateString,
});

export const AppealDetailResponseSchema = AppealResponseSchema.extend({
  months: z.array(
    z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      totalMinutes: z.number().int().nonnegative(),
      monthCounted: z.boolean(),
    }),
  ),
  /** Переписка кейса (ADR-037): служебные скрыты от пары на сервере. */
  messages: z.array(AppealMessageResponseSchema),
});

/** Ответ GET /appeals/:id/messages (v0.7.0-C, ADR-037). */
export const AppealMessagesListResponseSchema = z
  .object({ items: z.array(AppealMessageResponseSchema) })
  .passthrough();

/** Ответ GET /appeals/mine и GET /appeals/queue. */
export const AppealsListResponseSchema = z
  .object({ items: z.array(AppealResponseSchema) })
  .passthrough();

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
      // v0.6.0-E (ADR-035): активная блокировка и её апелляция.
      blockedPairId: z.string().nullable(),
      appeal: z.object({ id: z.string().min(1), status: z.enum(APPEAL_STATUSES) }).nullable(),
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
  BOOKING_AUTO_CONFIRM_HOURS: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 30)
    .default(24),
  /** Публичный рейтинг (ADR-013): минимум взвешенных событий для score. */
  RATING_MIN_DEALS: z.coerce.number().int().positive().max(1000).default(5),
  /** Анти-накрутка (ADR-013): сделок пары в окне, выше — вес 0.3. */
  RATING_MAX_PAIR_DEALS: z.coerce.number().int().positive().max(10_000).default(10),
  /** Окно анти-накрутки в днях. */
  RATING_PAIR_WINDOW_DAYS: z.coerce.number().int().positive().max(365).default(30),
  /** Радиус поиска «рядом» по умолчанию в метрах (ADR-014). */
  DEFAULT_GEO_RADIUS_METERS: z.coerce.number().int().min(10).max(5000).default(2000),
  /** TTL открытого запроса доставки в минутах (ADR-015). */
  DELIVERY_TTL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 60)
    .default(60),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

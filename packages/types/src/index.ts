/**
 * Общие типы домена «АгроМолл».
 *
 * Пакет намеренно без зависимостей: его импортируют и api (NestJS),
 * и mobile (Expo), поэтому здесь не должно быть платформенно-специфичного кода.
 */

/** Роли участников рынка. */
export const USER_ROLES = ['buyer', 'seller', 'driver'] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * Демо-аккаунты для этапа заглушки auth (X-User-Id, v0.2.0).
 *
 * ID фиксированные: их создаёт сид-скрипт apps/api (pnpm --filter
 * @agromoll/api db:seed), мобильное приложение подставляет их в заголовок
 * X-User-Id. Удаляются вместе с настоящей аутентификацией (JWT).
 */
export const DEMO_ACCOUNTS: Record<UserRole, { id: string; displayName: string }> = {
  buyer: { id: '00000000-0000-4000-8000-000000000001', displayName: 'Ларёк «У Ашота»' },
  seller: { id: '00000000-0000-4000-8000-000000000002', displayName: 'ФХ «Донская долина»' },
  driver: { id: '00000000-0000-4000-8000-000000000003', displayName: 'Газель Next' },
};

/** Человекочитаемые названия ролей — для UI. */
export const ROLE_LABELS: Record<UserRole, string> = {
  buyer: 'Покупатель',
  seller: 'Продавец',
  driver: 'Доставщик',
};

/** Категории товаров. Совпадают с enum ListingCategory в Prisma-схеме. */
export const LISTING_CATEGORIES = ['vegetables', 'fruits', 'grocery', 'snacks', 'other'] as const;

export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

export const LISTING_CATEGORY_LABELS: Record<ListingCategory, string> = {
  vegetables: 'Овощи',
  fruits: 'Фрукты',
  grocery: 'Бакалея',
  snacks: 'Снеки',
  other: 'Другое',
};

/** Единицы измерения товара. Совпадают с enum ListingUnit в Prisma-схеме. */
export const LISTING_UNITS = ['kg', 'box', 'piece'] as const;

export type ListingUnit = (typeof LISTING_UNITS)[number];

export const LISTING_UNIT_LABELS: Record<ListingUnit, string> = {
  kg: 'кг',
  box: 'ящик',
  piece: 'шт',
};

/** Статусы листинга. Совпадают с enum ListingStatus в Prisma-схеме. */
export const LISTING_STATUSES = ['active', 'paused', 'sold_out', 'archived'] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  active: 'Активен',
  paused: 'На паузе',
  sold_out: 'Продано',
  archived: 'В архиве',
};

/** Статусы брони. Совпадают с enum BookingStatus в Prisma-схеме. */
export const BOOKING_STATUSES = [
  'requested',
  'counter_offered',
  'confirmed',
  'cancelled',
  'expired',
  'completed',
  'disputed',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * Человекочитаемые статусы брони для UI.
 * «Уточняется» — продавец предложил корректировку, ждём решения покупателя.
 */
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  requested: 'Запрошено',
  counter_offered: 'Уточняется',
  confirmed: 'Подтверждено',
  cancelled: 'Отменено',
  expired: 'Истекло',
  completed: 'Завершено',
  disputed: 'Спор по приёмке',
};

/** Действия журнала брони. Совпадают с enum BookingAction в Prisma-схеме. */
export const BOOKING_ACTIONS = [
  'created',
  'counter_offered',
  'accepted_counter',
  'confirmed',
  'cancelled',
  'expired',
  'delivery_confirmed',
  'delivery_disputed',
  'system_auto_confirmed',
] as const;

export type BookingAction = (typeof BOOKING_ACTIONS)[number];

/** Оценка качества поставки при приёмке (v0.4.0-C, ADR-012). */
export const QUALITY_FLAGS = ['ok', 'minor_issue', 'major_issue'] as const;

export type QualityFlag = (typeof QUALITY_FLAGS)[number];

export const QUALITY_FLAG_LABELS: Record<QualityFlag, string> = {
  ok: 'Всё в порядке',
  minor_issue: 'Мелкие проблемы',
  major_issue: 'Серьёзная проблема',
};

/**
 * Лот продавца (DTO уровня API, без служебных полей БД).
 * Decimal из Prisma приходит строкой — сохраняем её как есть и парсим в UI.
 */
export interface ListingDto {
  id: string;
  sellerId: string;
  sellerName?: string;
  /** Рейтинг продавца для бейджа на карточке (v0.5.0, ADR-013).
   *  null — рейтинга нет (порог минимальных сделок не достигнут). */
  sellerRating?: RatingSummaryDto | null;
  title: string;
  category: ListingCategory;
  unit: ListingUnit;
  pricePerUnit: string;
  quantityAvailable: number;
  quantityReserved: number;
  /** Свободно к бронированию = quantityAvailable − quantityReserved. */
  quantityAvailableForBooking: number;
  lineNumber: number | null;
  isPerishable: boolean;
  status: ListingStatus;
  createdAt: string;
  updatedAt: string;
}

/** Бронь покупателя (DTO уровня API). */
export interface BookingDto {
  id: string;
  listingId: string;
  listingTitle?: string;
  listingUnit?: ListingUnit;
  buyerId: string;
  buyerName?: string;
  /** Рейтинги сторон для бейджа контрагента (v0.5.0, ADR-013). */
  sellerRating?: RatingSummaryDto | null;
  buyerRating?: RatingSummaryDto | null;
  requestedQuantity: number;
  confirmedQuantity: number | null;
  status: BookingStatus;
  expiresAt: string;
  /** Момент подтверждения брони продавцом (v0.4.0-C). */
  confirmedAt: string | null;
  /** Момент подтверждения приёмки покупателем (v0.4.0-C). */
  deliveryConfirmedAt: string | null;
  /** Фактически полученное количество (v0.4.0-C). */
  receivedQuantity: number | null;
  /** Комментарий качества при приёмке. */
  qualityNotes: string | null;
  /** Оценка качества поставки (ok / minor / major, ADR-012). */
  qualityFlag: QualityFlag;
  createdAt: string;
  updatedAt: string;
}

/** Событие append-only журнала брони (DTO уровня API). */
export interface BookingEventDto {
  id: string;
  bookingId: string;
  actorId: string | null;
  action: BookingAction;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

/** Ответ healthcheck-эндпоинта API (`GET /health`). */
export interface HealthResponse {
  status: 'ok' | 'error';
  service: string;
  /** ISO-дата ответа. */
  timestamp: string;
  /** Аптайм процесса в секундах. */
  uptimeSec: number;
}

/** Публичный профиль пользователя (DTO уровня API, v0.3.0). */
export interface UserDto {
  id: string;
  role: UserRole;
  displayName: string;
  /** E.164: +7XXXXXXXXXX. У старых строк может отсутствовать. */
  phone: string | null;
  /** Прошёл ли подтверждение номера SMS-кодом. */
  phoneVerified: boolean;
  /** Подтверждённых приёмок (репутационный счётчик, v0.4.0-C, ADR-012). */
  totalConfirmations: number;
  /** Споров по качеству (репутационный счётчик, v0.4.0-C). */
  totalDisputes: number;
  createdAt: string;
}

/** Пара JWT-токенов (v0.3.0, ADR-007). */
export interface AuthTokensDto {
  accessToken: string;
  refreshToken: string;
}

/** Ответ POST /auth/verify: токены + профиль. */
export interface AuthResponseDto extends AuthTokensDto {
  user: UserDto;
}

/**
 * Ответ POST /auth/refresh: НОВАЯ пара токенов (ротация, v0.3.1, ADR-008).
 * Старый refresh-токен после успешного refresh помечается использованным:
 * предъявление повторно = признак кражи → отзыв всей семьи.
 */
export type RefreshResponseDto = AuthTokensDto;

/**
 * Нормализация телефона к E.164 (+7XXXXXXXXXX).
 * Принимает +7…, 8…, 7…, с пробелами/скобками/тире.
 * Возвращает null, если нормализовать не удалось (не российский формат).
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    digits = digits.slice(1);
  }
  if (digits.length !== 10) {
    return null;
  }
  return `+7${digits}`;
}

// ─── Долги (v0.4.0, ADR-010) ────────────────────────────────────────────────

/** Статусы долга. Совпадают с enum DebtStatus в Prisma-схеме. */
export const DEBT_STATUSES = ['active', 'settled', 'disputed', 'cancelled'] as const;

export type DebtStatus = (typeof DEBT_STATUSES)[number];

/** Человекочитаемые статусы долга для UI. */
export const DEBT_STATUS_LABELS: Record<DebtStatus, string> = {
  active: 'Активен',
  settled: 'Погашен',
  disputed: 'Спор',
  cancelled: 'Аннулирован',
};

/** Действия журнала долга. Совпадают с enum DebtAction в Prisma-схеме. */
export const DEBT_ACTIONS = [
  'created',
  'settled',
  'disputed',
  'cancelled',
  'reminder_sent',
  'resolve_requested',
  'resolve_confirmed',
] as const;

export type DebtAction = (typeof DEBT_ACTIONS)[number];

/**
 * Порог просрочки долга: активный долг старше 30 дней считается
 * просроченным — янтарный акцент в виджете и карточке (ADR-010).
 */
export const DEBT_OVERDUE_DAYS = 30;

/**
 * Долг (DTO уровня API). Платформа не проводит деньги: запись — только
 * договорённость сторон («товар отпущен в долг», ADR-010).
 */
export interface DebtDto {
  id: string;
  creditorId: string;
  creditorName?: string;
  debtorId: string;
  debtorName?: string;
  /** Рейтинги сторон для бейджа контрагента (v0.5.0, ADR-013). */
  creditorRating?: RatingSummaryDto | null;
  debtorRating?: RatingSummaryDto | null;
  /** Decimal от Prisma приходит строкой — точность денег не теряется. */
  amount: string;
  currency: string;
  description: string | null;
  listingId: string | null;
  bookingId: string | null;
  status: DebtStatus;
  /** Активный долг старше DEBT_OVERDUE_DAYS дней. */
  isOverdue: boolean;
  /** Кулдаун напоминаний (24 ч) прошёл — кредитор может напомнить. */
  canRemind: boolean;
  /** ISO-момент следующего допустимого напоминания; null — можно сразу. */
  nextReminderAt: string | null;
  /** Кто из сторон первым подтвердил разрешение спора (обоюдное, ADR-010). */
  resolveRequestedById: string | null;
  createdAt: string;
  updatedAt: string;
  settledAt: string | null;
}

/** Часть сводки по долгам: сумма (строкой, Decimal) и количество. */
export interface DebtsSummaryPart {
  total: string;
  count: number;
  overdueCount: number;
}

/** Ответ GET /debts/summary — виджет главного экрана. */
export interface DebtsSummaryDto {
  /** Мне должны (я кредитор, активные). */
  owedToMe: DebtsSummaryPart;
  /** Я должен (я дебитор, активные). */
  iOwe: DebtsSummaryPart;
}

/** Контрагент для формы создания долга — с кем уже были сделки. */
export interface CounterpartyDto {
  id: string;
  displayName: string;
  /** ISO-дата последней сделки (брони). */
  lastDealAt: string;
}

/** Ответ POST /debts/:id/reminder. */
export interface ReminderResultDto {
  sentAt: string;
  nextReminderAt: string;
}

// ─── Публичный рейтинг (v0.5.0, ADR-013) ──────────────────────────────

/** Сводка рейтинга для бейджа на карточках («4.7 · 42 сделки»). */
export interface RatingSummaryDto {
  /** 0–5, округление до 0.1. */
  score: number;
  dealsCount: number;
}

/** Действия журнала рейтинга. Совпадают с enum ReputationAction в Prisma-схеме. */
export const REPUTATION_ACTIONS = [
  'deal_confirmed',
  'dispute_opened',
  'dispute_resolved',
  'auto_confirmed',
  'penalty_applied',
] as const;

export type ReputationActionType = (typeof REPUTATION_ACTIONS)[number];

/** Строка журнала рейтинга (DTO уровня API). */
export interface ReputationEventDto {
  id: string;
  action: ReputationActionType;
  /** Вес события: +1.0 / +0.5 / +0.3 / −1.0 / 0. */
  delta: number;
  reason: string | null;
  createdAt: string;
}

/** Ответ GET /reputation/:userId — публичный профиль рейтинга. */
export interface ReputationDto {
  userId: string;
  /** 0–5 или null — данных меньше RATING_MIN_DEALS. */
  score: number | null;
  /** Присутствует только при score=null. */
  reason?: 'min_deals_not_reached';
  dealsCount: number;
  disputesCount: number;
  autoConfirmedCount: number;
  /** ISO-момент последнего пересчёта; null — снимка ещё нет. */
  lastCalculatedAt: string | null;
}

/** Ответ GET /reputation/me — мой рейтинг + история событий. */
export interface MyReputationDto extends ReputationDto {
  /** Сколько взвешенных событий не хватает до появления рейтинга
   *  (0 — рейтинг уже посчитан). Для подсказки «Сделайте ещё N сделок». */
  dealsToRating: number;
  /** Последние 20 событий журнала (таймлайн «Мой рейтинг»). */
  events: ReputationEventDto[];
}


// ─── Геозоны (v0.5.0, ADR-014) ──────────────────────────────────────────────

/** Виды геозон. Совпадают с enum GeoPointKind в Prisma-схеме. */
export const GEO_POINT_KINDS = ['buyer_point', 'seller_line', 'delivery_corridor'] as const;

export type GeoPointKind = (typeof GEO_POINT_KINDS)[number];

export const GEO_POINT_KIND_LABELS: Record<GeoPointKind, string> = {
  buyer_point: 'Точка покупателя',
  seller_line: 'Линия продавца',
  delivery_corridor: 'Коридор доставщика',
};

/** Тип транспорта коридора. Совпадает с enum GeoVehicleType в Prisma-схеме. */
export const GEO_VEHICLE_TYPES = ['car', 'van', 'refrigerated', 'flatbed'] as const;

export type GeoVehicleType = (typeof GEO_VEHICLE_TYPES)[number];

export const GEO_VEHICLE_LABELS: Record<GeoVehicleType, string> = {
  car: 'Легковая',
  van: 'Фургон',
  refrigerated: 'Рефрижератор',
  flatbed: 'Бортовая',
};

/** Координата {lat, lng} — точки коридора и ответы nearby. */
export interface GeoCoord {
  lat: number;
  lng: number;
}

/** Геозона (DTO уровня API, v0.5.0, ADR-014). */
export interface GeoPointDto {
  id: string;
  ownerId: string;
  kind: GeoPointKind;
  latitude: number;
  longitude: number;
  address: string | null;
  label: string | null;
  radiusMeters: number;
  isActive: boolean;
  /** Коридор: старт {lat, lng} (для delivery_corridor, иначе null). */
  corridorFrom: GeoCoord | null;
  /** Коридор: финиш {lat, lng}. */
  corridorTo: GeoCoord | null;
  vehicleType: GeoVehicleType;
  maxWeightKg: number | null;
  isRefrigerated: boolean;
  createdAt: string;
  updatedAt: string;
  /** Расстояние в метрах от запрошенной точки (только в nearby-ответах). */
  distanceMeters?: number;
}

// ─── Доставка попутчиками (v0.5.0, ADR-015) ─────────────────────────────────

/** Статусы запроса доставки. Совпадают с enum DeliveryStatus в Prisma-схеме. */
export const DELIVERY_STATUSES = [
  'open',
  'assigned',
  'in_transit',
  'delivered',
  'cancelled',
  'expired',
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  open: 'Ждёт водителя',
  assigned: 'Водитель взял',
  in_transit: 'В пути',
  delivered: 'Доставлено',
  cancelled: 'Отменено',
  expired: 'Истекло',
};

/** Действия журнала доставки. Совпадают с enum DeliveryEventAction. */
export const DELIVERY_EVENT_ACTIONS = [
  'created',
  'assigned',
  'started',
  'delivered',
  'cancelled',
  'expired',
  'blocked_by_289fz',
] as const;

export type DeliveryEventActionType = (typeof DELIVERY_EVENT_ACTIONS)[number];

/** Точка маршрута доставки с координатами (для карты и «Заберу отсюда»). */
export interface DeliveryPointDto {
  id: string;
  ownerId: string;
  ownerName: string;
  label: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
}

/** Запрос доставки (DTO уровня API, v0.5.0-C, ADR-015).
 *  Цены нет НАМЕРЕННО: платформа не агент (ADR-015). */
export interface DeliveryDto {
  id: string;
  buyerId: string;
  buyerName: string;
  bookingId: string | null;
  pickup: DeliveryPointDto;
  dropoff: DeliveryPointDto;
  /** Decimal от Prisma приходит строкой — точность не теряется. */
  weightKg: string;
  description: string | null;
  status: DeliveryStatus;
  assignedDriverId: string | null;
  assignedDriverName: string | null;
  assignedAt: string | null;
  deliveredAt: string | null;
  /** TTL запроса: открытым живёт DELIVERY_TTL_MINUTES (по умолчанию 60). */
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  /** QR-коды передачи: видны только покупателю и назначенному водителю. */
  pickupCode: string | null;
  dropoffCode: string | null;
  /** Насколько точка забора/выгрузки рядом с маршрутом (для радара). */
  corridorDistanceMeters: number | null;
}

// ─── Уведомления (v0.4.0, ADR-010) ──────────────────────────────────────────


/** Типы in-app уведомлений. Совпадают с enum NotificationType в Prisma-схеме. */
export const NOTIFICATION_TYPES = [
  'debt_reminder',
  'booking_delivery_confirmed',
  'booking_delivery_disputed',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** In-app уведомление (DTO уровня API). */
export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

/** Ответ GET /notifications/me. */
export interface NotificationsListDto {
  items: NotificationDto[];
  unreadCount: number;
}

// ─── Учёт часов 289-ФЗ (v0.4.0, ADR-011) ────────────────────────────────────

/**
 * Рабочая сессия пары «водитель — продавец» (DTO уровня API).
 * Это НЕ биллинг: только часы, никаких денег в интерфейсе.
 */
export interface WorkHoursSessionDto {
  id: string;
  driverId: string;
  driverName: string;
  sellerId: string;
  sellerName: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  /** Месяц старта «YYYY-MM». */
  month: string;
}

/** Пара за текущий месяц — строка экрана «Мои часы» / «Часы с водителями». */
export interface WorkHoursPairDto {
  /** Противоположная сторона пары: продавец (для driver) или водитель (для seller). */
  counterpartId: string;
  counterpartName: string;
  /** Текущий месяц «YYYY-MM». */
  month: string;
  totalMinutes: number;
  /** ≥ лимита часов в этом месяце (засчитан в «опасную» серию). */
  monthCounted: boolean;
  /** Цепочка месяцев подряд с monthCounted=true, включая текущий. */
  series: number;
  /** Пара заблокирована (289-ФЗ: нужна пауза). */
  blocked: boolean;
  /** Открытая сессия с этим контрагентом (для кнопки «Завершить»). */
  activeSessionId: string | null;
}

/** Ответ GET /work-hours/check/:driverId/:sellerId — можно ли работать паре. */
export interface WorkHoursCheckDto {
  driverId: string;
  sellerId: string;
  blocked: boolean;
  reason: string | null;
  unblockAt: string | null;
  /** Часы пары в текущем месяце. */
  totalMinutesCurrent: number;
  monthCounted: boolean;
  series: number;
}

/**
 * Пороговые константы для UI (значения по умолчанию; сервер может
 * переопределять через WORK_HOURS_MONTHLY_LIMIT / WORK_MONTHS_SERIES).
 */
export const WORK_HOURS_UI = {
  /** Янтарная зона прогресс-бара: 48 ч из 60. */
  warningMinutes: 48 * 60,
  /** Мягкое предупреждение «близки к лимиту»: >50 ч и серия 5 месяцев. */
  approachingMinutes: 50 * 60,
  approachingSeries: 5,
} as const;

/**
 * Маскированный телефон для логов и UI: +7***1234
 * (код страны, три звёздочки, последние 4 цифры).
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) {
    return '***';
  }
  return `+7***${digits.slice(-4)}`;
}

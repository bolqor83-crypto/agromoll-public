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
};

/** Действия журнала брони. Совпадают с enum BookingAction в Prisma-схеме. */
export const BOOKING_ACTIONS = [
  'created',
  'counter_offered',
  'accepted_counter',
  'confirmed',
  'cancelled',
  'expired',
] as const;

export type BookingAction = (typeof BOOKING_ACTIONS)[number];

/**
 * Лот продавца (DTO уровня API, без служебных полей БД).
 * Decimal из Prisma приходит строкой — сохраняем её как есть и парсим в UI.
 */
export interface ListingDto {
  id: string;
  sellerId: string;
  sellerName?: string;
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
  requestedQuantity: number;
  confirmedQuantity: number | null;
  status: BookingStatus;
  expiresAt: string;
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

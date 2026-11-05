/**
 * Тонкий клиент API АгроМолл (v0.2.0).
 *
 * Аутентификация пока — заглушка X-User-Id (см. ADR-004): id демо-аккаунта
 * роли подставляется из @agromoll/types.DEMO_ACCOUNTS. Все запросы идут
 * с 8-секундным таймаутом; при недоступности API экраны переключаются
 * на демо-данные (виден бейдж «Демо-данные»).
 */
import type { BookingDto, ListingDto } from '@agromoll/types';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/** Таймаут запроса: рынок торопится, ждать дольше 8 секунд нельзя. */
const REQUEST_TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Человекочитаемое сообщение об ошибке от API, если есть. */
  get hint(): string | undefined {
    if (
      this.body &&
      typeof this.body === 'object' &&
      'message' in this.body &&
      typeof (this.body as { message: unknown }).message === 'string'
    ) {
      return (this.body as { message: string }).message;
    }
    return undefined;
  }
}

async function apiFetch<T>(path: string, userId: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
        ...(init?.headers as Record<string, string> | undefined),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      throw new ApiError(`API ответил ${res.status}`, res.status, body);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  /** Лента активных лотов. */
  listings: (userId: string) => apiFetch<ListingDto[]>('/listings', userId),

  /** Карточка лота. */
  listing: (userId: string, id: string) => apiFetch<ListingDto>(`/listings/${id}`, userId),

  /** Витрина продавца — свои лоты. */
  myListings: (userId: string) => apiFetch<ListingDto[]>('/listings/mine', userId),

  /** Выставить лот (seller). */
  createListing: (
    userId: string,
    body: {
      title: string;
      category: string;
      unit: string;
      pricePerUnit: number;
      quantityAvailable: number;
    },
  ) =>
    apiFetch<ListingDto>('/listings', userId, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Мои брони (buyer — свои, seller — входящие). */
  bookings: (userId: string) => apiFetch<BookingDto[]>('/bookings', userId),

  /** Создать бронь (buyer). */
  createBooking: (userId: string, listingId: string, requestedQuantity: number) =>
    apiFetch<BookingDto>('/bookings', userId, {
      method: 'POST',
      body: JSON.stringify({ listingId, requestedQuantity }),
    }),

  /** Отменить бронь (любая сторона переговоров). */
  cancelBooking: (userId: string, bookingId: string, reason?: string) =>
    apiFetch<BookingDto>(`/bookings/${bookingId}/cancel`, userId, {
      method: 'POST',
      body: JSON.stringify(reason !== undefined ? { reason } : {}),
    }),

  /** Принять корректировку продавца (buyer). */
  acceptCounter: (userId: string, bookingId: string) =>
    apiFetch<BookingDto>(`/bookings/${bookingId}/accept-counter`, userId, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** Подтвердить бронь как есть (seller). */
  confirmBooking: (userId: string, bookingId: string) =>
    apiFetch<BookingDto>(`/bookings/${bookingId}/confirm`, userId, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** Предложить корректировку (seller). */
  counterOffer: (
    userId: string,
    bookingId: string,
    body: { offeredQuantity?: number; pickupTime?: string; note?: string },
  ) =>
    apiFetch<BookingDto>(`/bookings/${bookingId}/counter-offer`, userId, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

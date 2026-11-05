/**
 * Клиент API АгроМолл (v0.3.0): axios + JWT-аутентификация.
 *
 * Вместо X-User-Id (v0.2.0) — Authorization: Bearer. Interceptor:
 *  - каждый запрос получает access-токен из secure store;
 *  - при 401 — одна попытка refresh (single-flight, чтобы параллельные
 *    запросы не устроили гонку) и повтор исходного запроса;
 *  - если refresh не удался — токены стираются, экраны уходят на вход
 *    (событие 'auth:sign-out').
 *
 * Ответы API валидируются zod-схемами (подэтап C) — см. apiValidate.
 * Каждая мутация броней уходит через outbox (подэтап B), здесь — только
 * чтения и auth-вызовы.
 */
import axios from 'axios';
import type { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import type {
  AuthResponseDto,
  BookingDto,
  ListingDto,
  RefreshResponseDto,
  UserDto,
  UserRole,
} from '@agromoll/types';
import { normalizePhone } from '@agromoll/types';
import { tokenStore } from './token-store';
import { logger } from './logger';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/** Таймаут запроса: рынок торопится, ждать дольше 8 секунд нельзя. */
const REQUEST_TIMEOUT_MS = 8000;

/** Событие «токены сгорели, разлогинь» — слушает auth-store. */
export const AUTH_SIGN_OUT_EVENT = 'agromoll:auth-sign-out';

export type ApiErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'UNAUTHORIZED'
  | 'INVALID_RESPONSE'
  | 'RATE_LIMITED'
  | 'SERVER'
  | 'UNKNOWN';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly code: ApiErrorCode,
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

/** Приводит любую ошибку к ApiError с понятным кодом. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    if (axiosError.response) {
      const status = axiosError.response.status;
      const code: ApiErrorCode =
        status === 401 || status === 403
          ? 'UNAUTHORIZED'
          : status === 429
            ? 'RATE_LIMITED'
            : status >= 500
              ? 'SERVER'
              : 'UNKNOWN';
      return new ApiError(`API ответил ${status}`, status, code, axiosError.response.data);
    }
    if (axiosError.code === 'ECONNABORTED') {
      return new ApiError('Превышен таймаут запроса', undefined, 'TIMEOUT', undefined);
    }
    return new ApiError('Сеть недоступна', undefined, 'NETWORK', undefined);
  }
  return new ApiError(String(error), undefined, 'UNKNOWN', undefined);
}

/** HTTP-клиент. */
export const http = axios.create({
  baseURL: API_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Interceptors: access-токен + авто-refresh при 401 ────────────────────

http.interceptors.request.use(async (config) => {
  const token = await tokenStore.getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** Single-flight refresh: параллельные 401 ждут один общий refresh. */
let refreshInFlight: Promise<string | null> | null = null;

/** Пометка запроса «не авто-refresh» (сам /auth/refresh). */
const SKIP_REFRESH_FLAG = 'agromollSkipAuthRefresh';

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await tokenStore.getRefreshToken();
  if (!refreshToken) {
    return null;
  }
  try {
    const response = await http.request<RefreshResponseDto>({
      method: 'POST',
      url: '/auth/refresh',
      data: { refreshToken },
      headers: { 'Content-Type': 'application/json' },
      // не даём интерцептору уйти в рекурсию на 401 от самого refresh
      [SKIP_REFRESH_FLAG]: true,
    } as AxiosRequestConfig & Record<string, unknown>);
    await tokenStore.setTokens(response.data.accessToken);
    return response.data.accessToken;
  } catch (error) {
    logger.warn('api', 'refresh не удался — нужен повторный вход', {
      error: toApiError(error).message,
    });
    await tokenStore.clear();
    // Сообщаем auth-store: сессия сгорела.
    emitSignOut();
    return null;
  }
}

function emitSignOut(): void {
  // globalThis работает и в RN, и в web, и в jest.
  (globalThis as { dispatchEvent?: (e: Event) => boolean }).dispatchEvent?.(
    new Event(AUTH_SIGN_OUT_EVENT),
  );
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as
      | (InternalAxiosRequestConfig & { _retried?: boolean; [k: string]: unknown })
      | undefined;

    const skipRefresh = original?.[SKIP_REFRESH_FLAG] === true;
    if (error.response?.status === 401 && original && !original._retried && !skipRefresh) {
      original._retried = true;
      refreshInFlight ??= refreshAccessToken().finally(() => {
        refreshInFlight = null;
      });
      const fresh = await refreshInFlight;
      if (fresh) {
        original.headers.Authorization = `Bearer ${fresh}`;
        return http.request(original);
      }
    }
    throw error;
  },
);

// ─── Обёртка запросов: любые ошибки → ApiError ────────────────────────────

async function apiRequest<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const response = await http.request<T>(config);
    return response.data;
  } catch (error) {
    throw toApiError(error);
  }
}

export const api = {
  // ── Auth (v0.3.0) ────────────────────────────────────────────────────────

  /** Шаг 1: запросить SMS-код. Телефон нормализуется к E.164. */
  requestCode(rawPhone: string): Promise<{ expiresInSec: number }> {
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      return Promise.reject(new ApiError('Некорректный телефон', 400, 'UNKNOWN', undefined));
    }
    return apiRequest<{ expiresInSec: number }>({
      method: 'POST',
      url: '/auth/request-code',
      data: { phone },
    });
  },

  /** Шаг 2: проверить код → токены + профиль. */
  verify(phone: string, code: string): Promise<AuthResponseDto> {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      return Promise.reject(new ApiError('Некорректный телефон', 400, 'UNKNOWN', undefined));
    }
    return apiRequest<AuthResponseDto>({
      method: 'POST',
      url: '/auth/verify',
      data: { phone: normalized, code },
    });
  },

  /** Обновить access-токен (используется интерцептором и bootstrap-ом). */
  refresh(refreshToken: string): Promise<RefreshResponseDto> {
    return apiRequest<RefreshResponseDto>({
      method: 'POST',
      url: '/auth/refresh',
      data: { refreshToken },
    });
  },

  /** Мой профиль. */
  me(): Promise<UserDto> {
    return apiRequest<UserDto>({ method: 'GET', url: '/users/me' });
  },

  /** Сменить роль (сохраняется на сервере). */
  updateRole(role: UserRole): Promise<UserDto> {
    return apiRequest<UserDto>({
      method: 'PATCH',
      url: '/users/me/role',
      data: { role },
    });
  },

  // ── Чтения (v0.2.0, без X-User-Id) ───────────────────────────────────────

  /** Лента активных лотов. */
  listings(): Promise<ListingDto[]> {
    return apiRequest<ListingDto[]>({ method: 'GET', url: '/listings' });
  },

  /** Карточка лота. */
  listing(id: string): Promise<ListingDto> {
    return apiRequest<ListingDto>({ method: 'GET', url: `/listings/${id}` });
  },

  /** Витрина продавца — свои лоты. */
  myListings(): Promise<ListingDto[]> {
    return apiRequest<ListingDto[]>({ method: 'GET', url: '/listings/mine' });
  },

  /** Мои брони (buyer — свои, seller — входящие). */
  bookings(): Promise<BookingDto[]> {
    return apiRequest<BookingDto[]>({ method: 'GET', url: '/bookings' });
  },

  // ── Мутации (v0.3.0: без userId — пользователя определяет JWT).
  // В подэтапе B эти вызовы переедут в outbox с идемпотентностью. ─────────

  /** Выставить лот (seller). */
  createListing(body: {
    title: string;
    category: string;
    unit: string;
    pricePerUnit: number;
    quantityAvailable: number;
    lineNumber?: number;
    isPerishable?: boolean;
  }): Promise<ListingDto> {
    return apiRequest<ListingDto>({ method: 'POST', url: '/listings', data: body });
  },

  /** Создать бронь (buyer). */
  createBooking(listingId: string, requestedQuantity: number): Promise<BookingDto> {
    return apiRequest<BookingDto>({
      method: 'POST',
      url: '/bookings',
      data: { listingId, requestedQuantity },
    });
  },

  /** Отменить бронь (любая сторона переговоров). */
  cancelBooking(bookingId: string, reason?: string): Promise<BookingDto> {
    return apiRequest<BookingDto>({
      method: 'POST',
      url: `/bookings/${bookingId}/cancel`,
      data: reason !== undefined ? { reason } : {},
    });
  },

  /** Принять корректировку продавца (buyer). */
  acceptCounter(bookingId: string): Promise<BookingDto> {
    return apiRequest<BookingDto>({
      method: 'POST',
      url: `/bookings/${bookingId}/accept-counter`,
      data: {},
    });
  },

  /** Подтвердить бронь как есть (seller). */
  confirmBooking(bookingId: string): Promise<BookingDto> {
    return apiRequest<BookingDto>({
      method: 'POST',
      url: `/bookings/${bookingId}/confirm`,
      data: {},
    });
  },

  /** Предложить корректировку (seller). */
  counterOffer(
    bookingId: string,
    body: { offeredQuantity?: number; pickupTime?: string; note?: string },
  ): Promise<BookingDto> {
    return apiRequest<BookingDto>({
      method: 'POST',
      url: `/bookings/${bookingId}/counter-offer`,
      data: body,
    });
  },
};

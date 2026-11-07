/**
 * Клиент API АгроМолл (v0.3.0/v0.3.1): axios + JWT-аутентификация.
 *
 * Вместо X-User-Id (v0.2.0) — Authorization: Bearer. Interceptor:
 *  - каждый запрос получает access-токен из secure store;
 *  - при 401 — одна попытка refresh (single-flight, чтобы параллельные
 *    запросы не устроили гонку) и повтор исходного запроса;
 *  - если refresh не удался — токены стираются, экраны уходят на вход
 *    (событие 'auth:sign-out').
 *
 * v0.3.1 (ротация, ADR-008):
 *  - /auth/refresh возвращает НОВУЮ пару токенов — сохраняем оба;
 *  - 401 TOKEN_REUSE_DETECTED (старый refresh предъявлен повторно —
 *    сервер отозвал семью) — принудительный выход с мягким сообщением
 *    «Сессия завершена. Войдите снова» (без слова «кража»);
 *  - POST /auth/logout перед локальной очисткой (best-effort).
 *
 * Ответы API валидируются zod-схемами (v0.3.0) — см. apiValidate.
 * Каждая мутация броней уходит через outbox, здесь — только
 * чтения и auth-вызовы.
 */
import axios from 'axios';
import { randomUUID } from 'expo-crypto';
import type { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import type {
  AppealDetailDto,
  AppealDto,
  AppealsListDto,
  AuthResponseDto,
  BookingDto,
  CounterpartyDto,
  DebtDto,
  DebtsSummaryDto,
  DeliveryDto,
  DisputeDetailDto,
  DisputeDto,
  DisputesListDto,
  GeoPointDto,
  ListingDto,
  MyReputationDto,
  NotificationLogListDto,
  NotificationsListDto,
  PushRegistrationDto,
  RefreshResponseDto,
  ReminderResultDto,
  RegisterPushInput,
  ReputationDto,
  UnregisterPushInput,
  UserDto,
  UserRole,
  VapidPublicKeyDto,
  WorkHoursCheckDto,
  WorkHoursPairDto,
  WorkHoursSessionDto,
} from '@agromoll/types';
import { normalizePhone } from '@agromoll/types';
import { tokenStore } from './token-store';
import { logger } from './logger';
import { API_URL, IS_API_CONFIGURED } from './api-config';
import {
  AppealDetailResponseSchema,
  AppealResponseSchema,
  AppealsListResponseSchema,
  AuthResponseSchema,
  BookingsResponseSchema,
  CounterpartiesResponseSchema,
  DebtsResponseSchema,
  DebtsSummaryResponseSchema,
  DeliveriesResponseSchema,
  DeliveryResponseSchema,
  DisputeDetailResponseSchema,
  DisputeMessageResponseSchema,
  DisputeResponseSchema,
  DisputesListResponseSchema,
  GeoPointResponseSchema,
  GeoPointsResponseSchema,
  ListingResponseSchema,
  ListingsResponseSchema,
  MyReputationResponseSchema,
  NotificationLogResponseSchema,
  NotificationsListResponseSchema,
  PushRegistrationResponseSchema,
  RefreshResponseSchema,
  ReminderResponseSchema,
  ReputationResponseSchema,
  RequestCodeResponseSchema,
  UserResponseSchema,
  VapidPublicKeyResponseSchema,
  WorkHoursCheckResponseSchema,
  WorkHoursPairsResponseSchema,
  WorkHoursSessionResponseSchema,
} from '@agromoll/validation';
import type { ZodType } from 'zod';

const REQUEST_TIMEOUT_MS = 8000;

/**
 * Адрес API (ADR-022): EXPO_PUBLIC_API_URL, в dev — localhost-фолбэк,
 * в prod фолбэка НЕТ. Не настроен → приложение показывает экран
 * «Сервер не настроен» (гейт в app/_layout.tsx) и экраны не рендерятся,
 * поэтому недостижимый плейсхолдер ниже — только защита от «тихого» URL.
 */
export const RESOLVED_API_URL = API_URL;

/** Задан ли адрес API (гейт корневого layout, ADR-022). */
export function isApiConfigured(): boolean {
  return IS_API_CONFIGURED;
}

/** Событие «токены сгорели, разлогинь» — слушает auth-store. */
export const AUTH_SIGN_OUT_EVENT = 'agromoll:auth-sign-out';

/**
 * Причина принудительного выхода (v0.3.1): 'reuse' — сервер обнаружил
 * повторное использование refresh-токена (семья отозвана), 'expired' —
 * refresh просто не сработал. Читается auth-store'ом при обработке
 * события (в Event нет detail в RN — держим рядом в модуле).
 */
export type SignOutReason = 'expired' | 'reuse';

let lastSignOutReason: SignOutReason = 'expired';

/** Причина последнего принудительного выхода (для сообщения на входе). */
export function getLastSignOutReason(): SignOutReason {
  return lastSignOutReason;
}

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

/** Ошибка формата ответа: сервер ответил, но данные не соответствуют схеме. */
export function isInvalidResponseError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'INVALID_RESPONSE';
}

/**
 * Валидация ответа zod-схемой (подэтап C, ADR-006).
 * Старый клиент + новый сервер, баги сериализации, MITM (частично) —
 * рендерим только проверенные данные. Лишние поля не отвергаются
 * (passthrough) — обратная совместимость.
 */
function validateResponse<T>(schema: ZodType<T>, data: unknown, context: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    // structured-лог с сырым ответом: без этого такой баг не отловить
    logger.error('api', 'невалидный ответ API', {
      context,
      raw: data,
      issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    throw new ApiError(
      `API вернул неверный формат (${context})`,
      undefined,
      'INVALID_RESPONSE',
      data,
    );
  }
  return result.data;
}

/** HTTP-клиент. */
export const http = axios.create({
  // API_URL === null возможен только в prod без EXPO_PUBLIC_API_URL —
  // тогда корневой layout показывает экран «Сервер не настроен» и до
  // запросов дело не доходит. Плейсхолдер .invalid роняет DNS сразу,
  // а не ходит на чужой localhost (хотфикс v0.6.1-0).
  baseURL: API_URL ?? 'http://api-not-configured.invalid',
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

/** 401 от /auth/refresh с этим кодом = семья отозвана (ротация, ADR-008). */
const TOKEN_REUSE_CODE = 'TOKEN_REUSE_DETECTED';

/** Тело ошибки содержит код TOKEN_REUSE_DETECTED? */
function isReuseDetectedError(error: unknown): boolean {
  const apiError = toApiError(error);
  return Boolean(
    apiError.body &&
    typeof apiError.body === 'object' &&
    (apiError.body as { code?: unknown }).code === TOKEN_REUSE_CODE,
  );
}

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
    // Ротация (v0.3.1): сервер вернул НОВУЮ пару — сохраняем оба токена.
    await tokenStore.setTokens(response.data.accessToken, response.data.refreshToken);
    return response.data.accessToken;
  } catch (error) {
    const reuseDetected = isReuseDetectedError(error);
    logger.warn(
      'api',
      reuseDetected
        ? 'обнаружен повторный refresh — сервер отозвал сессию'
        : 'refresh не удался — нужен повторный вход',
      {
        error: toApiError(error).message,
      },
    );
    await tokenStore.clear();
    // Сообщаем auth-store: сессия сгорела (с причиной — для сообщения).
    emitSignOut(reuseDetected ? 'reuse' : 'expired');
    return null;
  }
}

function emitSignOut(reason: SignOutReason): void {
  lastSignOutReason = reason;
  // globalThis работает и в RN, и в web, и в jest.
  (globalThis as { dispatchEvent?: (e: Event) => boolean }).dispatchEvent?.(
    new Event(AUTH_SIGN_OUT_EVENT),
  );
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as
      (InternalAxiosRequestConfig & { _retried?: boolean; [k: string]: unknown }) | undefined;

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
    }).then((data) => validateResponse(RequestCodeResponseSchema, data, 'auth/request-code'));
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
    }).then((data) => validateResponse(AuthResponseSchema, data, 'auth/verify'));
  },

  /** Обновить пару токенов ротацией (интерцептор и bootstrap). */
  refresh(refreshToken: string): Promise<RefreshResponseDto> {
    return apiRequest<RefreshResponseDto>({
      method: 'POST',
      url: '/auth/refresh',
      data: { refreshToken },
    }).then((data) => validateResponse(RefreshResponseSchema, data, 'auth/refresh'));
  },

  /**
   * Выход (v0.3.1): отозвать сессию на сервере ДО локальной очистки.
   * Ошибку НЕ пробрасываем намеренно: локальный выход не должен
   * блокироваться сетью — иначе пользователь «застрянет» в аккаунте.
   * Сетевой сбой логируется (поддержка может отозвать семью вручную).
   */
  async logout(refreshToken: string, accessToken?: string): Promise<void> {
    try {
      await apiRequest<void>({
        method: 'POST',
        url: '/auth/logout',
        data: { refreshToken, ...(accessToken ? { accessToken } : {}) },
      });
    } catch (error) {
      logger.warn('api', 'logout на сервере не удался (продолжаем локальный выход)', {
        error: toApiError(error).message,
      });
    }
  },

  /** Мой профиль. */
  me(): Promise<UserDto> {
    return apiRequest<UserDto>({ method: 'GET', url: '/users/me' }).then((d) =>
      validateResponse(UserResponseSchema, d, 'users/me'),
    );
  },

  /** Сменить роль (сохраняется на сервере). */
  updateRole(role: UserRole): Promise<UserDto> {
    return apiRequest<UserDto>({
      method: 'PATCH',
      url: '/users/me/role',
      data: { role },
    }).then((d) => validateResponse(UserResponseSchema, d, 'users/me/role'));
  },

  // ── Чтения (v0.2.0, без X-User-Id) ───────────────────────────────────────

  /** Лента активных лотов. */
  listings(): Promise<ListingDto[]> {
    return apiRequest<ListingDto[]>({ method: 'GET', url: '/listings' }).then((d) =>
      validateResponse(ListingsResponseSchema, d, 'listings'),
    );
  },

  /** Карточка лота. */
  listing(id: string): Promise<ListingDto> {
    return apiRequest<ListingDto>({ method: 'GET', url: `/listings/${id}` }).then((d) =>
      validateResponse(ListingResponseSchema, d, 'listings/:id'),
    );
  },

  /** Витрина продавца — свои лоты. */
  myListings(): Promise<ListingDto[]> {
    return apiRequest<ListingDto[]>({ method: 'GET', url: '/listings/mine' }).then((d) =>
      validateResponse(ListingsResponseSchema, d, 'listings/mine'),
    );
  },

  /** Мои брони (buyer — свои, seller — входящие). */
  bookings(): Promise<BookingDto[]> {
    return apiRequest<BookingDto[]>({ method: 'GET', url: '/bookings' }).then((d) =>
      validateResponse(BookingsResponseSchema, d, 'bookings'),
    );
  },

  // ── Долги (v0.4.0, ADR-010) ──────────────────────────────────────────────
  // Мутации (create/settle/dispute/resolve) — через офлайн-ядро
  // src/lib/outbox/debt-mutations.ts; здесь чтения и напоминание.

  /** Мои долги обеих сторон («мне должны» / «я должен»). */
  debts(status?: string): Promise<DebtDto[]> {
    return apiRequest<DebtDto[]>({
      method: 'GET',
      url: '/debts',
      ...(status ? { params: { status } } : {}),
    }).then((d) => validateResponse(DebtsResponseSchema, d, 'debts'));
  },

  /** Сводка для виджета: должны мне / должен я (+просроченные). */
  debtsSummary(): Promise<DebtsSummaryDto> {
    return apiRequest<DebtsSummaryDto>({ method: 'GET', url: '/debts/summary' }).then((d) =>
      validateResponse(DebtsSummaryResponseSchema, d, 'debts/summary'),
    );
  },

  /** Контрагенты для формы создания долга (с кем были сделки). */
  debtCounterparties(): Promise<CounterpartyDto[]> {
    return apiRequest<CounterpartyDto[]>({ method: 'GET', url: '/debts/counterparties' }).then(
      (d) => validateResponse(CounterpartiesResponseSchema, d, 'debts/counterparties'),
    );
  },

  /**
   * Напомнить дебитору (только кредитор). Прямой вызов — напоминание
   * осмысленно только онлайн; 429 (кулдаун 24 ч) пробрасывается
   * как ApiError(RATE_LIMITED) с hint от сервера.
   */
  remindDebt(debtId: string): Promise<ReminderResultDto> {
    return apiRequest<ReminderResultDto>({
      method: 'POST',
      url: `/debts/${debtId}/reminder`,
      data: {},
    }).then((d) => validateResponse(ReminderResponseSchema, d, 'debts/:id/reminder'));
  },

  /** Мои уведомления (in-app) + счётчик непрочитанных. */
  notifications(): Promise<NotificationsListDto> {
    return apiRequest<NotificationsListDto>({ method: 'GET', url: '/notifications/me' }).then((d) =>
      validateResponse(NotificationsListResponseSchema, d, 'notifications/me'),
    );
  },

  // ─── Push-уведомления (v0.6.0-A, ADR-031) ─────────────────────

  /** Зарегистрировать push-канал (FCM-токен или web-подписка, upsert). */
  registerPush(input: RegisterPushInput): Promise<PushRegistrationDto> {
    return apiRequest<PushRegistrationDto>({
      method: 'POST',
      url: '/notifications/register',
      data: input,
    }).then((d) => validateResponse(PushRegistrationResponseSchema, d, 'notifications/register'));
  },

  /** Снять регистрацию push-канала при logout (best-effort). */
  async unregisterPush(input: UnregisterPushInput): Promise<void> {
    try {
      await apiRequest<PushRegistrationDto>({
        method: 'DELETE',
        url: '/notifications/unregister',
        data: input,
      });
    } catch (error) {
      // Выход не должен блокироваться сетью (как logout, ADR-008).
      logger.warn('api', 'unregister push не удался (продолжаем выход)', {
        error: toApiError(error).message,
      });
    }
  },

  /** Журнал push-доставок (отладка «не пришло»). */
  notificationLog(): Promise<NotificationLogListDto> {
    return apiRequest<NotificationLogListDto>({ method: 'GET', url: '/notifications/log' }).then(
      (d) => validateResponse(NotificationLogResponseSchema, d, 'notifications/log'),
    );
  },

  /** Публичный VAPID-ключ сервера (null — web push не настроен). */
  async vapidPublicKey(): Promise<string | null> {
    try {
      const data = await apiRequest<VapidPublicKeyDto>({
        method: 'GET',
        url: '/notifications/vapid-public',
      });
      return validateResponse(VapidPublicKeyResponseSchema, data, 'notifications/vapid-public')
        .publicKey;
    } catch {
      return null;
    }
  },

  // ─── Публичный рейтинг (v0.5.0, ADR-013) ──────────────────────

  /** Мой рейтинг: score, счётчики, прогресс, последние события. */
  myReputation(): Promise<MyReputationDto> {
    return apiRequest<MyReputationDto>({ method: 'GET', url: '/reputation/me' }).then((d) =>
      validateResponse(MyReputationResponseSchema, d, 'reputation/me'),
    );
  },

  /** Публичный рейтинг пользователя (бейдж контрагента). */
  reputation(userId: string): Promise<ReputationDto> {
    return apiRequest<ReputationDto>({ method: 'GET', url: `/reputation/${userId}` }).then((d) =>
      validateResponse(ReputationResponseSchema, d, 'reputation/:userId'),
    );
  },

  // ─── Геозоны (v0.5.0, ADR-014) ──────────────────────────────────────

  /** Создать свою точку (buyer → buyer_point, seller → seller_line). */
  createGeoPoint(input: {
    kind: 'buyer_point' | 'seller_line';
    latitude: number;
    longitude: number;
    address?: string;
    label?: string;
    radiusMeters?: number;
  }): Promise<GeoPointDto> {
    return apiRequest<GeoPointDto>({ method: 'POST', url: '/geo/points', data: input }).then((d) =>
      validateResponse(GeoPointResponseSchema, d, 'geo/points'),
    );
  },

  /** Опубликовать маршрут доставщика (только driver). */
  createGeoCorridor(input: {
    corridorFrom: { lat: number; lng: number };
    corridorTo: { lat: number; lng: number };
    vehicleType?: 'car' | 'van' | 'refrigerated' | 'flatbed';
    maxWeightKg?: number;
    isRefrigerated?: boolean;
    label?: string;
  }): Promise<GeoPointDto> {
    return apiRequest<GeoPointDto>({ method: 'POST', url: '/geo/corridors', data: input }).then(
      (d) => validateResponse(GeoPointResponseSchema, d, 'geo/corridors'),
    );
  },

  /** Точки в радиусе (PostGIS ST_DWithin, ADR-014). */
  geoPointsNearby(params: {
    lat: number;
    lng: number;
    radiusMeters?: number;
    kind?: 'buyer_point' | 'seller_line';
  }): Promise<GeoPointDto[]> {
    return apiRequest<GeoPointDto[]>({
      method: 'GET',
      url: '/geo/points/nearby',
      params,
    }).then((d) => validateResponse(GeoPointsResponseSchema, d, 'geo/points/nearby'));
  },

  /** Маршруты доставщиков, проходящие рядом с точкой. */
  geoCorridorsNearby(params: {
    lat: number;
    lng: number;
    radiusMeters?: number;
  }): Promise<GeoPointDto[]> {
    return apiRequest<GeoPointDto[]>({
      method: 'GET',
      url: '/geo/corridors/nearby',
      params,
    }).then((d) => validateResponse(GeoPointsResponseSchema, d, 'geo/corridors/nearby'));
  },

  /** Мои активные геозоны. */
  geoPointsMine(): Promise<GeoPointDto[]> {
    return apiRequest<GeoPointDto[]>({ method: 'GET', url: '/geo/points/mine' }).then((d) =>
      validateResponse(GeoPointsResponseSchema, d, 'geo/points/mine'),
    );
  },

  /** Обновить свою геозону. */
  updateGeoPoint(
    id: string,
    input: {
      latitude?: number;
      longitude?: number;
      address?: string;
      label?: string;
      radiusMeters?: number;
    },
  ): Promise<GeoPointDto> {
    return apiRequest<GeoPointDto>({ method: 'PATCH', url: `/geo/points/${id}`, data: input }).then(
      (d) => validateResponse(GeoPointResponseSchema, d, 'geo/points/:id'),
    );
  },

  /** Убрать свою геозону (деактивация, история остаётся). */
  deactivateGeoPoint(id: string): Promise<GeoPointDto> {
    return apiRequest<GeoPointDto>({ method: 'DELETE', url: `/geo/points/${id}` }).then((d) =>
      validateResponse(GeoPointResponseSchema, d, 'geo/points/:id'),
    );
  },

  // ─── Доставка попутчиками (v0.5.0, ADR-015) ──────────────────────
  // Создание — офлайн через outbox (createDeliveryMutation); взятие и
  // шаги — только онлайн: сервер проверяет BlockedPair (289-ФЗ).

  /** Радар: открытые заказы, попутные маршрутам водителя. */
  deliveriesOpen(): Promise<DeliveryDto[]> {
    return apiRequest<DeliveryDto[]>({ method: 'GET', url: '/deliveries/open' }).then((d) =>
      validateResponse(DeliveriesResponseSchema, d, 'deliveries/open'),
    );
  },

  /** Мои доставки: покупателю — созданные, водителю — взятые. */
  deliveriesMine(): Promise<DeliveryDto[]> {
    return apiRequest<DeliveryDto[]>({ method: 'GET', url: '/deliveries/me' }).then((d) =>
      validateResponse(DeliveriesResponseSchema, d, 'deliveries/me'),
    );
  },

  /** Взять заказ (только водитель; 409 DELIVERY_PAIR_BLOCKED — пауза 289-ФЗ). */
  assignDelivery(deliveryId: string): Promise<DeliveryDto> {
    return apiRequest<DeliveryDto>({
      method: 'POST',
      url: `/deliveries/${deliveryId}/assign`,
      data: {},
    }).then((d) => validateResponse(DeliveryResponseSchema, d, 'deliveries/assign'));
  },

  /** Выехал к точке забора. */
  startDelivery(deliveryId: string): Promise<DeliveryDto> {
    return apiRequest<DeliveryDto>({
      method: 'POST',
      url: `/deliveries/${deliveryId}/start`,
      data: {},
    }).then((d) => validateResponse(DeliveryResponseSchema, d, 'deliveries/start'));
  },

  /** Передача завершена (QR-подтверждение — на клиенте, ADR-015). */
  deliverDelivery(deliveryId: string): Promise<DeliveryDto> {
    return apiRequest<DeliveryDto>({
      method: 'POST',
      url: `/deliveries/${deliveryId}/deliver`,
      data: {},
    }).then((d) => validateResponse(DeliveryResponseSchema, d, 'deliveries/deliver'));
  },

  /** Отмена (после выезда — только водитель, с причиной). */
  cancelDelivery(deliveryId: string, reason?: string): Promise<DeliveryDto> {
    return apiRequest<DeliveryDto>({
      method: 'POST',
      url: `/deliveries/${deliveryId}/cancel`,
      data: reason ? { reason } : {},
    }).then((d) => validateResponse(DeliveryResponseSchema, d, 'deliveries/cancel'));
  },

  // ─── Учёт часов 289-ФЗ (v0.4.0, ADR-011) ──────────────────────────────
  // Только часы, никаких денег. Сессии — прямые вызовы (серверные
  // временные метки авторитетны, офлайн-очередь исказила бы время).

  /** Мои пары за текущий месяц (driver — по продавцам, seller — по водителям). */
  workHoursMine(): Promise<WorkHoursPairDto[]> {
    return apiRequest<WorkHoursPairDto[]>({ method: 'GET', url: '/work-hours/me' }).then((d) =>
      validateResponse(WorkHoursPairsResponseSchema, d, 'work-hours/me'),
    );
  },

  /** Открытая смена водителя (для кнопки «Завершить»). */
  workHoursOpenSession(): Promise<WorkHoursSessionDto | null> {
    return apiRequest<WorkHoursSessionDto | null>({
      method: 'GET',
      url: '/work-hours/open-session',
    }).then((d) =>
      d === null
        ? null
        : validateResponse(WorkHoursSessionResponseSchema, d, 'work-hours/open-session'),
    );
  },

  /** Можно ли паре работать (блокировка, часы, серия). */
  workHoursCheck(driverId: string, sellerId: string): Promise<WorkHoursCheckDto> {
    return apiRequest<WorkHoursCheckDto>({
      method: 'GET',
      url: `/work-hours/check/${driverId}/${sellerId}`,
    }).then((d) => validateResponse(WorkHoursCheckResponseSchema, d, 'work-hours/check'));
  },

  /** Начать смену с продавцом (только driver). 409 WORK_PAIR_BLOCKED — пауза. */
  startWorkSession(sellerId: string): Promise<WorkHoursSessionDto> {
    return apiRequest<WorkHoursSessionDto>({
      method: 'POST',
      url: '/work-hours/sessions',
      data: { sellerId },
    }).then((d) => validateResponse(WorkHoursSessionResponseSchema, d, 'work-hours/sessions'));
  },

  /** Завершить смену (водитель или продавец пары; идемпотентно). */
  endWorkSession(sessionId: string): Promise<WorkHoursSessionDto> {
    return apiRequest<WorkHoursSessionDto>({
      method: 'POST',
      url: `/work-hours/sessions/${sessionId}/end`,
      data: {},
    }).then((d) =>
      validateResponse(WorkHoursSessionResponseSchema, d, 'work-hours/sessions/:id/end'),
    );
  },

  // ─── Арбитраж споров (v0.6.0-C, ADR-033) ─────────────────────
  // Спор — онлайн-процедура: стороны договариваются через арбитра,
  // офлайн-очередь здесь путает (риск «спор улетел из лифта»).
  // Идемпотентность ретраев — X-Idempotency-Key (ADR-006).

  /** Открыть спор по объекту (бронь/доставка/долг). Только сторона. */
  openDispute(input: {
    type: 'booking' | 'delivery' | 'debt';
    referenceId: string;
    reason: string;
  }): Promise<DisputeDto> {
    return apiRequest<DisputeDto>({
      method: 'POST',
      url: '/disputes',
      data: input,
      headers: { 'X-Idempotency-Key': randomUUID() },
    }).then((d) => validateResponse(DisputeResponseSchema, d, 'disputes (POST)'));
  },

  /** Мои споры (кейсы, где я сторона). */
  myDisputes(): Promise<DisputesListDto> {
    return apiRequest<DisputesListDto>({ method: 'GET', url: '/disputes' }).then((d) =>
      validateResponse(DisputesListResponseSchema, d, 'disputes'),
    );
  },

  /** Детали кейса: переписка + доказательства (служебные скрыты). */
  dispute(disputeId: string): Promise<DisputeDetailDto> {
    return apiRequest<DisputeDetailDto>({ method: 'GET', url: `/disputes/${disputeId}` }).then(
      (d) => validateResponse(DisputeDetailResponseSchema, d, 'disputes/:id'),
    );
  },

  /** Сообщение в кейсе (только активный). */
  sendDisputeMessage(
    disputeId: string,
    body: string,
    isInternal = false,
  ): Promise<DisputeDetailDto['messages'][number]> {
    return apiRequest<DisputeDetailDto['messages'][number]>({
      method: 'POST',
      url: `/disputes/${disputeId}/messages`,
      data: { body, isInternal },
      headers: { 'X-Idempotency-Key': randomUUID() },
    }).then((d) => validateResponse(DisputeMessageResponseSchema, d, 'disputes/:id/messages'));
  },

  /** Взять спор в работу (только арбитр): open → under_review. */
  assignDispute(disputeId: string): Promise<DisputeDto> {
    return apiRequest<DisputeDto>({
      method: 'POST',
      url: `/disputes/${disputeId}/assign`,
      data: {},
      headers: { 'X-Idempotency-Key': randomUUID() },
    }).then((d) => validateResponse(DisputeResponseSchema, d, 'disputes/:id/assign'));
  },

  /** Решение арбитра: судьба объекта + репутация сторон. */
  resolveDispute(
    disputeId: string,
    input: {
      outcome: 'favor_buyer' | 'favor_seller' | 'compromise' | 'no_fault' | 'dismiss';
      notes?: string;
      bookingOutcome?: 'cancel' | 'complete' | 'complete_minor';
      debtOutcome?: 'cancel' | 'restore_active' | 'settle_adjusted';
      adjustedAmount?: number;
      deliveryOutcome?: 'none' | 'cancel';
    },
  ): Promise<DisputeDetailDto> {
    return apiRequest<DisputeDetailDto>({
      method: 'POST',
      url: `/disputes/${disputeId}/resolve`,
      data: input,
      headers: { 'X-Idempotency-Key': randomUUID() },
    }).then((d) => validateResponse(DisputeDetailResponseSchema, d, 'disputes/:id/resolve'));
  },

  /** Очередь арбитража (только арбитр): активные кейсы. */
  disputeQueue(): Promise<DisputesListDto> {
    return apiRequest<DisputesListDto>({ method: 'GET', url: '/disputes/queue' }).then((d) =>
      validateResponse(DisputesListResponseSchema, d, 'disputes/queue'),
    );
  },

  // ─── Апелляции на блокировки 289-ФЗ (v0.6.0-E, ADR-035) ───────
  // Обжалование — онлайн-процедура, как и споры: арбитру нужна
  // суть жалобы, «апелляция из лифта» без объяснений бесполезна.

  /** Открыть апелляцию на активную блокировку пары. Только сторона пары. */
  openAppeal(input: { blockedPairId: string; reason: string }): Promise<AppealDto> {
    return apiRequest<AppealDto>({
      method: 'POST',
      url: '/appeals',
      data: input,
      headers: { 'X-Idempotency-Key': randomUUID() },
    }).then((d) => validateResponse(AppealResponseSchema, d, 'appeals (POST)'));
  },

  /** Мои апелляции: поданные мной и по моим парам. */
  myAppeals(): Promise<AppealsListDto> {
    return apiRequest<AppealsListDto>({ method: 'GET', url: '/appeals/mine' }).then((d) =>
      validateResponse(AppealsListResponseSchema, d, 'appeals/mine'),
    );
  },

  /** Детали кейса + история месяцев часов пары (доказательство). */
  appeal(appealId: string): Promise<AppealDetailDto> {
    return apiRequest<AppealDetailDto>({ method: 'GET', url: `/appeals/${appealId}` }).then((d) =>
      validateResponse(AppealDetailResponseSchema, d, 'appeals/:id'),
    );
  },

  /** Взять апелляцию в работу (только арбитр): open → under_review. */
  assignAppeal(appealId: string): Promise<AppealDto> {
    return apiRequest<AppealDto>({
      method: 'POST',
      url: `/appeals/${appealId}/assign`,
      data: {},
      headers: { 'X-Idempotency-Key': randomUUID() },
    }).then((d) => validateResponse(AppealResponseSchema, d, 'appeals/:id/assign'));
  },

  /** Решение арбитра: снять блокировку или отклонить апелляцию. */
  resolveAppeal(
    appealId: string,
    input: { decision: 'unblock' | 'reject'; notes?: string },
  ): Promise<AppealDetailDto> {
    return apiRequest<AppealDetailDto>({
      method: 'POST',
      url: `/appeals/${appealId}/resolve`,
      data: input,
      headers: { 'X-Idempotency-Key': randomUUID() },
    }).then((d) => validateResponse(AppealDetailResponseSchema, d, 'appeals/:id/resolve'));
  },

  /** Очередь апелляций (только арбитр): активные кейсы. */
  appealQueue(): Promise<AppealsListDto> {
    return apiRequest<AppealsListDto>({ method: 'GET', url: '/appeals/queue' }).then((d) =>
      validateResponse(AppealsListResponseSchema, d, 'appeals/queue'),
    );
  },

  // ── Мутации ───────────────────────────────────────────────────────────────
  // Мутации БРОНЕЙ (create/cancel/confirm/counter-offer/accept-counter)
  // живут в офлайн-ядре: src/lib/outbox/* (X-Idempotency-Key, ADR-006).

  /** Выставить лот (seller). Не идемпотентно: офлайн-очереди не требует. */
  createListing(body: {
    title: string;
    category: string;
    unit: string;
    pricePerUnit: number;
    quantityAvailable: number;
    lineNumber?: number;
    isPerishable?: boolean;
  }): Promise<ListingDto> {
    return apiRequest<ListingDto>({ method: 'POST', url: '/listings', data: body }).then((d) =>
      validateResponse(ListingResponseSchema, d, 'listings (POST)'),
    );
  },
};

/**
 * Общие моки для рендер-тестов экранов (v0.6.1-D, ADR-026).
 *
 * Рендер-тесты экранов проверяют КОНЕЧНЫЙ АВТОМАТ (loading → ready/error)
 * и честность состояний, а не сеть и не нативные модули. Поэтому:
 *  - @/lib/api замокан: api.* — jest-функции, toApiError пропускает
 *    наши ошибочные объекты как есть (реальный маппинг axios→ApiError
 *    покрыт отдельным тестом error-content.test.ts на настоящем модуле);
 *  - сторы (auth/outbox/theme) — голые объекты с селекторами zustand:
 *    без persist, без AsyncStorage, без outbox-ядра;
 *  - тяжёлые дети экранов (карта, QR, модалки) — заглушки null.
 *
 * Паттерн require внутрь jest.mock-фабрики обходит hoisting: фабрика
 * вызывается при первом обращении к модулю, когда реестр уже готов.
 */

/** Объект, который мок-toApiError пропускает без изменений. */
export interface MockApiError {
  message: string;
  status?: number;
  code: string;
  body?: unknown;
  hint?: string;
}

/** Ошибка API с кодом — как её видят экраны после toApiError. */
export function apiError(code: string, message = 'Ошибка запроса', status?: number): MockApiError {
  return { message, status, code, body: undefined, hint: undefined };
}

/** Сетевая ошибка (нет сети / таймаут) в виде, готовом для toApiError. */
export function networkError(): MockApiError {
  return apiError('NETWORK', 'Сеть недоступна');
}

/** Сервер ответил 500. */
export function serverError(): MockApiError {
  return apiError('SERVER', 'API ответил 500', 500);
}

/** Сервер ответил неожиданным форматом (zod-валидация не прошла). */
export function invalidResponseError(): MockApiError {
  return apiError('INVALID_RESPONSE', 'API вернул неверный формат');
}

/** Мок модуля @/lib/api: api-методы — jest-функции, остальное совместимо. */
export function createApiModuleMock() {
  const api = {
    listings: jest.fn(),
    myListings: jest.fn(),
    listing: jest.fn(),
    bookings: jest.fn(),
    deliveriesOpen: jest.fn(),
    deliveriesMine: jest.fn(),
    assignDelivery: jest.fn(),
    cancelDelivery: jest.fn(),
    debtsSummary: jest.fn(),
    geoPointsNearby: jest.fn(),
    geoPointsMine: jest.fn(),
    // v0.6.0-C (ADR-033): арбитраж споров.
    myDisputes: jest.fn(),
    disputeQueue: jest.fn(),
    dispute: jest.fn(),
    disputeEvidence: jest.fn(),
    disputeEvidenceUploadUrl: jest.fn(),
    attachDisputeEvidence: jest.fn(),
    // v0.6.0-E (ADR-035): апелляции на блокировки 289-ФЗ.
    workHoursMine: jest.fn(),
    workHoursOpenSession: jest.fn(),
    openAppeal: jest.fn(),
    myAppeals: jest.fn(),
    appealQueue: jest.fn(),
    appeal: jest.fn(),
    sendAppealMessage: jest.fn(),
    appealMessages: jest.fn(),
    assignAppeal: jest.fn(),
    resolveAppeal: jest.fn(),
  };
  const toApiError = (error: unknown): MockApiError => {
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      return error as MockApiError;
    }
    return {
      message: String(error),
      status: undefined,
      code: 'UNKNOWN',
      body: undefined,
      hint: undefined,
    };
  };
  return {
    api,
    toApiError,
    isInvalidResponseError: (error: unknown) => toApiError(error).code === 'INVALID_RESPONSE',
    ApiError: class MockApiError extends Error {},
    AUTH_SIGN_OUT_EVENT: 'agromoll:auth-sign-out',
    getLastSignOutReason: () => 'expired' as const,
    RESOLVED_API_URL: 'http://localhost:3000',
    isApiConfigured: () => true,
  };
}

/** Форма стора outbox, которую читают экраны. */
export interface OutboxStateMock {
  version: number;
  isOnline: boolean;
  syncing: boolean;
  pendingCount: number;
  overrides: Record<string, { status: string; clientUuid: string }>;
  pendingCreates: Record<
    string,
    {
      listingId: string;
      listingTitle?: string;
      listingUnit?: string;
      requestedQuantity: number;
      createdAt: string;
    }
  >;
  runSync: jest.Mock;
  handleOutboxEvent: jest.Mock;
  refreshQueue: jest.Mock;
}

/** Мок @/store/outbox: селектор zustand поверх плоского объекта. */
export function createOutboxStoreMock(initial: Partial<OutboxStateMock> = {}) {
  const state: OutboxStateMock = {
    version: 0,
    isOnline: true,
    syncing: false,
    pendingCount: 0,
    overrides: {},
    pendingCreates: {},
    runSync: jest.fn(),
    handleOutboxEvent: jest.fn(),
    refreshQueue: jest.fn(),
    ...initial,
  };
  const useOutboxStore = <T>(selector: (s: OutboxStateMock) => T): T => selector(state);
  useOutboxStore.getState = (): OutboxStateMock => state;
  useOutboxStore.setState = (patch: Partial<OutboxStateMock>): void => {
    Object.assign(state, patch);
  };
  return { useOutboxStore };
}

/** Мок @/store/auth: готовый пользователь, без persist. */
export function createAuthStoreMock(
  user: Record<string, unknown> | null = {
    id: 'u-1',
    role: 'buyer',
    displayName: 'Тестовый покупатель',
    phone: '+79610000000',
    phoneVerified: true,
    totalConfirmations: 2,
    totalDisputes: 0,
    createdAt: new Date().toISOString(),
  },
) {
  const state = {
    status: 'ready' as const,
    user,
    signOutNotice: null as string | null,
    bootstrap: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
    changeRole: jest.fn(),
  };
  const useAuthStore = <T>(selector: (s: typeof state) => T): T => selector(state);
  useAuthStore.getState = () => state;
  // Подмена состояния из тестов (роль арбитра и т.п., v0.6.0-C).
  useAuthStore.setState = (patch: Partial<typeof state>): void => {
    Object.assign(state, patch);
  };
  return { useAuthStore };
}

/** Мок @/store/theme: без persist (AsyncStorage не нужен). */
export function createThemeStoreMock() {
  const state = {
    setting: 'system' as const,
    setSetting: jest.fn(),
    toggle: jest.fn(),
  };
  const useThemeStore = <T>(selector: (s: typeof state) => T): T => selector(state);
  return { useThemeStore };
}

/** Стандартный мок expo-router для рендер-тестов. */
export function createRouterMock() {
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
  return {
    useRouter: () => router,
    useLocalSearchParams: () => ({}),
    useSegments: () => [],
    Link: ({ children }: { children: unknown }) => children,
  };
}

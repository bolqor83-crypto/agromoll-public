/**
 * Токены внедрения зависимостей модуля аутентификации (v0.3.0, ADR-007;
 * v0.3.1 — ротация refresh-токенов, ADR-008).
 */

/** Хранилище SMS-кодов (Redis или in-memory fallback). */
export const CODE_STORE = 'CODE_STORE';

/** Хранилище сессий refresh-токенов (Redis или in-memory fallback, v0.3.1). */
export const SESSION_STORE = 'SESSION_STORE';

/** TTL SMS-кода в секундах: 5 минут. */
export const CODE_TTL_SECONDS = 5 * 60;

/** Код-заглушка в dev: фиксированный «0000», логируется, SMS не отправляется. */
export const DEV_CODE = '0000';

/**
 * Дефолты секретов ТОЛЬКО для локальной разработки.
 * В production (NODE_ENV=production) отсутствие JWT_*_SECRET — ошибка старта.
 */
export const DEV_ACCESS_SECRET = 'dev-access-secret-do-not-use-in-prod';
export const DEV_REFRESH_SECRET = 'dev-refresh-secret-do-not-use-in-prod';

/** TTL access-токена: 15 минут (короткоживущий, см. ADR-007). */
export const DEFAULT_ACCESS_TTL = '15m';
/** TTL refresh-токена: 30 дней. */
export const DEFAULT_REFRESH_TTL = '30d';

/** TTL refresh-токена в секундах: 30 дней (TTL Redis-ключей сессий, ADR-008). */
export const DEFAULT_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Код ошибки 401 при обнаружении повторного использования refresh-токена
 * (ротация с детекцией кражи, ADR-008). Мобильный клиент по этому коду
 * мягко выводит пользователя на экран входа.
 */
export const TOKEN_REUSE_DETECTED = 'TOKEN_REUSE_DETECTED';

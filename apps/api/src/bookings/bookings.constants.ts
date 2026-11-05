/**
 * Токены внедрения зависимостей модуля броней.
 */

/** TTL запроса брони в минутах (число). Провайдер читает BOOKING_TTL_MINUTES. */
export const BOOKING_TTL_MINUTES = 'BOOKING_TTL_MINUTES';

/** Значение по умолчанию: 30 минут. Обоснование — docs/adr/ADR-004. */
export const DEFAULT_BOOKING_TTL_MINUTES = 30;

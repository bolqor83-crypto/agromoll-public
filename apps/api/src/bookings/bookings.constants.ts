/**
 * Токены внедрения зависимостей модуля броней.
 */

/** TTL запроса брони в минутах (число). Провайдер читает BOOKING_TTL_MINUTES. */
export const BOOKING_TTL_MINUTES = 'BOOKING_TTL_MINUTES';

/** Значение по умолчанию: 30 минут. Обоснование — docs/adr/ADR-004. */
export const DEFAULT_BOOKING_TTL_MINUTES = 30;

/** Окно авто-подтверждения приёмки в часах (число). ENV (ADR-012). */
export const BOOKING_AUTO_CONFIRM_HOURS = 'BOOKING_AUTO_CONFIRM_HOURS';

/** Значение по умолчанию: 24 часа — защита от «забыл подтвердить». */
export const DEFAULT_BOOKING_AUTO_CONFIRM_HOURS = 24;

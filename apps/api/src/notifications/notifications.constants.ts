/**
 * Константы модуля уведомлений (v0.4.0 → v0.6.0-A, ADR-031).
 */

/** Сервисный аккаунт Firebase (JSON или base64). Отсутствует — FCM-канал выключен. */
export const FCM_SERVICE_ACCOUNT_JSON = 'FCM_SERVICE_ACCOUNT_JSON';

/** Публичный ключ VAPID (Web Push). Отсутствует — web_push-канал выключен. */
export const VAPID_PUBLIC_KEY = 'VAPID_PUBLIC_KEY';

/** Приватный ключ VAPID (Web Push). Только сервер, никогда не коммитится. */
export const VAPID_PRIVATE_KEY = 'VAPID_PRIVATE_KEY';

/** Владелец ключей VAPID: mailto: или https: URL. */
export const VAPID_SUBJECT = 'VAPID_SUBJECT';

/**
 * Максимум попыток доставки push (ADR-031): 1 основная + 2 повтора.
 * Push — вспомогательный канал: дальше логируем failed и не мучаем
 * провайдера бесконечными повторами.
 */
export const PUSH_MAX_ATTEMPTS = 3;

/**
 * База экспоненциальной паузы между попытками: 1000 · 2^(attempt−1),
 * т.е. 1 с → 2 с. In-memory очередь: перезапуск сервера теряет
 * недоставленные push — осознанно (см. ADR-031 «Очередь»).
 */
export const PUSH_RETRY_BASE_MS = 'PUSH_RETRY_BASE_MS';

/** Значение по умолчанию для PUSH_RETRY_BASE_MS — 1 секунда. */
export const DEFAULT_PUSH_RETRY_BASE_MS = 1000;

/** Порог репутации для мягкого уведомления (v0.6.0-A, ADR-031). */
export const REPUTATION_PUSH_THRESHOLD = 3.0;

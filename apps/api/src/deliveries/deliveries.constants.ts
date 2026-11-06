/**
 * Токены внедрения зависимостей модуля доставки (ADR-015).
 */

/** TTL открытого запроса в минутах (ENV DELIVERY_TTL_MINUTES). */
export const DELIVERY_TTL_MINUTES = 'DELIVERY_TTL_MINUTES';

/** Значение по умолчанию: 60 минут — рынок живёт утром, не неделями. */
export const DEFAULT_DELIVERY_TTL_MINUTES = 60;

/** Доменный код 409 при попытке взять заказ заблокированной парой (289-ФЗ). */
export const DELIVERY_PAIR_BLOCKED_CODE = 'DELIVERY_PAIR_BLOCKED';

/**
 * Мягкое сообщение блокировки (как в ADR-011): без «вы нарушили закон»,
 * с путём решения — другой продавец или пауза.
 */
export const DELIVERY_PAIR_BLOCKED_MESSAGE =
  'По закону 289-ФЗ этой паре «водитель — продавец» нужна пауза: ' +
  '60+ часов в месяц 6 месяцев подряд. Возьмите заказ другого продавца или подождите.';

/** Радиус «попутности» для радара: заказ рядом с маршрутом водителя. */
export const DELIVERY_CORRIDOR_MATCH_METERS = 2000;

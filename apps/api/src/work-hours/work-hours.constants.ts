/** Токены внедрения зависимостей модуля учёта часов (ADR-011). */

/** Лимит часов в месяц на пару «водитель — продавец» (число). ENV. */
export const WORK_HOURS_MONTHLY_LIMIT = 'WORK_HOURS_MONTHLY_LIMIT';

/** Значение по умолчанию: 60 часов — порог 289-ФЗ (ADR-011). */
export const DEFAULT_WORK_HOURS_MONTHLY_LIMIT = 60;

/** Сколько месяцев подряд с ≥60 ч образуют «опасную» серию. ENV. */
export const WORK_MONTHS_SERIES = 'WORK_MONTHS_SERIES';

/** Значение по умолчанию: 6 месяцев (ADR-011). */
export const DEFAULT_WORK_MONTHS_SERIES = 6;

/** Доменный код 409-ответа при попытке работать с заблокированной парой. */
export const WORK_PAIR_BLOCKED_CODE = 'WORK_PAIR_BLOCKED';

/**
 * Мягкое сообщение блокировки: без «вы нарушили закон», с объяснением
 * и путём решения (спецификация v0.4.0-B).
 */
export const WORK_PAIR_BLOCKED_MESSAGE =
  'Эта пара достигла лимита 60 часов в месяц 6 месяцев подряд. ' +
  'Закон 289-ФЗ требует паузы. Попробуйте другого продавца или подождите.';

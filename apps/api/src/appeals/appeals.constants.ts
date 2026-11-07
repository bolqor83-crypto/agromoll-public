/**
 * Константы модуля апелляций (v0.6.0-E, ADR-035).
 */

/** Сколько месяцев часов пары отдавать в деталях кейса (доказательство). */
export const APPEAL_MONTHS_TAKE = 12;

/** Активные статусы кейса: блокировка ещё обжалуется. */
export const APPEAL_ACTIVE_STATUSES = ['open', 'under_review'] as const;

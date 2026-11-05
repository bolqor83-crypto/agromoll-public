/** Токены внедрения зависимостей модуля долгов. */

/** Кулдаун напоминаний о долге в часах (число). Провайдер читает ENV. */
export const DEBT_REMINDER_COOLDOWN_HOURS = 'DEBT_REMINDER_COOLDOWN_HOURS';

/** Значение по умолчанию: 24 часа (ADR-010 — не чаще раза в сутки). */
export const DEFAULT_DEBT_REMINDER_COOLDOWN_HOURS = 24;

/** Порог просрочки долга в днях (янтарный акцент, ADR-010). */
export const DEBT_OVERDUE_DAYS = 30;

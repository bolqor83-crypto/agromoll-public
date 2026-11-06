/**
 * Токены внедрения зависимостей модуля геозон (ADR-014).
 */

/** Радиус поиска «рядом» по умолчанию в метрах (ENV DEFAULT_GEO_RADIUS_METERS). */
export const GEO_DEFAULT_RADIUS_METERS = 'GEO_DEFAULT_RADIUS_METERS';

/** Значение по умолчанию: 2 км — рынок большой, но пешком не пройдёшь. */
export const DEFAULT_GEO_RADIUS_METERS_VALUE = 2000;

/** Максимум точек в ответе nearby: лента, а не выгрузка. */
export const GEO_NEARBY_LIMIT = 200;

/** Максимум коридоров в ответе nearby. */
export const GEO_CORRIDORS_LIMIT = 100;

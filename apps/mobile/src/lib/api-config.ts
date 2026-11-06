/**
 * Конфигурация API URL (v0.6.1-0, ADR-022).
 *
 * Хотфикс прода: сборка на Vercel молча ходила на http://localhost:3000
 * (fallback в api.ts) — вне машины разработчика вход был невозможен,
 * приложение жило только в демо-режиме. Правила теперь такие:
 *
 *  - EXPO_PUBLIC_API_URL — единственный источник адреса API.
 *    Expo инлайнит EXPO_PUBLIC_* в бандл на сборке (Metro, web export).
 *  - В dev (__DEV__) без переменной — фолбэк http://localhost:3000:
 *    локальная разработка не требует .env.
 *  - В prod фолбэка НЕТ: не задан адрес — нечего слушать. Приложение
 *    показывает экран «Сервер не настроен» (гейт в app/_layout.tsx),
 *    а не молча стучится в чужой localhost.
 *
 * Чистая функция resolveApiUrl выделена для тестируемости: модульные
 * константы API_URL / IS_API_CONFIGURED вычисляются один раз при
 * импорте (значение вшито в бандл на момент сборки — runtime-смены нет).
 */

/** Фолбэк только для разработки: API поднят рядом (pnpm --filter api dev). */
export const DEV_FALLBACK_URL = 'http://localhost:3000';

export interface ResolveApiUrlInput {
  /** Сырое значение EXPO_PUBLIC_API_URL (может быть undefined или пробелами). */
  url: string | undefined;
  /** Прод (false) или разработка (true). */
  isDev: boolean;
}

/**
 * Возвращает базовый URL API или null, если адрес не настроен.
 * Чистая функция — все сценарии покрыты юнит-тестами.
 */
export function resolveApiUrl({ url, isDev }: ResolveApiUrlInput): string | null {
  const trimmed = url?.trim();
  if (trimmed) {
    // Хвостовые слэши срезаем: эндпоинты в api.ts начинаются с «/»,
    // двойной слэш («...com//auth») ломает часть прокси.
    return trimmed.replace(/\/+$/, '');
  }
  return isDev ? DEV_FALLBACK_URL : null;
}

/** Вычисление при импорте: значение вшито в бандл на сборке. */
export const API_URL: string | null = resolveApiUrl({
  url: process.env.EXPO_PUBLIC_API_URL,
  isDev: typeof __DEV__ !== 'undefined' && __DEV__,
});

/** false → приложение показывает экран «Сервер не настроен» (ADR-022). */
export const IS_API_CONFIGURED: boolean = API_URL !== null;

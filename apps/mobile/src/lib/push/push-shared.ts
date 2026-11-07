/**
 * Общие типы push-регистрации (v0.6.0-A, ADR-031).
 *
 * Отдельный файл: platform-файлы (.ts / .native.ts) не могут импортировать
 * друг друга — с moduleSuffixes ['.web', '.native', ''] импорт
 * './register-push' из .native.ts разрешается в него же (цикл).
 * Shared-модуль без суффикса разрешается одинаково для обеих платформ.
 */

import type { RegisterPushInput } from '@agromoll/types';

/** Результат попытки регистрации: «тихие» отказы — норма (ADR-031). */
export interface RegisterPushResult {
  /** Канал зарегистрирован на сервере. */
  registered: boolean;
  /** Разрешение на уведомления выдано (для баннера «включите»). */
  permissionGranted: boolean;
  /** Причина отказа — в лог/телеметрию, не пользователю. */
  reason?: 'not_supported' | 'no_permission' | 'not_configured' | 'error';
}

/** Разрешение на показ уведомлений (Web-семантика для обеих платформ). */
export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/** Зависимости registerPush: как положить подписку на сервер. */
export interface RegisterPushDeps {
  /** POST /notifications/register (web-подписка или FCM-токен). */
  subscribe: (input: RegisterPushInput) => Promise<unknown>;
  /** Публичный VAPID-ключ сервера (только web; null — не настроен). */
  getVapidKey?: () => Promise<string | null>;
}

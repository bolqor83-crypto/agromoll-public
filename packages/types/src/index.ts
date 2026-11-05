/**
 * Общие типы домена «АгроМолл».
 *
 * Пакет намеренно без зависимостей: его импортируют и api (NestJS),
 * и mobile (Expo), поэтому здесь не должно быть платформенно-специфичного кода.
 */

/** Роли участников рынка. */
export const USER_ROLES = ['buyer', 'seller', 'driver'] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Человекочитаемые названия ролей — для UI. */
export const ROLE_LABELS: Record<UserRole, string> = {
  buyer: 'Покупатель',
  seller: 'Продавец',
  driver: 'Доставщик',
};

/** Ответ healthcheck-эндпоинта API (`GET /health`). */
export interface HealthResponse {
  status: 'ok' | 'error';
  service: string;
  /** ISO-дата ответа. */
  timestamp: string;
  /** Аптайм процесса в секундах. */
  uptimeSec: number;
}

/**
 * Общие типы АгроМолл.
 *
 * Пакет потребляется приложениями напрямую из исходников (main: src/index.ts):
 * Metro (React Native) транспилирует TS сам, поэтому отдельная сборка dist
 * на этом этапе не требуется. Подключение к api (NestJS) — на следующем этапе,
 * вместе с введением dist-сборки пакетов (см. docs/adr/ADR-003-monorepo.md).
 */

/** Роли участников рынка. */
export const ROLES = ['buyer', 'seller', 'driver'] as const;

export type Role = (typeof ROLES)[number];

/** Человекочитаемые названия ролей (язык рынка, не софта). */
export const ROLE_LABELS: Record<Role, string> = {
  buyer: 'Покупатель',
  seller: 'Продавец',
  driver: 'Доставщик',
};

/** Пользователь приложения (согласован с моделью User в apps/api/prisma/schema.prisma). */
export interface AppUser {
  id: string;
  phone: string | null;
  name: string | null;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

/** Ответ healthcheck-эндпоинта api (GET /health). */
export interface HealthCheckResponse {
  status: 'ok' | 'error';
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
}

/** Универсальный конверт ошибок API. */
export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
}

import { z } from 'zod';
import { USER_ROLES } from '@agromoll/types';

/**
 * Пакет-заглушка этапа «фундамент».
 *
 * На следующем этапе здесь появятся схемы броней, заказов, геозон и доставки.
 * Сейчас — только базовые схемы инфраструктуры, чтобы пакеты api и mobile
 * уже могли опираться на единый источник валидации.
 */

/** Роль пользователя. Дублирует enum UserRole из Prisma-схемы (apps/api). */
export const UserRoleSchema = z.enum(USER_ROLES);

/** Переменные окружения API. */
export const apiEnvSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

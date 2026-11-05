import { z } from 'zod';

import { ROLES } from '@agromoll/types';

/**
 * Схемы валидации АгроМолл.
 *
 * Этап 1 (каркас): только универсальные схемы. Бизнес-схемы — заявки, брони,
 * доставки, долги — добавляются на следующих этапах вместе с эндпоинтами.
 */

/** Роль участника рынка. */
export const roleSchema = z.enum(ROLES);
export type RoleInput = z.infer<typeof roleSchema>;

/** Пагинация для списков (прайсы, заявки, доставки). */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

/** Идентификатор сущности (uuid). */
export const idSchema = z.string().uuid();

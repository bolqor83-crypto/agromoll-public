/**
 * Типы аутентификации v0.3.0: телефон + SMS-код → JWT (см. ADR-007).
 *
 * Access-токен (15 минут) ходит в заголовке Authorization: Bearer …
 * на каждый запрос. Refresh-токен (30 дней) — только в /auth/refresh.
 * payload обоих токенов одинаков: id пользователя + роль на момент выпуска.
 * Роль в токене может устареть (смена роли), поэтому JwtAuthGuard
 * всё равно перечитывает пользователя из БД — токен лишь доказывает
 * владение номером телефона.
 */
import type { UserRole } from '@agromoll/types';

/** Пользователь, прошедший аутентификацию (прикрепляется к request.user). */
export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  displayName: string;
  /** E.164-телефон подтверждённого аккаунта. */
  phone: string | null;
}

/** Payload JWT (access и refresh). */
export interface JwtPayload {
  sub: string;
  role: UserRole;
}

/**
 * Типы аутентификации v0.3.0/v0.3.1: телефон + SMS-код → JWT (ADR-007/008).
 *
 * Access-токен (15 минут) ходит в заголовке Authorization: Bearer …
 * на каждый запрос. Refresh-токен (30 дней) — только в /auth/refresh.
 * payload обоих токенов: id пользователя + роль на момент выпуска.
 * Роль в токене может устареть (смена роли), поэтому JwtAuthGuard
 * всё равно перечитывает пользователя из БД — токен лишь доказывает
 * владение номером телефона.
 *
 * v0.3.1: каждый токен несёт jti (уникальный id для ротации/блэклиста)
 * и familyId («семья» refresh-токенов одного входа, ADR-008).
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

/** Данные JWT-токена, прикрепляемые guard'ом к request.auth (v0.3.1). */
export interface TokenAuthContext {
  /** jti access-токена — для блэклиста после logout. */
  jti?: string;
  /** Семья refresh-токенов, к которой принадлежит access-токен. */
  familyId?: string;
}

/** Payload JWT (access и refresh). */
export interface JwtPayload {
  sub: string;
  role: UserRole;
  /** Уникальный id токена (v0.3.1): ротация refresh и блэклист access. */
  jti?: string;
  /** Семья refresh-токенов (v0.3.1). Есть в обоих токенах. */
  familyId?: string;
}

/** Метаданные входа для аудит-записи сессии (userAgent, IP). */
export interface LoginMeta {
  userAgent?: string;
  ip?: string;
}

import { create } from 'zustand';
import type { UserRole } from '@agromoll/types';
import { DEMO_ACCOUNTS } from '@agromoll/types';

/**
 * Выбранная роль пользователя (v0.2.0).
 *
 * Пока аутентификация — заглушка X-User-Id: роль определяет демо-аккаунт,
 * id которого уходит в заголовок (см. ADR-004). С настоящим входом
 * (телефон + JWT) роль будет приходить с сервера.
 */
interface RoleState {
  role: UserRole | null;
  setRole: (role: UserRole) => void;
}

export const useRoleStore = create<RoleState>((set) => ({
  role: null,
  setRole: (role) => set({ role }),
}));

/** Демо-пользователь текущей роли (id для X-User-Id). */
export function demoUserId(role: UserRole): string {
  return DEMO_ACCOUNTS[role].id;
}

/** Имя демо-пользователя роли — для подписей на экранах. */
export function demoUserName(role: UserRole): string {
  return DEMO_ACCOUNTS[role].displayName;
}

/**
 * Состояние аутентификации (v0.3.0): профиль + сессия.
 *
 * Статусы:
 *  - booting          — проверяем refresh-токен при старте (сплэш);
 *  - unauthenticated  — токенов нет или refresh не удался → экран входа;
 *  - authenticated    — есть профиль с сервера.
 *
 * Роль хранится ТОЛЬКО здесь (user.role с сервера): локальный role-store
 * v0.2.0 удалён — после входа роль единым источником приходит с сервера.
 * Смена роли = PATCH /users/me/role, экраны перечитывают store.
 */
import { create } from 'zustand';
import type { UserDto, UserRole } from '@agromoll/types';
import { api } from '@/lib/api';
import { AUTH_SIGN_OUT_EVENT, toApiError } from '@/lib/api';
import { tokenStore } from '@/lib/token-store';
import { logger } from '@/lib/logger';

export type AuthStatus = 'booting' | 'unauthenticated' | 'authenticated';

interface AuthState {
  status: AuthStatus;
  user: UserDto | null;
  /** При старте: refresh → профиль. Вызывается один раз из root layout. */
  bootstrap: () => Promise<void>;
  /** После успешного verify: сохранить токены и профиль. */
  signIn: (auth: { accessToken: string; refreshToken: string; user: UserDto }) => Promise<void>;
  /** Выйти: очистить токены и профиль (плюс локальную БД — см. outbox). */
  signOut: () => Promise<void>;
  /** Сменить роль на сервере и в сторе. */
  changeRole: (role: UserRole) => Promise<void>;
  /** Событие от axios-interceptor: сессия сгорела (refresh не удался). */
  handleForcedSignOut: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'booting',
  user: null,

  bootstrap: async () => {
    try {
      const refreshToken = await tokenStore.getRefreshToken();
      if (!refreshToken) {
        set({ status: 'unauthenticated', user: null });
        return;
      }
      const refreshed = await api.refresh(refreshToken);
      await tokenStore.setTokens(refreshed.accessToken);
      const user = await api.me();
      set({ status: 'authenticated', user });
      logger.info('auth', 'сессия восстановлена', { userId: user.id, role: user.role });
    } catch (error) {
      const apiError = toApiError(error);
      logger.warn('auth', 'восстановление сессии не удалось', { error: apiError.message });
      await tokenStore.clear();
      set({ status: 'unauthenticated', user: null });
    }
  },

  signIn: async (auth) => {
    await tokenStore.setTokens(auth.accessToken, auth.refreshToken);
    set({ status: 'authenticated', user: auth.user });
    logger.info('auth', 'вход выполнен', { userId: auth.user.id, role: auth.user.role });
  },

  signOut: async () => {
    await tokenStore.clear();
    set({ status: 'unauthenticated', user: null });
    logger.info('auth', 'выход выполнен');
  },

  changeRole: async (role) => {
    const user = await api.updateRole(role);
    set({ user });
    logger.info('auth', 'роль изменена', { role });
  },

  handleForcedSignOut: () => {
    if (get().status === 'authenticated') {
      logger.warn('auth', 'сессия сгорела (refresh не удался) — выходим');
      set({ status: 'unauthenticated', user: null });
    }
  },
}));

/** Подписка на событие «сессия сгорела» от axios-интерцептора. */
export function listenForcedSignOut(): () => void {
  const handler = (): void => {
    useAuthStore.getState().handleForcedSignOut();
  };
  (globalThis as { addEventListener?: (t: string, h: () => void) => void }).addEventListener?.(
    AUTH_SIGN_OUT_EVENT,
    handler,
  );
  return () => {
    (globalThis as { removeEventListener?: (t: string, h: () => void) => void })?.removeEventListener?.(
      AUTH_SIGN_OUT_EVENT,
      handler,
    );
  };
}

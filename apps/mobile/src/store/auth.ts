/**
 * Состояние аутентификации (v0.3.0/v0.3.1): профиль + сессия.
 *
 * Статусы:
 *  - booting          — проверяем refresh-токен при старте (сплэш);
 *  - unauthenticated  — токенов нет или refresh не удался → экран входа;
 *  - authenticated    — есть профиль с сервера.
 *
 * Роль хранится ТОЛЬКО здесь (user.role с сервера): локальный role-store
 * v0.2.0 удалён — после входа роль единым источником приходит с сервера.
 * Смена роли = PATCH /users/me/role, экраны перечитывают store.
 *
 * v0.3.1 (ADR-008): signOut сначала вызывает POST /auth/logout (отзыв
 * семьи на сервере, best-effort), затем чистит локальное. Принудительный
 * выход (401 TOKEN_REUSE_DETECTED / истёкший refresh) показывает мягкое
 * сообщение «Сессия завершена. Войдите снова» на экране входа.
 */
import { create } from 'zustand';
import type { UserDto, UserRole } from '@agromoll/types';
import { api } from '@/lib/api';
import { AUTH_SIGN_OUT_EVENT, getLastSignOutReason, toApiError } from '@/lib/api';
import { tokenStore } from '@/lib/token-store';
import { logger } from '@/lib/logger';
import { getOutbox } from '@/lib/outbox/outbox-instance';
import { useOutboxStore } from '@/store/outbox';

export type AuthStatus = 'booting' | 'unauthenticated' | 'authenticated';

/** Мягкое сообщение о принудительном завершении сессии (без слова «кража»). */
export const SESSION_ENDED_NOTICE = 'Сессия завершена. Войдите снова';

interface AuthState {
  status: AuthStatus;
  user: UserDto | null;
  /**
   * Сообщение на экране входа, если сессию завершил сервер
   * (ротация обнаружила повторное использование refresh-токена).
   * Сбрасывается при успешном входе.
   */
  signOutNotice: string | null;
  /** При старте: refresh → профиль. Вызывается один раз из root layout. */
  bootstrap: () => Promise<void>;
  /** После успешного verify: сохранить токены и профиль. */
  signIn: (auth: { accessToken: string; refreshToken: string; user: UserDto }) => Promise<void>;
  /** Выйти: отзыв на сервере + очистить токены, профиль и локальную БД. */
  signOut: () => Promise<void>;
  /** Сменить роль на сервере и в сторе. */
  changeRole: (role: UserRole) => Promise<void>;
  /** Событие от axios-interceptor: сессия сгорела (refresh не удался). */
  handleForcedSignOut: () => void;
}

/** Локальная очистка: токены + outbox (очередь и оптимистичные состояния). */
async function clearLocalSession(): Promise<void> {
  await tokenStore.clear();
  // Критично (ADR-006): локальная очередь и оптимистичные состояния
  // очищаются — операции одного пользователя не утекают в сессию другого.
  try {
    const outbox = await getOutbox();
    await outbox.clearAll();
  } catch (error) {
    logger.warn('auth', 'не удалось очистить локальную очередь при выходе', {
      error: String(error),
    });
  }
  useOutboxStore.setState({
    queue: [],
    pendingCount: 0,
    pendingCreates: {},
    overrides: {},
    conflictedOperation: null,
    version: 0,
  });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'booting',
  user: null,
  signOutNotice: null,

  bootstrap: async () => {
    try {
      const refreshToken = await tokenStore.getRefreshToken();
      if (!refreshToken) {
        set({ status: 'unauthenticated', user: null });
        return;
      }
      // Ротация (v0.3.1): сервер возвращает новую пару — сохраняем оба.
      const refreshed = await api.refresh(refreshToken);
      await tokenStore.setTokens(refreshed.accessToken, refreshed.refreshToken);
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
    set({ status: 'authenticated', user: auth.user, signOutNotice: null });
    logger.info('auth', 'вход выполнен', { userId: auth.user.id, role: auth.user.role });
  },

  signOut: async () => {
    // v0.3.1: сначала отзыв семьи на сервере (пока токены ещё на месте),
    // затем локальная очистка. Best-effort на обоих уровнях: api.logout
    // глотает ошибки сети, а стор — любые другие, чтобы выход не «застревал».
    const refreshToken = await tokenStore.getRefreshToken();
    if (refreshToken) {
      const accessToken = await tokenStore.getAccessToken();
      try {
        await api.logout(refreshToken, accessToken ?? undefined);
      } catch (error) {
        logger.warn('auth', 'logout на сервере не удался (продолжаем локальный выход)', {
          error: toApiError(error).message,
        });
      }
    }
    await clearLocalSession();
    set({ status: 'unauthenticated', user: null, signOutNotice: null });
    logger.info('auth', 'выход выполнен');
  },

  changeRole: async (role) => {
    const user = await api.updateRole(role);
    set({ user });
    logger.info('auth', 'роль изменена', { role });
  },

  handleForcedSignOut: () => {
    const reuse = getLastSignOutReason() === 'reuse';
    if (get().status === 'authenticated') {
      logger.warn(
        'auth',
        reuse
          ? 'сессия завершена сервером (повторное использование refresh-токена) — выходим'
          : 'сессия сгорела (refresh не удался) — выходим',
      );
      // UI уходит на вход сразу; локальная чистка (токены, outbox) — в фоне.
      set({
        status: 'unauthenticated',
        user: null,
        signOutNotice: reuse ? SESSION_ENDED_NOTICE : null,
      });
      void clearLocalSession();
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
    (
      globalThis as { removeEventListener?: (t: string, h: () => void) => void }
    )?.removeEventListener?.(AUTH_SIGN_OUT_EVENT, handler);
  };
}

/**
 * Тесты auth-store (v0.3.0/v0.3.1): bootstrap, signIn, signOut (отзыв
 * на сервере), changeRole, принудительный выход с причиной.
 * api и secure store замоканы (моки достаются из самих модулей —
 * стандартный паттерн против hoisting).
 */
import type { UserDto } from '@agromoll/types';

jest.mock('expo-secure-store', () => {
  const storage = new Map<string, string>();
  return {
    getItemAsync: (key: string) => Promise.resolve(storage.get(key) ?? null),
    setItemAsync: (key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    },
    deleteItemAsync: (key: string) => {
      storage.delete(key);
      return Promise.resolve();
    },
    __storage: storage,
  };
});

jest.mock('@/lib/api', () => ({
  api: {
    refresh: jest.fn(),
    logout: jest.fn(),
    me: jest.fn(),
    updateRole: jest.fn(),
  },
  toApiError: (error: unknown) => ({
    message: String(error),
    status: undefined,
    code: 'UNKNOWN',
    body: undefined,
    hint: undefined,
  }),
  AUTH_SIGN_OUT_EVENT: 'agromoll:auth-sign-out',
  getLastSignOutReason: jest.fn(() => 'expired'),
}));

// eslint-disable-next-line import/first -- моки должны объявиться до импорта стора
import { api } from '@/lib/api';
// eslint-disable-next-line import/first
import { useAuthStore } from './auth';

const mockApi = api as unknown as {
  refresh: jest.Mock;
  logout: jest.Mock;
  me: jest.Mock;
  updateRole: jest.Mock;
};

const USER: UserDto = {
  id: 'u-1',
  role: 'buyer',
  displayName: 'Ларёк «У Ашота»',
  phone: '+79611234567',
  phoneVerified: true,
  createdAt: new Date().toISOString(),
};

function resetStore(): void {
  useAuthStore.setState({ status: 'booting', user: null, signOutNotice: null });
}

describe('auth-store', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    resetStore();
  });

  describe('bootstrap', () => {
    it('нет refresh-токена → unauthenticated', async () => {
      await useAuthStore.getState().bootstrap();
      expect(useAuthStore.getState().status).toBe('unauthenticated');
    });

    it('refresh-токен есть, refresh успешен → authenticated + профиль + новая пара сохранена', async () => {
      // положим refresh-токен в мок secure store
      const secure = jest.requireMock('expo-secure-store') as {
        __storage: Map<string, string>;
      };
      secure.__storage.set('agromoll.refreshToken', 'refresh-token');

      // v0.3.1: ротация возвращает ПАРУ токенов
      mockApi.refresh.mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' });
      mockApi.me.mockResolvedValue(USER);

      await useAuthStore.getState().bootstrap();

      const state = useAuthStore.getState();
      expect(state.status).toBe('authenticated');
      expect(state.user).toEqual(USER);
      // оба токена ротированы и сохранены
      expect(secure.__storage.get('agromoll.accessToken')).toBe('new-access');
      expect(secure.__storage.get('agromoll.refreshToken')).toBe('new-refresh');
    });

    it('refresh не удался → unauthenticated и токены стёрты', async () => {
      const secure = jest.requireMock('expo-secure-store') as {
        __storage: Map<string, string>;
      };
      secure.__storage.set('agromoll.refreshToken', 'expired-refresh');
      mockApi.refresh.mockRejectedValue(new Error('401'));

      await useAuthStore.getState().bootstrap();

      expect(useAuthStore.getState().status).toBe('unauthenticated');
      expect(secure.__storage.has('agromoll.refreshToken')).toBe(false);
      expect(secure.__storage.has('agromoll.accessToken')).toBe(false);
    });
  });

  describe('signIn / signOut', () => {
    it('signIn сохраняет токены и профиль', async () => {
      await useAuthStore.getState().signIn({
        accessToken: 'a-1',
        refreshToken: 'r-1',
        user: USER,
      });

      const state = useAuthStore.getState();
      expect(state.status).toBe('authenticated');
      expect(state.user?.id).toBe('u-1');

      const secure = jest.requireMock('expo-secure-store') as {
        __storage: Map<string, string>;
      };
      expect(secure.__storage.get('agromoll.accessToken')).toBe('a-1');
      expect(secure.__storage.get('agromoll.refreshToken')).toBe('r-1');
    });

    it('signOut сначала отзывает сессию на сервере, затем чистит локально', async () => {
      await useAuthStore.getState().signIn({
        accessToken: 'a-1',
        refreshToken: 'r-1',
        user: USER,
      });
      mockApi.logout.mockResolvedValue(undefined);

      await useAuthStore.getState().signOut();

      // отзыв на сервере — с обоими токенами (блэклист access)
      expect(mockApi.logout).toHaveBeenCalledWith('r-1', 'a-1');

      const state = useAuthStore.getState();
      expect(state.status).toBe('unauthenticated');
      expect(state.user).toBeNull();

      const secure = jest.requireMock('expo-secure-store') as {
        __storage: Map<string, string>;
      };
      expect(secure.__storage.size).toBe(0);
    });

    it('сбой logout на сервере не блокирует локальный выход (best-effort)', async () => {
      await useAuthStore.getState().signIn({
        accessToken: 'a-1',
        refreshToken: 'r-1',
        user: USER,
      });
      // api.logout в реале сам глотает ошибки; здесь — мок-реджект,
      // чтобы проверить: даже при реджекте стор не падает
      mockApi.logout.mockRejectedValue(new Error('network'));

      await expect(useAuthStore.getState().signOut()).resolves.toBeUndefined();
      expect(useAuthStore.getState().status).toBe('unauthenticated');
    });

    it('без refresh-токена logout на сервере не вызывается', async () => {
      await useAuthStore.getState().signIn({
        accessToken: 'a-1',
        refreshToken: 'r-1',
        user: USER,
      });
      const secure = jest.requireMock('expo-secure-store') as {
        __storage: Map<string, string>;
      };
      secure.__storage.delete('agromoll.refreshToken');

      await useAuthStore.getState().signOut();

      expect(mockApi.logout).not.toHaveBeenCalled();
    });
  });

  describe('changeRole', () => {
    it('обновляет роль на сервере и в сторе', async () => {
      mockApi.updateRole.mockResolvedValue({ ...USER, role: 'seller' });

      await useAuthStore.getState().changeRole('seller');

      expect(mockApi.updateRole).toHaveBeenCalledWith('seller');
      expect(useAuthStore.getState().user?.role).toBe('seller');
    });
  });

  describe('handleForcedSignOut', () => {
    it('в authenticated выходит из сессии, в остальных — нет', () => {
      useAuthStore.setState({ status: 'authenticated', user: USER });
      useAuthStore.getState().handleForcedSignOut();
      expect(useAuthStore.getState().status).toBe('unauthenticated');

      resetStore();
      useAuthStore.getState().handleForcedSignOut();
      expect(useAuthStore.getState().status).toBe('booting');
    });

    it('обычный сброс refresh — без сообщения, повторное использование — мягкое «Сессия завершена»', async () => {
      // причина читается из api-модуля (getLastSignOutReason)
      const apiModule = jest.requireMock('@/lib/api') as unknown as {
        getLastSignOutReason: jest.Mock;
      };

      useAuthStore.setState({ status: 'authenticated', user: USER });
      apiModule.getLastSignOutReason.mockReturnValue('expired');
      useAuthStore.getState().handleForcedSignOut();
      expect(useAuthStore.getState().signOutNotice).toBeNull();

      useAuthStore.setState({ status: 'authenticated', user: USER });
      apiModule.getLastSignOutReason.mockReturnValue('reuse');
      useAuthStore.getState().handleForcedSignOut();
      expect(useAuthStore.getState().signOutNotice).toBe('Сессия завершена. Войдите снова');
    });

    it('signIn сбрасывает signOutNotice', async () => {
      useAuthStore.setState({ status: 'unauthenticated', user: null, signOutNotice: 'Сессия завершена. Войдите снова' });
      await useAuthStore.getState().signIn({
        accessToken: 'a-1',
        refreshToken: 'r-1',
        user: USER,
      });
      expect(useAuthStore.getState().signOutNotice).toBeNull();
    });
  });
});

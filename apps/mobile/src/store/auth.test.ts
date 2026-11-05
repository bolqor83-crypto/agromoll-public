/**
 * Тесты auth-store (v0.3.0): bootstrap, signIn, signOut, changeRole.
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
}));

// eslint-disable-next-line import/first -- моки должны объявиться до импорта стора
import { api } from '@/lib/api';
// eslint-disable-next-line import/first
import { useAuthStore } from './auth';

const mockApi = api as unknown as {
  refresh: jest.Mock;
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
  useAuthStore.setState({ status: 'booting', user: null });
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

    it('refresh-токен есть, refresh успешен → authenticated + профиль', async () => {
      // положим refresh-токен в мок secure store
      const secure = jest.requireMock('expo-secure-store') as {
        __storage: Map<string, string>;
      };
      secure.__storage.set('agromoll.refreshToken', 'refresh-token');

      mockApi.refresh.mockResolvedValue({ accessToken: 'new-access' });
      mockApi.me.mockResolvedValue(USER);

      await useAuthStore.getState().bootstrap();

      const state = useAuthStore.getState();
      expect(state.status).toBe('authenticated');
      expect(state.user).toEqual(USER);
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

    it('signOut очищает всё', async () => {
      await useAuthStore.getState().signIn({
        accessToken: 'a-1',
        refreshToken: 'r-1',
        user: USER,
      });
      await useAuthStore.getState().signOut();

      const state = useAuthStore.getState();
      expect(state.status).toBe('unauthenticated');
      expect(state.user).toBeNull();

      const secure = jest.requireMock('expo-secure-store') as {
        __storage: Map<string, string>;
      };
      expect(secure.__storage.size).toBe(0);
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
  });
});

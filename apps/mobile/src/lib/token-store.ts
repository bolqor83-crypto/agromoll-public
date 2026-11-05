/**
 * Хранилище JWT-токенов (v0.3.0, ADR-007).
 *
 * expo-secure-store: на iOS — Keychain, на Android — EncryptedSharedPreferences.
 * Access-токен тоже лежит в secure store: утечка access-токена через backup
 * или лок файла недопустима, разница в частоте обращений не критична.
 *
 * Все функции безопасно вызывать параллельно: secure-store сам сериализует
 * доступ. Значения — строки (JSON-токены), ключи фиксированные.
 */
import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'agromoll.accessToken';
const REFRESH_KEY = 'agromoll.refreshToken';

export const tokenStore = {
  async getAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS_KEY);
  },

  async getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_KEY);
  },

  async setTokens(accessToken: string, refreshToken?: string): Promise<void> {
    await SecureStore.setItemAsync(ACCESS_KEY, accessToken);
    if (refreshToken !== undefined) {
      await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
    }
  },

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(ACCESS_KEY).catch(() => undefined);
    await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined);
  },
};

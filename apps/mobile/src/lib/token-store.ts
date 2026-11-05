/**
 * Хранилище JWT-токенов (v0.3.0, ADR-007).
 *
 * Нативные платформы: expo-secure-store (iOS — Keychain, Android —
 * EncryptedSharedPreferences). Web: expo-secure-store в SDK 52 не имеет
 * web-реализации, поэтому токены живут в localStorage — web-версия
 * считается демо-платформой (как и localStorage-outbox, см. ADR-006).
 *
 * Все функции безопасно вызывать параллельно. Ключи фиксированные.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'agromoll.accessToken';
const REFRESH_KEY = 'agromoll.refreshToken';

const isWeb = Platform.OS === 'web';

function webGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function webSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // приватный режим/переполнение — на web-демо приемлемо
  }
}

function webDelete(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // игнорируем
  }
}

export const tokenStore = {
  async getAccessToken(): Promise<string | null> {
    return isWeb ? webGet(ACCESS_KEY) : SecureStore.getItemAsync(ACCESS_KEY);
  },

  async getRefreshToken(): Promise<string | null> {
    return isWeb ? webGet(REFRESH_KEY) : SecureStore.getItemAsync(REFRESH_KEY);
  },

  async setTokens(accessToken: string, refreshToken?: string): Promise<void> {
    if (isWeb) {
      webSet(ACCESS_KEY, accessToken);
      if (refreshToken !== undefined) {
        webSet(REFRESH_KEY, refreshToken);
      }
      return;
    }
    await SecureStore.setItemAsync(ACCESS_KEY, accessToken);
    if (refreshToken !== undefined) {
      await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
    }
  },

  async clear(): Promise<void> {
    if (isWeb) {
      webDelete(ACCESS_KEY);
      webDelete(REFRESH_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(ACCESS_KEY).catch(() => undefined);
    await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined);
  },
};

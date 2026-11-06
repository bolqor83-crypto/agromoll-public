/**
 * Хранилище настроек приложения (v0.6.1-B, ADR-024).
 *
 * Адаптер для zustand-persist: native — AsyncStorage (стандартный
 * небезопасный key-value — тема не секрет), web — localStorage
 * (как токены и outbox, см. ADR-006/007: web — демо-платформа).
 *
 * Оба API удовлетворяют интерфейсу StateStorage zustand: sync на web,
 * async на native — createJSONStorage поддерживает оба.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateStorage } from 'zustand/middleware';

const isWeb = Platform.OS === 'web';

export const preferencesStorage: StateStorage = {
  getItem: (name) => {
    if (isWeb) {
      try {
        return globalThis.localStorage?.getItem(name) ?? null;
      } catch {
        return null;
      }
    }
    return AsyncStorage.getItem(name);
  },
  setItem: (name, value) => {
    if (isWeb) {
      try {
        globalThis.localStorage?.setItem(name, value);
      } catch {
        // приватный режим — настройка не переживёт перезагрузку, не критично
      }
      return;
    }
    return AsyncStorage.setItem(name, value);
  },
  removeItem: (name) => {
    if (isWeb) {
      try {
        globalThis.localStorage?.removeItem(name);
      } catch {
        // игнорируем
      }
      return;
    }
    return AsyncStorage.removeItem(name);
  },
};

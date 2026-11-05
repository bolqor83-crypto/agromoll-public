import { create } from 'zustand';

import type { ThemePreference } from '@agromoll/ui';

interface SettingsState {
  /** Предпочтение темы. По умолчанию — следовать системе (работа начинается в 4:00, в темноте). */
  themeMode: ThemePreference;
  setThemeMode: (mode: ThemePreference) => void;
}

/**
 * Настройки приложения (тема). Zustand — без бойлерплейта.
 * Персистентность (AsyncStorage) — следующий этап.
 */
export const useSettingsStore = create<SettingsState>()((set) => ({
  themeMode: 'system',
  setThemeMode: (mode) => set({ themeMode: mode }),
}));

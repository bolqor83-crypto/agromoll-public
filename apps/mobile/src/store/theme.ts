import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ThemeSetting } from '@agromoll/ui';
import { preferencesStorage } from '@/lib/preferences-storage';

/**
 * Настройка темы приложения (zustand — по стеку, см. ADR-001).
 * Значение прокидывается в ThemeProvider из @agromoll/ui.
 *
 * v0.6.1-B (ADR-024): выбор персистится (native — AsyncStorage, web —
 * localStorage через preferencesStorage). При старте: сохранённый выбор
 * важнее системной схемы; «system» — просто сохранённое значение по
 * умолчанию. Тумблер сохраняет выбор мгновенно (persist-мидлвэра
 * пишет на каждое set).
 */
interface ThemeState {
  setting: ThemeSetting;
  setSetting: (setting: ThemeSetting) => void;
  /** Переключает между явными light/dark на основе текущего фактического режима. */
  toggle: (mode: 'light' | 'dark') => void;
}

/** Ключ персиста — единый префикс с токенами (agromoll.*). */
const THEME_STORAGE_KEY = 'agromoll.theme';

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      setting: 'system',
      setSetting: (setting) => set({ setting }),
      toggle: (mode) => set({ setting: mode === 'dark' ? 'light' : 'dark' }),
    }),
    {
      name: THEME_STORAGE_KEY,
      storage: createJSONStorage(() => preferencesStorage),
      version: 1,
    },
  ),
);

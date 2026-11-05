import { create } from 'zustand';
import type { ThemeSetting } from '@agromoll/ui';

/**
 * Настройка темы приложения (zustand — по стеку, см. ADR-001).
 * Значение прокидывается в ThemeProvider из @agromoll/ui.
 * На следующем этапе настройка будет сохраняться в AsyncStorage.
 */
interface ThemeState {
  setting: ThemeSetting;
  setSetting: (setting: ThemeSetting) => void;
  /** Переключает между явными light/dark на основе текущего фактического режима. */
  toggle: (mode: 'light' | 'dark') => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  setting: 'system',
  setSetting: (setting) => set({ setting }),
  toggle: (mode) => set({ setting: mode === 'dark' ? 'light' : 'dark' }),
}));

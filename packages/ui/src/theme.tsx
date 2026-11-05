/**
 * ThemeProvider — контекст темы «АгроМолл».
 *
 * Поддерживает два режима использования:
 * 1. Неконтролируемый: <ThemeProvider initialSetting="system"> хранит состояние внутри.
 * 2. Контролируемый:   <ThemeProvider setting={...} onSettingChange={...}> —
 *    состояние живёт в приложении (например, в zustand-сторе apps/mobile).
 */
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { palette, resolveTheme } from './tokens';
import type { ThemeColors, ThemeMode, ThemeSetting } from './tokens';

export interface ThemeContextValue {
  /** Что выбрал пользователь: light / dark / system. */
  setting: ThemeSetting;
  /** Фактический режим с учётом системной темы. */
  mode: ThemeMode;
  colors: ThemeColors;
  setSetting: (setting: ThemeSetting) => void;
  /** Переключает между явными light/dark. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  children: ReactNode;
  /** Контролируемая настройка темы (например, из zustand-стора приложения). */
  setting?: ThemeSetting;
  onSettingChange?: (setting: ThemeSetting) => void;
  /** Стартовая настройка в неконтролируемом режиме. */
  initialSetting?: ThemeSetting;
}

export function ThemeProvider({
  children,
  setting: settingProp,
  onSettingChange,
  initialSetting = 'system',
}: ThemeProviderProps) {
  const [internalSetting, setInternalSetting] = useState<ThemeSetting>(initialSetting);
  const system = useColorScheme();

  const setting = settingProp ?? internalSetting;
  const mode = resolveTheme(setting, system);

  const value = useMemo<ThemeContextValue>(() => {
    const apply = (next: ThemeSetting) => {
      onSettingChange?.(next);
      if (!settingProp) {
        setInternalSetting(next);
      }
    };
    return {
      setting,
      mode,
      colors: palette[mode],
      setSetting: apply,
      toggle: () => apply(mode === 'dark' ? 'light' : 'dark'),
    };
  }, [setting, mode, settingProp, onSettingChange]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Доступ к текущей теме. Работает только внутри <ThemeProvider>. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme должен использоваться внутри <ThemeProvider>');
  }
  return ctx;
}

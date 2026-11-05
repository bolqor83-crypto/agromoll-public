import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import {
  colors,
  motion,
  radius,
  shadows,
  spacing,
  typography,
} from '../tokens';
import type { ColorTokens, ShadowTokens } from '../tokens';

export type ThemeMode = 'light' | 'dark';
/** Предпочтение темы: следовать системе или заданная явно. */
export type ThemePreference = 'system' | ThemeMode;

export interface Theme {
  mode: ThemeMode;
  colors: ColorTokens;
  spacing: typeof spacing;
  radius: typeof radius;
  motion: typeof motion;
  typography: typeof typography;
  shadows: ShadowTokens;
}

const ThemeContext = createContext<Theme | null>(null);

interface ThemeProviderProps {
  /** Режим темы. 'system' следует за настройками устройства. */
  mode?: ThemePreference;
  children: React.ReactNode;
}

export function ThemeProvider({ mode = 'system', children }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const resolved: ThemeMode =
    mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;

  const value = useMemo<Theme>(
    () => ({
      mode: resolved,
      colors: colors[resolved],
      spacing,
      radius,
      motion,
      typography,
      shadows: shadows[resolved],
    }),
    [resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme должен вызываться внутри <ThemeProvider>');
  }
  return theme;
}

/**
 * useResponsive — адаптивные breakpoint'ы (v0.6.2-D, ADR-030).
 *
 * Планшет ≥768 — двухколоночная лента/витрина; широкий телефон ≥430 —
 * контентная колонка ограничена 600 px и центрирована (аудит №15/№16).
 * Единый источник breakpoints — токен responsive (tokens.ts).
 */
import { useWindowDimensions } from 'react-native';
import { responsive } from '../tokens';

export interface ResponsiveState {
  /** Текущая ширина окна, px. */
  width: number;
  /** Планшет: лента/витрина в 2 колонки. */
  isTablet: boolean;
  /** Широкий телефон: включаем ограничение контентной колонки. */
  isWidePhone: boolean;
  /** Сколько колонок в сетках карточек (2 на планшете, иначе 1). */
  cardColumns: 1 | 2;
}

export function useResponsive(): ResponsiveState {
  const { width } = useWindowDimensions();
  const isTablet = width >= responsive.tabletMinWidth;
  return {
    width,
    isTablet,
    isWidePhone: width >= responsive.widePhoneMinWidth,
    cardColumns: isTablet ? 2 : 1,
  };
}

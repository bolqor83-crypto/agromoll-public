/**
 * Icon — единая обёртка над Ionicons (line-style, outline).
 *
 * Правила (ADR-002): линейные иконки outline, размер 24 px, цвет —
 * из токенов темы. Никаких разноцветных наборов иконок.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { useTheme } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Смысловые цвета иконок — те же, что у Text. */
export type IconColor =
  | 'text'
  | 'secondary'
  | 'muted'
  | 'primary'
  | 'accent'
  | 'warning'
  | 'onWarning'
  | 'onPrimary'
  | 'inverse';

export interface IconProps {
  name: IconName;
  /** По умолчанию 24 px — единый размер всей системы. */
  size?: number;
  /** Семантический цвет из темы. */
  color?: IconColor;
  /** Явный цвет (для иллюстраций). Имеет приоритет над color. */
  tint?: string;
  accessibilityLabel?: string;
}

const COLOR_ACCESSORS: Record<
  IconColor,
  (colors: ReturnType<typeof useTheme>['colors']) => string
> = {
  text: (c) => c.text,
  secondary: (c) => c.textSecondary,
  muted: (c) => c.textMuted,
  primary: (c) => c.primary,
  accent: (c) => c.accent,
  warning: (c) => c.warning,
  onWarning: (c) => c.onWarning,
  onPrimary: (c) => c.onPrimary,
  inverse: (c) => c.surface,
};

export function Icon({
  name,
  size = 24,
  color = 'secondary',
  tint,
  accessibilityLabel,
}: IconProps) {
  const { colors } = useTheme();
  const resolved = tint ?? COLOR_ACCESSORS[color](colors);
  return (
    <Ionicons
      name={name}
      size={size}
      color={resolved}
      accessibilityLabel={accessibilityLabel}
      aria-label={accessibilityLabel}
    />
  );
}

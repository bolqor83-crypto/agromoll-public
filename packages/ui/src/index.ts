/**
 * @agromoll/ui — дизайн-система АгроМолл.
 *
 * Потребляется приложением mobile напрямую из исходников (Metro транспилирует TS).
 * Все компоненты поддерживают светлую и тёмную темы через ThemeProvider/useTheme.
 */
export { ThemeProvider, useTheme } from './theme/ThemeContext';
export type { Theme, ThemeMode, ThemePreference } from './theme/ThemeContext';

export {
  colors,
  darkColors,
  lightColors,
  motion,
  radius,
  shadows,
  spacing,
  typography,
} from './tokens';
export type {
  ColorTokens,
  ShadowTokens,
  TextStyleTokens,
  TypographyVariant,
} from './tokens';

export { Badge } from './components/Badge';
export type { BadgeProps, BadgeVariant } from './components/Badge';
export { Button } from './components/Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/Button';
export { Card } from './components/Card';
export type { CardProps } from './components/Card';
export { Input } from './components/Input';
export type { InputProps } from './components/Input';
export { Screen } from './components/Screen';
export type { ScreenProps } from './components/Screen';
export { Text } from './components/Text';
export type { TextColor, TextProps } from './components/Text';

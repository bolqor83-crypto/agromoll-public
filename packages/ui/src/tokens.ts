/**
 * Дизайн-токены АгроМолл — единственный источник истины для оформления.
 *
 * Философия (см. docs/adr/ADR-002-design-system.md):
 *  — приложение используют в 4:00–14:00, в спешке, на улице, иногда в перчатках;
 *  — фон тёплый нейтральный, чтобы не слепил в темноте машины и на улице;
 *  — акцент — тёмно-зелёный (рыночный, спокойный);
 *  — срочность — мягкий янтарный. Красный запрещён: в 4 утра он читается как тревога;
 *  — скругления 12–20 px единообразно, тени мягкие, зоны нажатия от 48×48 px.
 */

// ---------------------------------------------------------------------------
// Цвета
// ---------------------------------------------------------------------------

export interface ColorTokens {
  /** Тёплый нейтральный фон приложения (не чисто белый). */
  background: string;
  /** Фон карточек и полей. */
  surface: string;
  /** Приподнятые поверхности (модалки, меню, кнопки-иконки). */
  surfaceElevated: string;
  /** Тёмно-зелёный — главный акцент (рыночная зелень, спокойствие). */
  primary: string;
  /** Мягкая зелёная подложка (бейджи, подложки иконок). */
  primaryMuted: string;
  /** Дополнительный зелёный для ссылок и акцентов, поярче primary. */
  accent: string;
  /** Мягкий янтарный — срочность/внимание БЕЗ тревоги (замена красному). */
  warning: string;
  /** Янтарная подложка для бейджей срочности. */
  warningSoft: string;
  /** Основной текст. */
  text: string;
  /** Второстепенный текст (цены, подписи к карточкам). */
  textSecondary: string;
  /** Приглушённый текст (подсказки, метаданные). */
  textMuted: string;
  /** Границы и разделители. */
  border: string;
  /** Текст/иконки поверх primary. */
  onPrimary: string;
}

export const lightColors: ColorTokens = {
  background: '#FAF8F4',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  primary: '#2E6B4E',
  primaryMuted: '#E4EFE8',
  accent: '#3E8E68',
  warning: '#A96E1F',
  warningSoft: '#FBF1DE',
  text: '#1B241F',
  textSecondary: '#4C5850',
  textMuted: '#8B958D',
  border: '#E7E2D9',
  onPrimary: '#FFFFFF',
};

export const darkColors: ColorTokens = {
  background: '#151816',
  surface: '#1D211E',
  surfaceElevated: '#242925',
  primary: '#5FB385',
  primaryMuted: '#24352B',
  accent: '#7CC9A2',
  warning: '#DFAE62',
  warningSoft: '#3A2F1D',
  text: '#F1F4F0',
  textSecondary: '#B7C0B9',
  textMuted: '#7F897F',
  border: '#2A2F2B',
  onPrimary: '#0C1410',
};

export const colors: { light: ColorTokens; dark: ColorTokens } = {
  light: lightColors,
  dark: darkColors,
};

// ---------------------------------------------------------------------------
// Типографика — крупная, с высоким контрастом (спешка, перчатки, улица)
// ---------------------------------------------------------------------------

export type TypographyVariant = 'display' | 'title' | 'body' | 'caption' | 'button';

export interface TextStyleTokens {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
  letterSpacing?: number;
}

export const typography: Record<TypographyVariant, TextStyleTokens> = {
  /** Крупные заголовки экранов. */
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.5 },
  /** Заголовки секций и карточек. */
  title: { fontSize: 22, lineHeight: 28, fontWeight: '600', letterSpacing: -0.2 },
  /** Основной текст — крупнее стандартного, читается в спешке. */
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' },
  /** Подписи, цены, метаданные. */
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  /** Текст кнопок — по требованиям к зонам нажатия всегда крупный. */
  button: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
};

// ---------------------------------------------------------------------------
// Отступы
// ---------------------------------------------------------------------------

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// ---------------------------------------------------------------------------
// Скругления (единообразно 12–20 px)
// ---------------------------------------------------------------------------

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  pill: 999,
} as const;

// ---------------------------------------------------------------------------
// Движение: 200–300 мс, spring-характер
// ---------------------------------------------------------------------------

export const motion = {
  fast: 200,
  normal: 300,
  easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
} as const;

// ---------------------------------------------------------------------------
// Тени — мягкие, без жёстких границ
// ---------------------------------------------------------------------------

export interface ShadowTokens {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

export const shadows: { light: ShadowTokens; dark: ShadowTokens } = {
  light: {
    shadowColor: '#223028',
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  dark: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
};

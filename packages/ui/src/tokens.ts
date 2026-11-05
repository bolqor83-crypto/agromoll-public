/**
 * Дизайн-токены «АгроМолл» — единый источник правды для всего UI.
 *
 * Философия (ADR-002): приложение используется в 4–5 утра, на улице, в спешке,
 * часто в перчатках. Поэтому: крупная типографика, тач-зоны от 48 px,
 * тёплый фон вместо чисто белого, тёмно-зелёный акцент вместо тревожного
 * синего/красного, мягкий янтарный вместо красного для срочности.
 *
 * Файл не импортирует react-native — чтобы токены можно было использовать
 * и в чистом TS (тесты, web, будущее админ-приложение).
 */

/** Режимы темы. */
export type ThemeMode = 'light' | 'dark';

/** Настройка темы: конкретный режим или «как в системе». */
export type ThemeSetting = ThemeMode | 'system';

/** Палитра темы. Обязательный набор + служебные цвета «на цветном» (on-color). */
export interface ThemeColors {
  /** Тёплый нейтральный фон приложения (не чисто белый — не слепит в темноте). */
  background: string;
  /** Фон карточек и полей. */
  surface: string;
  /** Повышенная поверхность: тосты, поповеры, шапки. */
  surfaceElevated: string;
  /** Главный акцент: тёмно-зелёный, «рыночный». */
  primary: string;
  /** Мягкая зелёная подложка (бейджи, вторичные кнопки). */
  primaryMuted: string;
  /** Дополнительный зелёный для акцентов/ссылок. */
  accent: string;
  /** Мягкий янтарный: срочность без тревоги. Красный запрещён (ADR-002). */
  warning: string;
  /** Текст на warning/primary-заливках и «глубокий янтарный» текст. */
  onWarning: string;
  /** Основной текст с высоким контрастом. */
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  /** Текст на primary-заливке (в тёмной теме primary светлее — текст тёмный). */
  onPrimary: string;
}

/**
 * Палитры светлой и тёмной тем.
 * Обоснование каждого цвета — docs/design/palette.md.
 */
export const palette: Record<ThemeMode, ThemeColors> = {
  light: {
    background: '#F7F4EE', // тёплая бумага
    surface: '#FFFDF9', // молочно-белая карточка
    surfaceElevated: '#FFFFFF',
    primary: '#2D6A4F', // тёмно-зелёный, контраст с фоном ≈ 6.4:1
    primaryMuted: '#E3EFE7',
    accent: '#40916C',
    warning: '#DE911D', // мягкий янтарный
    onWarning: '#7C4A0C', // глубокий янтарный для текста
    text: '#212A24',
    textSecondary: '#525D55',
    textMuted: '#8A9189',
    border: '#E7E2D8',
    onPrimary: '#FFFFFF',
  },
  dark: {
    background: '#161917', // тёплый графит, без синевы
    surface: '#1E2320',
    surfaceElevated: '#262C28',
    primary: '#7BC496', // светло-зелёный для контраста на тёмном
    primaryMuted: '#24382D',
    accent: '#9AD6B2',
    warning: '#E0AC4E',
    onWarning: '#F2D9A6',
    text: '#EFEDE7',
    textSecondary: '#B7BAB1',
    textMuted: '#7E847C',
    border: '#333A34',
    onPrimary: '#0E1F16',
  },
};

/** Типографика: крупная, с высоким контрастом (минимум текста на карточках). */
export const typography = {
  display: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  button: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
} as const;

export type TextVariant = keyof typeof typography;

/** Шкала отступов: 4 / 8 / 12 / 16 / 24 / 32. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export type SpacingToken = keyof typeof spacing;

/** Скругления: 12–20 px + pill (iOS-like, никаких резких углов). */
export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  pill: 999,
} as const;

/** Движение: 200–300 мс, spring-характер. */
export const motion = {
  fast: 200,
  normal: 300,
  easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  /** Пружина тактильного отклика нажатий (Reanimated withSpring). */
  pressSpring: { damping: 15, mass: 0.6, stiffness: 320 },
} as const;

/** Минимальная зона нажатия — 48×48 (перчатки, спешка). */
export const touchTarget = { min: 48 } as const;

/** Мягкая тень без жёстких границ. */
export interface ShadowTokens {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  /** Android-эквивалент тени. */
  elevation: number;
}

/**
 * Мягкая тень без жёстких границ.
 * shadow* работает на iOS, elevation — на Android, на web react-native-web
 * сам собирает из них box-shadow.
 */
export const shadow: Record<ThemeMode, ShadowTokens> = {
  light: {
    shadowColor: '#1F2A24',
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  dark: {
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
};

/** Приводит настройку темы к конкретному режиму с учётом системной. */
export function resolveTheme(
  setting: ThemeSetting,
  system: 'light' | 'dark' | null | undefined,
): ThemeMode {
  if (setting === 'system') {
    return system === 'dark' ? 'dark' : 'light';
  }
  return setting;
}

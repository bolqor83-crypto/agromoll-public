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
  /** Усиленная граница: elevation-карточки в тёмной теме (ADR-028/030). */
  borderStrong: string;
  /** Текст на primary-заливке (в тёмной теме primary светлее — текст тёмный). */
  onPrimary: string;
  /** Затемнение под модалками-листами (v0.3.1, ADR-009; 0.7 — v0.6.2-D, ADR-030). */
  scrim: string;
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
    warning: '#DE911D', // мягкий янтарный (заливки/иконки, НЕ текст)
    onWarning: '#7C4A0C', // глубокий янтарный для текста (7.3:1 на surface)
    text: '#212A24',
    textSecondary: '#525D55',
    // v0.6.2-B: 4.5:1 на обоих фонах (было #8A9189 — 2.95:1, FAIL AA)
    textMuted: '#6B726A',
    border: '#E7E2D8',
    borderStrong: '#D9D2C3',
    onPrimary: '#FFFFFF',
    // v0.6.2-D: 0.7 (было 0.45) — лист достаточно отделяется от контента (аудит №14)
    scrim: 'rgba(15, 20, 17, 0.7)',
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
    // v0.6.2-B: 4.6:1 на surface (было #7E847C — 4.16:1, ниже AA)
    textMuted: '#868C82',
    border: '#333A34',
    // v0.6.2-B: elevation-граница карточек в тёмной теме (ADR-030)
    borderStrong: '#3A423C',
    onPrimary: '#0E1F16',
    // v0.6.2-D: 0.7 (было 0.6) — спека этапа, единая глубина в обеих темах
    scrim: 'rgba(0, 0, 0, 0.7)',
  },
};

/**
 * Адаптивность (v0.6.2-D, ADR-030).
 *
 * Лента/витрина — 2 колонки на планшете; контент ограничен 600 px и
 * центрирован на широких экранах — строки не растягиваются в 60+ символов
 * (аудит №15/№16). Константы — здесь, чтобы breakpoints были единым
 * источником правды для ui-пакета и приложения.
 */
export const responsive = {
  /** Планшет: 2 колонки ленты/витрины (iPad ≥768). */
  tabletMinWidth: 768,
  /** Широкий телефон: контент уже ограничиваем (iPhone Pro Max ≥430). */
  widePhoneMinWidth: 430,
  /** Максимум контентной колонки — «читаемая» ширина строк 45–75 символов. */
  contentMaxWidth: 600,
} as const;

/**
 * Палитра карты (v0.6.2-D, ADR-030): семантические цвета геосон вне
 * hardcoded-хексов экрана (аудит №5/№6). Маркеры — графика, порог
 * WCAG 1.4.11 — 3:1 к канве (проверяется contrast-тестом).
 */
export interface MapThemeColors {
  /** Точка покупателя «куда везти» — спокойный синий (семантика v0.5.0). */
  buyerPoint: string;
  /** Линия продавца — фирменный зелёный (primary темы). */
  sellerLine: string;
  /** Коридор доставщика — янтарный; в светлой теме затемнён до 3:1. */
  corridor: string;
  /** Фон web-канвы (SVG-карта). */
  canvas: string;
  /** Сетка улиц web-канвы. */
  grid: string;
  /** Кольцо центра — позиция пользователя. */
  centerRing: string;
  /** Сердцевина пина «моя точка». */
  pinHole: string;
}

export const mapPalette: Record<ThemeMode, MapThemeColors> = {
  light: {
    buyerPoint: '#3B6FA0', // 4.57:1 на канве
    sellerLine: '#2D6A4F', // = primary light, 5.52:1
    corridor: '#A8731B', // 3.53:1 (было #C98A2D — 2.53:1, FAIL 1.4.11)
    canvas: '#EAF0E8',
    grid: '#D8E2D4',
    centerRing: '#4A4A44', // 7.70:1
    pinHole: '#FAF8F4',
  },
  dark: {
    buyerPoint: '#7FA8CC', // 6.36:1
    sellerLine: '#7BC496', // = primary dark, 7.73:1
    corridor: '#E0AC4E', // = warning dark, 7.73:1
    canvas: '#1E2320', // = surface: карта больше не «светлое пятно» (аудит №6)
    grid: '#333A34', // = border
    centerRing: '#868C82', // = textMuted dark, 4.62:1
    pinHole: '#1E2320',
  },
};

/**
 * Цвет маркера по виду геозоны из палитры темы. kind — значение
 * GeoPointKind ('buyer_point' | 'seller_line' | 'delivery_corridor');
 * строкой — чтобы ui-пакет не зависел от пакета типов.
 */
export function markerColorFor(kind: string, colors: MapThemeColors): string {
  switch (kind) {
    case 'buyer_point':
      return colors.buyerPoint;
    case 'seller_line':
      return colors.sellerLine;
    case 'delivery_corridor':
      return colors.corridor;
    default:
      return colors.sellerLine;
  }
}

/**
 * Фирменный шрифт — Inter (v0.6.2-B, ADR-028).
 *
 * Почему Inter, а не Manrope: геометрия и метрики максимально близки к
 * SF Pro («как айфон»), полная кириллица из коробки, табличные цифры
 * (tnum) и 4 нужных начертания. Один шрифт на iOS/Android/web — вид
 * приложения перестаёт зависеть от платформы (Robooo на Android
 * «удешевлял» интерфейс).
 *
 * Файлы шрифтов загружаются в apps/mobile/app/_layout.tsx (expo-font,
 * @expo-google-fonts/inter). Токены — только имена: они работают и до
 * загрузки (нативный fallback на системный шрифт), поэтому юнит-тесты
 * дизайн-системы не требуют загрузки шрифтов.
 */
export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export type FontToken = keyof typeof font;

/** Насыщенности, которые встречаются в приложении. */
export type AppFontWeight = '400' | '500' | '600' | '700';

/** Начертание шрифта для веса (веса вне шкалы прижимаются к ближайшему). */
export function fontFamilyForWeight(weight: string | number | undefined): string {
  switch (String(weight)) {
    case '500':
      return font.medium;
    case '600':
      return font.semibold;
    case '700':
    case 'bold':
      return font.bold;
    case '400':
    case 'normal':
    default:
      return font.regular;
  }
}

/**
 * Типографика: крупная, с высоким контрастом (минимум текста на карточках).
 * v0.6.2-B (ADR-028): display 32 (в диапазоне 28–32 спеки), межстрочный
 * body 1.5 (26/17), лёгкий отрицательный трекинг у заголовков —
 * «крупно и воздушно», как большие заголовки iOS.
 */
export const typography = {
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700', letterSpacing: -0.4 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 17, lineHeight: 26, fontWeight: '400', letterSpacing: 0 },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400', letterSpacing: 0 },
  button: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: 0.1 },
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
  /**
   * Многослойная тень для web (v0.6.2-B, ADR-028): два слоя —
   * узкий «контакт с поверхностью» + широкое мягкое рассеяние.
   * react-native-web отдаёт это в CSS box-shadow как есть; на native
   * тень рисуют классические shadow*-пропы выше (одна мягкая).
   */
  boxShadowWeb: string;
}

/**
 * Мягкая тень без жёстких границ.
 * shadow* работает на iOS, elevation — на Android, на web react-native-web
 * сам собирает из них box-shadow, а при наличии boxShadowWeb — берёт
 * многослойную версию оттуда.
 *
 * v0.6.2-B: в светлой теме тень заметнее (0.10/20px — карточки больше
 * не «сливаются» с фоном, находка аудита №7); в тёмной теме тень
 * физически не видна — глубину карточкам даёт borderStrong (ADR-030).
 */
export const shadow: Record<ThemeMode, ShadowTokens> = {
  light: {
    shadowColor: '#1F2A24',
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    boxShadowWeb: '0 1px 2px rgba(31, 42, 36, 0.08), 0 12px 32px rgba(31, 42, 36, 0.14)',
  },
  dark: {
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
    // в тёмной теме тени не работают — глубина через borderStrong (ADR-030)
    boxShadowWeb: 'none',
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

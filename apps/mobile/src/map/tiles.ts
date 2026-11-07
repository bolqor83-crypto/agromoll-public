/**
 * Конфигурация тайлов карты (v0.7.0-E, ADR-039).
 *
 * По умолчанию — OpenStreetMap (без ключей, fair use, ADR-034): для
 * MVP-нагрузки рынка допустимо. При росте трафика политика тайлов OSM
 * требует своего провайдера/стиля: EXPO_PUBLIC_MAP_TILES_URL подключает
 * платного провайдера (MapTiler, Mapbox, Thunderforest, Geoapify…) без
 * правки кода — меняется только переменная окружения сборки.
 *
 * Правила:
 *  - EXPO_PUBLIC_MAP_TILES_URL — шаблон с {z}/{x}/{y} (ключ провайдера
 *    вшит в URL). Expo инлайнит EXPO_PUBLIC_* на сборке (как
 *    EXPO_PUBLIC_API_URL, ADR-022). Пусто/мусор → OSM (деградация,
 *    не падение).
 *  - EXPO_PUBLIC_MAP_TILES_ATTRIBUTION — требование лицензии провайдера
 *    (HTML разрешён). Не задано → честное «© <host провайдера>»: атрибуция
 *    обязательна, «забыть» её не должен позволять конфиг.
 *  - EXPO_PUBLIC_MAP_TILES_MAX_ZOOM — максимум зума провайдера (12..22),
 *    по умолчанию 19 (контракт ADR-034).
 *
 * Чистая функция resolveTileConfig выделена для тестируемости: модульные
 * константы вычисляются один раз при импорте. Runtime-фолбэк при лежащем
 * провайдере (тайлы не грузятся) — в MapView.web.tsx: слушаем tileerror,
 * при серии ошибок переключаем слой на OSM.
 */

/** URL тайлов OSM (без ключей, fair use, ADR-034). */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Обязательная атрибуция OSM (fair use — часть контракта). */
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Зум-рамки приложения (ADR-034): рынок виден целиком, детали различимы. */
export const MIN_ZOOM = 12;
export const DEFAULT_MAX_ZOOM = 19;

/** Разброс максимального зума у провайдеров: ограничиваем разумно. */
const HARD_MAX_ZOOM_CEILING = 22;

export interface TileConfig {
  /** Шаблон URL тайлов ({z}/{x}/{y}). */
  urlTemplate: string;
  /** Атрибуция (HTML разрешён) — обязательна для любого провайдера. */
  attribution: string;
  minZoom: number;
  maxZoom: number;
  /** OSM по умолчанию или провайдер из EXPO_PUBLIC_MAP_TILES_URL. */
  provider: 'osm' | 'custom';
}

export interface ResolveTileConfigInput {
  /** Сырое значение EXPO_PUBLIC_MAP_TILES_URL. */
  url?: string;
  /** Сырое значение EXPO_PUBLIC_MAP_TILES_ATTRIBUTION. */
  attribution?: string;
  /** Сырое значение EXPO_PUBLIC_MAP_TILES_MAX_ZOOM. */
  maxZoom?: string;
}

/** Шаблон валиден: URL с плейсхолдерами {z}/{x}/{y}. */
function isValidTileUrlTemplate(template: string): boolean {
  try {
    const parsed = new URL(template);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      template.includes('{z}') &&
      template.includes('{x}') &&
      template.includes('{y}')
    );
  } catch {
    return false;
  }
}

/** Host провайдера для авто-атрибуции (без www, схема не нужна). */
function providerHost(template: string): string {
  try {
    return new URL(template).hostname.replace(/^www\./, '');
  } catch {
    return 'tiles provider';
  }
}

/**
 * Разрешить конфиг тайлов: провайдер по ключу ИЛИ OSM-фолбэк.
 * Чистая функция — все сценарии покрыты юнит-тестами.
 */
export function resolveTileConfig(input: ResolveTileConfigInput): TileConfig {
  const url = input.url?.trim();

  if (!url || !isValidTileUrlTemplate(url)) {
    // Пусто или мусор (нет {z}/{x}/{y}, не URL) — честный OSM:
    // карта важнее провайдера, ошибка конфига не должна ломать экран.
    return {
      urlTemplate: OSM_TILE_URL,
      attribution: OSM_ATTRIBUTION,
      minZoom: MIN_ZOOM,
      maxZoom: DEFAULT_MAX_ZOOM,
      provider: 'osm',
    };
  }

  const rawMaxZoom = Number.parseInt(input.maxZoom?.trim() ?? '', 10);
  const maxZoom = Number.isFinite(rawMaxZoom)
    ? Math.min(Math.max(rawMaxZoom, MIN_ZOOM), HARD_MAX_ZOOM_CEILING)
    : DEFAULT_MAX_ZOOM;

  const attribution = input.attribution?.trim() || `&copy; ${providerHost(url)}`;

  return {
    urlTemplate: url,
    attribution,
    minZoom: MIN_ZOOM,
    maxZoom,
    provider: 'custom',
  };
}

/** Вычисление при импорте: значения вшиты в бандл на сборке. */
export const TILE_CONFIG: TileConfig = resolveTileConfig({
  url: process.env.EXPO_PUBLIC_MAP_TILES_URL,
  attribution: process.env.EXPO_PUBLIC_MAP_TILES_ATTRIBUTION,
  maxZoom: process.env.EXPO_PUBLIC_MAP_TILES_MAX_ZOOM,
});

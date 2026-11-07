/**
 * Тесты конфигурации тайлов карты (v0.7.0-E, ADR-039): провайдер по
 * ключу, деградация на OSM при пустом/мусорном конфиге, обязательная
 * атрибуция, зум-рамки.
 */
import {
  DEFAULT_MAX_ZOOM,
  MIN_ZOOM,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  resolveTileConfig,
} from './tiles';

const MAPTILER_URL =
  'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=demo-key';

describe('resolveTileConfig (ADR-039)', () => {
  it('пустой конфиг — OSM по умолчанию (fair use, без ключей)', () => {
    const config = resolveTileConfig({});
    expect(config).toEqual({
      urlTemplate: OSM_TILE_URL,
      attribution: OSM_ATTRIBUTION,
      minZoom: MIN_ZOOM,
      maxZoom: DEFAULT_MAX_ZOOM,
      provider: 'osm',
    });
  });

  it('пробелы вместо значения — тоже OSM', () => {
    expect(resolveTileConfig({ url: '   ' }).provider).toBe('osm');
  });

  it('шаблон без {z}/{x}/{y} — мусор, честный OSM (не падение)', () => {
    expect(resolveTileConfig({ url: 'https://tiles.example.com/all.png' }).provider).toBe('osm');
    expect(resolveTileConfig({ url: 'не-адрес/{z}' }).provider).toBe('osm');
  });

  it('валидный шаблон провайдера — подключается с заданной атрибуцией и зумом', () => {
    const config = resolveTileConfig({
      url: MAPTILER_URL,
      attribution: '© OpenStreetMap contributors © MapTiler',
      maxZoom: '21',
    });
    expect(config.provider).toBe('custom');
    expect(config.urlTemplate).toBe(MAPTILER_URL);
    expect(config.attribution).toBe('© OpenStreetMap contributors © MapTiler');
    expect(config.maxZoom).toBe(21);
    expect(config.minZoom).toBe(MIN_ZOOM);
  });

  it('атрибуция не задана — честное «© <host>»: забыть лицензию конфиг не позволяет', () => {
    const config = resolveTileConfig({ url: MAPTILER_URL });
    expect(config.attribution).toBe('&copy; api.maptiler.com');
  });

  it('www у хоста срезается в авто-атрибуции', () => {
    const config = resolveTileConfig({
      url: 'https://www.thunderforest.com/transport/{z}/{x}/{y}.png?key=k',
    });
    expect(config.attribution).toBe('&copy; thunderforest.com');
  });

  it('maxZoom: мусор → дефолт 19, ниже 12 → 12, выше 22 → 22', () => {
    expect(resolveTileConfig({ url: MAPTILER_URL, maxZoom: 'abc' }).maxZoom).toBe(
      DEFAULT_MAX_ZOOM,
    );
    expect(resolveTileConfig({ url: MAPTILER_URL, maxZoom: '2' }).maxZoom).toBe(12);
    expect(resolveTileConfig({ url: MAPTILER_URL, maxZoom: '30' }).maxZoom).toBe(22);
  });

  it('зум и атрибуция влияют только на свой провайдер, OSM-дефолты стабильны', () => {
    const config = resolveTileConfig({ maxZoom: '21', attribution: 'x' });
    expect(config.provider).toBe('osm');
    expect(config.maxZoom).toBe(DEFAULT_MAX_ZOOM);
    expect(config.attribution).toBe(OSM_ATTRIBUTION);
  });
});

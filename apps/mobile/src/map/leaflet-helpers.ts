/**
 * Чистые хелперы Leaflet-карты web (v0.6.0-D, ADR-034).
 *
 * Без импорта leaflet — только генерация HTML/CSS строк: компонент
 * MapView.web.tsx оборачивает их в L.divIcon, юнит-тесты проверяют
 * без DOM (jest), палитра приходит из mapPalette (ADR-030).
 */
import type { MapThemeColors } from '@agromoll/ui';
import type { ThemeMode } from '@agromoll/ui';

/** Класс тёмной темы на контейнере карты (фильтр тайлов, ADR-034). */
export const MAP_DARK_CLASS = 'agromoll-map-dark';

/**
 * Радиус маркера-точки (половина iconSize), px. 22 px ≥ 44/2 — тап-таргет
 * по центру круга; сам клик обрабатывает Leaflet на весь icon.
 */
export const PIN_SIZE = 26;

/** Радиус пина «моя точка» (перетаскиваемый), px. */
export const MY_PIN_SIZE = 34;

/** HTML круглого маркера геозоны: заливка цветом вида, обводка канвой. */
export function markerHtml(color: string, colors: MapThemeColors, label?: string): string {
  const size = PIN_SIZE;
  const title = label ? ` title="${escapeHtml(label)}"` : '';
  return (
    `<div${title} style="width:${size}px;height:${size}px;border-radius:50%;` +
    `background:${color};border:2.5px solid ${colors.pinHole};` +
    `box-shadow:0 2px 6px rgba(0,0,0,0.35);box-sizing:border-box"></div>`
  );
}

/** HTML перетаскиваемого пина «моя точка»: капля с сердцевиной. */
export function myPinHtml(colors: MapThemeColors): string {
  const size = MY_PIN_SIZE;
  const hole = 12;
  return (
    `<div style="width:${size}px;height:${size}px;border-radius:50%;` +
    `background:${colors.sellerLine};border:3px solid ${colors.pinHole};` +
    `display:flex;align-items:center;justify-content:center;` +
    `box-shadow:0 3px 10px rgba(0,0,0,0.4);box-sizing:border-box;cursor:grab">` +
    `<div style="width:${hole}px;height:${hole}px;border-radius:50%;` +
    `background:${colors.pinHole}"></div></div>`
  );
}

/** HTML пузыря кластера: счётчик на цвете продавца (скопления линий). */
export function clusterHtml(count: number, colors: MapThemeColors): string {
  const size = count > 99 ? 46 : count > 9 ? 40 : 34;
  return (
    `<div style="width:${size}px;height:${size}px;border-radius:50%;` +
    `background:${colors.sellerLine};border:2.5px solid ${colors.pinHole};` +
    `display:flex;align-items:center;justify-content:center;` +
    `color:${colors.pinHole};font:600 ${size / 2.4}px system-ui,sans-serif;` +
    `box-shadow:0 2px 6px rgba(0,0,0,0.35)">${count}</div>`
  );
}

/** HTML кольца позиции пользователя (центр карты). */
export function centerRingHtml(colors: MapThemeColors): string {
  return (
    `<div style="width:18px;height:18px;border-radius:50%;` +
    `border:3px solid ${colors.centerRing};box-sizing:border-box"></div>`
  );
}

/** Экранирование HTML в подписях маркеров (название точки — пользовательский ввод). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Минимальный необходимый CSS Leaflet + кластеров + тёмной темы.
 *
 * Полный leaflet.css тянет url()-картинки дефолтных маркеров (мы их не
 * используем — свои divIcon) и требует CSS-пайплайн Metro (experiments.
 * css). Инъекция в <style> из кода: бандлер не участвует, версия Leaflet
 * запинена (1.9.4), юнит-тесты не требуют моков CSS (ADR-034).
 */
export const LEAFLET_ESSENTIAL_CSS = `
.leaflet-pane,.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow,
.leaflet-tile-container,.leaflet-pane>svg,.leaflet-pane>canvas,
.leaflet-zoom-box,.leaflet-image-layer,.leaflet-layer{position:absolute;left:0;top:0}
.leaflet-container{overflow:hidden;-webkit-tap-highlight-color:transparent}
.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow{-webkit-user-select:none;user-select:none}
.leaflet-tile::selection{background:transparent}
.leaflet-container img{max-width:none!important;max-height:none!important}
.leaflet-tile{filter:inherit;visibility:hidden}
.leaflet-tile-loaded{visibility:inherit}
.leaflet-zoom-animated{transform-origin:0 0}
.leaflet-pane{z-index:400}
.leaflet-tile-pane{z-index:200}
.leaflet-overlay-pane{z-index:400}
.leaflet-shadow-pane{z-index:500}
.leaflet-marker-pane{z-index:600}
.leaflet-tooltip-pane{z-index:650}
.leaflet-popup-pane{z-index:700}
.leaflet-map-pane canvas{z-index:100}
.leaflet-map-pane svg{z-index:200}
.leaflet-control{position:relative;z-index:800;pointer-events:auto}
.leaflet-top,.leaflet-bottom{position:absolute;z-index:1000;pointer-events:none}
.leaflet-top{top:0}.leaflet-right{right:0}.leaflet-bottom{bottom:0}.leaflet-left{left:0}
.leaflet-right .leaflet-control{margin-right:10px}
.leaflet-left .leaflet-control{margin-left:10px}
.leaflet-top .leaflet-control{margin-top:10px}
.leaflet-bottom .leaflet-control{margin-bottom:10px}
.leaflet-control-attribution{background:rgba(255,255,255,0.8);border-radius:4px;
  padding:1px 6px;font:11px/1.6 system-ui,sans-serif;color:#333}
.leaflet-control-attribution a{color:#0078A8}
.leaflet-control-zoom a{display:block;width:32px;height:32px;line-height:30px;
  text-align:center;font:700 17px system-ui,sans-serif;color:#333;background:#fff;
  border-bottom:1px solid #ccc;text-decoration:none;cursor:pointer}
.leaflet-control-zoom a:first-child{border-radius:4px 4px 0 0}
.leaflet-control-zoom a:last-child{border-bottom:none;border-radius:0 0 4px 4px}
.marker-cluster{background-clip:padding-box}
/* Тёмная тема (ADR-034): стандартные тайлы OSM светлые — инверсия
   классический приём без второго провайдера тайлов. */
.${MAP_DARK_CLASS} .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.92)}
.${MAP_DARK_CLASS} .leaflet-container{background:#1E2320}
.${MAP_DARK_CLASS} .leaflet-control-attribution{background:rgba(30,35,32,0.85);color:#D8E2D4}
.${MAP_DARK_CLASS} .leaflet-control-attribution a{color:#7BC496}
.${MAP_DARK_CLASS} .leaflet-control-zoom a{background:#2A312C;color:#D8E2D4;border-color:#3A423C}
`;

/** Идемпотентная инъекция CSS карты (один <style> на документ). */
export function injectLeafletStyles(): void {
  if (typeof document === 'undefined') {
    return; // SSR/static export — DOM нет, стили не нужны
  }
  const STYLE_ID = 'agromoll-leaflet-css';
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = LEAFLET_ESSENTIAL_CSS;
  document.head.appendChild(style);
}

/** Класс-модификатор контейнера по теме (экспорт для компонента и тестов). */
export function containerClassFor(mode: ThemeMode): string {
  return mode === 'dark' ? MAP_DARK_CLASS : '';
}

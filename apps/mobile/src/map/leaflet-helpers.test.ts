/**
 * Юнит-тесты хелперов Leaflet-карты web (v0.6.0-D, ADR-034) —
 * чистые функции без DOM: HTML маркеров/кластеров экранируется и
 * красится палитрой темы, CSS содержит фильтр тёмной темы.
 */
import { mapPalette } from '@agromoll/ui';
import {
  LEAFLET_ESSENTIAL_CSS,
  MAP_DARK_CLASS,
  clusterHtml,
  containerClassFor,
  escapeHtml,
  markerHtml,
  myPinHtml,
} from './leaflet-helpers';

describe('leaflet-helpers (ADR-034)', () => {
  it('markerHtml: круглый маркер с цветом вида и обводкой темы', () => {
    const light = mapPalette.light;
    const html = markerHtml(light.buyerPoint, light, 'Ларёк «У Ашота»');
    expect(html).toContain('border-radius:50%');
    expect(html).toContain(`background:${light.buyerPoint}`);
    expect(html).toContain(`border:2.5px solid ${light.pinHole}`);
    // Подпись в title (кавычки экранируются, кавычки-ёлочки безопасны)
    expect(html).toContain('title="Ларёк «У Ашота»"');
  });

  it('markerHtml: без подписи — атрибута title нет', () => {
    const html = markerHtml(mapPalette.dark.sellerLine, mapPalette.dark);
    expect(html).not.toContain('title=');
  });

  it('myPinHtml: капля «моя точка» с сердцевиной из палитры', () => {
    const dark = mapPalette.dark;
    const html = myPinHtml(dark);
    expect(html).toContain(`background:${dark.sellerLine}`);
    expect(html).toContain(`background:${dark.pinHole}`);
    expect(html).toContain('cursor:grab'); // перетаскиваемый
  });

  it('clusterHtml: счётчик в пузыре, размер растёт с количеством', () => {
    const small = clusterHtml(3, mapPalette.light);
    const big = clusterHtml(120, mapPalette.light);
    expect(small).toContain('>3<');
    expect(big).toContain('>120<');
    expect(big).toContain('width:46px');
    expect(small).toContain('width:34px');
  });

  it('escapeHtml: пользовательский ввод не ломает разметку', () => {
    expect(escapeHtml('<script>"x"&\'y\'</script>')).toBe(
      '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;',
    );
  });

  it('containerClassFor: тёмная тема — модификатор, светлая — пусто', () => {
    expect(containerClassFor('dark')).toBe(MAP_DARK_CLASS);
    expect(containerClassFor('light')).toBe('');
  });

  it('CSS: фильтр тайлов для тёмной темы и паноры Leaflet', () => {
    expect(LEAFLET_ESSENTIAL_CSS).toContain(`.${MAP_DARK_CLASS} .leaflet-tile-pane{filter:invert(1)`);
    // Ключевые классы раскладки Leaflet без полного leaflet.css (ADR-034)
    expect(LEAFLET_ESSENTIAL_CSS).toContain('.leaflet-layer{position:absolute');
    expect(LEAFLET_ESSENTIAL_CSS).toContain('.leaflet-control-attribution');
  });
});

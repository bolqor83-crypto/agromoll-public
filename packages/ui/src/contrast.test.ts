/**
 * Программная проверка контраста WCAG AA (v0.6.2-B, ADR-028).
 *
 * Аудит v0.6.2 нашёл 3 провала в светлой теме и 1 в тёмной. Этот тест
 * пересчитывает контраст всех значимых пар токенов при каждом изменении
 * палитры — регрессия контраста стала невозможной (CI красный).
 *
 * Пороги WCAG 2.1: 4.5:1 для обычного текста, 3:1 для крупного
 * (≥24px или ≥18.66px bold). Все проверяемые пары — обычный текст.
 */
import { describe, expect, it } from 'vitest';
import { mapPalette, palette } from './tokens';

/** #RRGGBB → относительная яркость по WCAG 2.1. */
function luminance(hex: string): number {
  const h = hex.replace('#', '').slice(0, 6);
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** Контрастное отношение двух цветов (WCAG 2.1). */
function contrast(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [lo, hi] = l1 < l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

/** Смешение цвета с альфой поверх фона (для бейджей/кнопок с прозрачной заливкой). */
function blend(fg: string, alphaHex: string, bg: string): string {
  const alpha = parseInt(alphaHex, 16) / 255;
  const f = fg.replace('#', '');
  const b = bg.replace('#', '');
  const out = [0, 2, 4].map((i) =>
    Math.round(
      parseInt(f.slice(i, i + 2), 16) * alpha + parseInt(b.slice(i, i + 2), 16) * (1 - alpha),
    ),
  );
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

describe('WCAG AA: светлая тема (ADR-028)', () => {
  const c = palette.light;

  it('основной и вторичный текст — AA на фоне и карточках', () => {
    expect(contrast(c.text, c.background)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.text, c.surface)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.textSecondary, c.surface)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.textSecondary, c.background)).toBeGreaterThanOrEqual(AA);
  });

  it('v0.6.2-B: приглушённый текст — AA на фоне и карточках (было 2.95:1)', () => {
    expect(contrast(c.textMuted, c.background)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.textMuted, c.surface)).toBeGreaterThanOrEqual(AA);
  });

  it('primary-кнопка: текст на зелёной заливке — AA', () => {
    expect(contrast(c.onPrimary, c.primary)).toBeGreaterThanOrEqual(AA);
  });

  it('янтарный текст (onWarning) — AA на фоне и карточках', () => {
    expect(contrast(c.onWarning, c.surface)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.onWarning, c.background)).toBeGreaterThanOrEqual(AA);
  });

  it('янтарный бейдж (warning 18% поверх surface): текст onWarning — AA', () => {
    const badgeBg = blend(c.warning, '2E', c.surface);
    expect(contrast(c.onWarning, badgeBg)).toBeGreaterThanOrEqual(AA);
  });

  it('danger-кнопка (warning 10% поверх background): текст onWarning — AA', () => {
    const dangerBg = blend(c.warning, '1A', c.background);
    expect(contrast(c.onWarning, dangerBg)).toBeGreaterThanOrEqual(AA);
  });

  it('secondary-кнопка: зелёный текст на фоне — AA', () => {
    expect(contrast(c.primary, c.background)).toBeGreaterThanOrEqual(AA);
  });
});

describe('WCAG AA: тёмная тема (ADR-028/030)', () => {
  const c = palette.dark;

  it('основной и вторичный текст — AA на фоне и карточках', () => {
    expect(contrast(c.text, c.background)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.text, c.surface)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.textSecondary, c.surface)).toBeGreaterThanOrEqual(AA);
  });

  it('v0.6.2-B: приглушённый текст — AA на карточках (было 4.16:1)', () => {
    expect(contrast(c.textMuted, c.surface)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.textMuted, c.background)).toBeGreaterThanOrEqual(AA);
  });

  it('зелёный акцент не «светится», но читается: AA на фоне и карточках', () => {
    expect(contrast(c.primary, c.background)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.primary, c.surface)).toBeGreaterThanOrEqual(AA);
  });

  it('primary-кнопка: тёмный текст на светло-зелёной заливке — AA', () => {
    expect(contrast(c.onPrimary, c.primary)).toBeGreaterThanOrEqual(AA);
  });

  it('янтарь читается на тёмном: AA для текста onWarning и warning-иконок', () => {
    expect(contrast(c.onWarning, c.surface)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c.warning, c.surface)).toBeGreaterThanOrEqual(AA);
  });
});

describe('WCAG 1.4.11: контраст графики карты (v0.6.2-D, ADR-030)', () => {
  // Маркеры и кольцо центра — значимая графика: порог 3:1 к канве.
  // Аудит №5: старый янтарь коридора #C98A2D давал 2.53:1 — FAIL.
  const GRAPHIC = 3;

  it('светлая тема: все маркеры и кольцо центра ≥3:1 на канве', () => {
    const m = mapPalette.light;
    expect(contrast(m.buyerPoint, m.canvas)).toBeGreaterThanOrEqual(GRAPHIC);
    expect(contrast(m.sellerLine, m.canvas)).toBeGreaterThanOrEqual(GRAPHIC);
    expect(contrast(m.corridor, m.canvas)).toBeGreaterThanOrEqual(GRAPHIC);
    expect(contrast(m.centerRing, m.canvas)).toBeGreaterThanOrEqual(GRAPHIC);
  });

  it('тёмная тема: все маркеры и кольцо центра ≥3:1 на канве', () => {
    const m = mapPalette.dark;
    expect(contrast(m.buyerPoint, m.canvas)).toBeGreaterThanOrEqual(GRAPHIC);
    expect(contrast(m.sellerLine, m.canvas)).toBeGreaterThanOrEqual(GRAPHIC);
    expect(contrast(m.corridor, m.canvas)).toBeGreaterThanOrEqual(GRAPHIC);
    expect(contrast(m.centerRing, m.canvas)).toBeGreaterThanOrEqual(GRAPHIC);
  });

  it('сердцевина пина отличима от капли в обеих темах', () => {
    expect(contrast(mapPalette.light.pinHole, mapPalette.light.sellerLine)).toBeGreaterThanOrEqual(
      GRAPHIC,
    );
    expect(contrast(mapPalette.dark.pinHole, mapPalette.dark.sellerLine)).toBeGreaterThanOrEqual(
      GRAPHIC,
    );
  });
});

/**
 * Тесты shimmer-скелета (v0.3.1, B3/ADR-009) — без рендера:
 * проверяем логику темы и цвета (рендер-инфраструктура jest-expo
 * не тянет Reanimated-компоненты; визуально shimmer подтверждён
 * скриншотами обеих тем).
 */
import { describe, expect, it } from 'vitest';
import { lighten } from './color';
import { palette } from './tokens';

/** hex → [r,g,b]. */
function hexToRgb(hex: string): [number, number, number] {
  const num = Number.parseInt(hex.replace('#', ''), 16);
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

describe('lighten — подсветка блика (+8% к базе)', () => {
  it.each([
    ['light', palette.light.surfaceElevated],
    ['dark', palette.dark.surfaceElevated],
  ])('тема %s: base %s → на 8% светлее', (_theme, base) => {
    const highlight = lighten(base, 8);
    const [br, bg, bb] = hexToRgb(base);
    const [hr, hg, hb] = hexToRgb(highlight);
    const expected = (channel: number): number => Math.round(channel + (255 - channel) * 0.08);
    expect(hr).toBe(expected(br));
    expect(hg).toBe(expected(bg));
    expect(hb).toBe(expected(bb));
  });

  it('0% — тот же цвет, 100% — белый', () => {
    expect(lighten('#336699', 0)).toBe('#336699');
    expect(lighten('#336699', 100)).toBe('#ffffff');
  });

  it('короткий hex (#abc) разворачивается корректно', () => {
    expect(lighten('#abc', 0)).toBe('#aabbcc');
  });
});

describe('тёмная тема — консистентность скелета (B8)', () => {
  it('база скелета различается между темами: тёмная не «остаётся светлой»', () => {
    expect(palette.dark.surfaceElevated).not.toBe(palette.light.surfaceElevated);
    // тёмная база действительно тёмная (яркость < 100), светлая — светлая (> 200)
    const darkLum = hexToRgb(palette.dark.surfaceElevated).reduce((a, b) => a + b) / 3;
    const lightLum = hexToRgb(palette.light.surfaceElevated).reduce((a, b) => a + b) / 3;
    expect(darkLum).toBeLessThan(100);
    expect(lightLum).toBeGreaterThan(200);
  });

  it('блик тёмной темы остаётся в тёмной гамме (не вспышка белого)', () => {
    const highlight = lighten(palette.dark.surfaceElevated, 8);
    const lum = hexToRgb(highlight).reduce((a, b) => a + b) / 3;
    // 8% к тёмной базе — прирост ~14 пунктов яркости, остаётся тёмным
    expect(lum).toBeLessThan(100);
  });
});

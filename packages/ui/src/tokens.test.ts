import { describe, expect, it } from 'vitest';
import { motion, palette, radius, resolveTheme, shadow, spacing, typography } from './tokens';

describe('дизайн-токены', () => {
  it('радиусы: 12–20 px + pill, единообразно', () => {
    expect(radius).toEqual({ sm: 12, md: 16, lg: 20, pill: 999 });
  });

  it('шкала отступов: 4 / 8 / 12 / 16 / 24 / 32', () => {
    expect(Object.values(spacing)).toEqual([4, 8, 12, 16, 24, 32]);
  });

  it('движение: 200–300 мс и spring-характер', () => {
    expect(motion.fast).toBe(200);
    expect(motion.normal).toBe(300);
    expect(motion.easing).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
  });

  it('у каждого варианта типографики задан lineHeight', () => {
    for (const t of Object.values(typography)) {
      expect(t.lineHeight).toBeGreaterThan(t.fontSize);
    }
  });

  it('светлая и тёмная темы содержат одинаковый набор цветов', () => {
    expect(Object.keys(palette.dark).sort()).toEqual(Object.keys(palette.light).sort());
  });

  it('в палитрах нет чисто белого/чёрного фона (тёплый нейтральный)', () => {
    expect(palette.light.background).not.toBe('#FFFFFF');
    expect(palette.dark.background).not.toBe('#000000');
  });

  it('тени мягкие: прозрачность не выше 0.3', () => {
    for (const s of Object.values(shadow)) {
      expect(s.shadowOpacity).toBeLessThanOrEqual(0.3);
    }
  });
});

describe('resolveTheme', () => {
  it('system + тёмная системная тема → dark', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
  });

  it('system + светлая системная тема → light', () => {
    expect(resolveTheme('system', 'light')).toBe('light');
  });

  it('system + неизвестная системная тема → light (безопасный дефолт)', () => {
    expect(resolveTheme('system', null)).toBe('light');
    expect(resolveTheme('system', undefined)).toBe('light');
  });

  it('явная настройка побеждает системную', () => {
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(resolveTheme('light', 'dark')).toBe('light');
  });
});

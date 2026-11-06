import { describe, expect, it } from 'vitest';
import {
  font,
  fontFamilyForWeight,
  motion,
  palette,
  radius,
  resolveTheme,
  shadow,
  spacing,
  typography,
} from './tokens';

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

  it('v0.6.2-B: типографика по спеке этапа (ADR-028)', () => {
    expect(typography.display.fontSize).toBe(32);
    expect(typography.display.lineHeight).toBe(40);
    expect(typography.display.letterSpacing).toBe(-0.4);
    expect(typography.title.fontSize).toBe(22);
    expect(typography.body.fontSize).toBe(17);
    // межстрочный body ≈ 1.5 (спека этапа)
    expect(typography.body.lineHeight / typography.body.fontSize).toBeGreaterThanOrEqual(1.45);
    expect(typography.caption.fontSize).toBe(13);
    expect(typography.button.fontSize).toBe(17);
  });

  it('v0.6.2-B: шрифт Inter — 4 начертания, имена согласованы', () => {
    expect(font).toEqual({
      regular: 'Inter_400Regular',
      medium: 'Inter_500Medium',
      semibold: 'Inter_600SemiBold',
      bold: 'Inter_700Bold',
    });
    // веса приложения покрываются четырьмя файлами
    expect(fontFamilyForWeight('400')).toBe(font.regular);
    expect(fontFamilyForWeight('500')).toBe(font.medium);
    expect(fontFamilyForWeight('600')).toBe(font.semibold);
    expect(fontFamilyForWeight('700')).toBe(font.bold);
    // веса вне шкалы прижимаются к ближайшему доступному
    expect(fontFamilyForWeight(undefined)).toBe(font.regular);
    expect(fontFamilyForWeight('bold')).toBe(font.bold);
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

  it('v0.6.2-B: web-тень многослойная в светлой теме, в тёмной — none (ADR-028)', () => {
    // два слоя: «контакт» + «рассеяние»
    expect(shadow.light.boxShadowWeb.split('rgba(').length - 1).toBe(2);
    // в тёмной теме глубина через borderStrong, не через тень (ADR-030)
    expect(shadow.dark.boxShadowWeb).toBe('none');
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

import { describe, expect, it } from 'vitest';

import {
  darkColors,
  lightColors,
  motion,
  radius,
  spacing,
  typography,
} from './tokens';
import type { ColorTokens } from './tokens';

const REQUIRED_COLOR_KEYS: (keyof ColorTokens)[] = [
  'background',
  'surface',
  'surfaceElevated',
  'primary',
  'primaryMuted',
  'accent',
  'warning',
  'text',
  'textSecondary',
  'textMuted',
  'border',
];

describe('colors', () => {
  it('светлая и тёмная темы содержат все обязательные токены', () => {
    for (const key of REQUIRED_COLOR_KEYS) {
      expect(lightColors[key], `light.${key}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(darkColors[key], `dark.${key}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('фон не чисто белый — тёплый нейтральный (не слепит в темноте)', () => {
    expect(lightColors.background).not.toBe('#FFFFFF');
  });

  it('тёмная тема не чисто чёрная', () => {
    expect(darkColors.background).not.toBe('#000000');
  });

  it('в тёмной теме primary светлее, чем в светлой (контраст на тёмном фоне)', () => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
    };
    expect(lum(darkColors.primary)).toBeGreaterThan(lum(lightColors.primary));
  });
});

describe('typography', () => {
  it('базовый текст крупный — не меньше 17 px (спешка, перчатки)', () => {
    expect(typography.body.fontSize).toBeGreaterThanOrEqual(17);
    expect(typography.button.fontSize).toBeGreaterThanOrEqual(17);
  });

  it('у каждого варианта lineHeight больше fontSize', () => {
    for (const variant of Object.values(typography)) {
      expect(variant.lineHeight).toBeGreaterThan(variant.fontSize);
    }
  });
});

describe('spacing', () => {
  it('шкала отступов 4/8/12/16/24/32', () => {
    expect(Object.values(spacing)).toEqual([4, 8, 12, 16, 24, 32]);
  });
});

describe('radius', () => {
  it('скругления 12–20 px + pill', () => {
    expect(radius).toEqual({ sm: 12, md: 16, lg: 20, pill: 999 });
  });
});

describe('motion', () => {
  it('анимации в диапазоне 200–300 мс', () => {
    expect(motion.fast).toBe(200);
    expect(motion.normal).toBe(300);
  });
});

/**
 * Цветовые утилиты дизайн-системы (v0.3.1).
 *
 * Файл без импортов react-native — используется и в компонентах,
 * и в чистых TS-тестах (vitest не тянет нативные пакеты).
 */

/**
 * hex → hex на `percent`% светлее (смешивание с белым).
 * Используется shimmer-скелетом: «блик на 8% светлее базы» (ADR-009).
 */
export function lighten(hex: string, percent: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : clean;
  const num = Number.parseInt(full, 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  const mix = (channel: number): number => Math.round(channel + (255 - channel) * (percent / 100));
  const toHex = (channel: number): string => channel.toString(16).padStart(2, '0');
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

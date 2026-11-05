/**
 * ProgressBar — индикатор «сколько от нормы» (v0.4.0, ADR-011).
 *
 * Экран «Мои часы»: заполнение до 60 ч. Обычное состояние — зелёный;
 * при progress ≥ 0.8 (48 ч из 60) — янтарный: «приближаетесь к лимиту».
 * Красный запрещён (ADR-002): блокировка показывается отдельным
 * бейджем и текстом, а не цветом тревоги.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme';
import { radius, spacing } from '../tokens';

export interface ProgressBarProps {
  /** 0..1 — доля заполнения. Значения вне диапазона обрезаются. */
  progress: number;
  /** Янтарная зона (по умолчанию от 0.8 — 48 ч из 60). */
  warnFrom?: number;
  /** Подписи/значения рядом — рендерит вызывающий (flex-строка сверху). */
  children?: ReactNode;
}

export function ProgressBar({ progress, warnFrom = 0.8, children }: ProgressBarProps) {
  const { colors } = useTheme();
  const clamped = Math.min(1, Math.max(0, progress));
  const warn = clamped >= warnFrom;

  return (
    <View style={{ gap: spacing.xs }}>
      {children}
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
        style={{
          height: 8,
          borderRadius: radius.pill,
          backgroundColor: colors.primaryMuted,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${clamped * 100}%`,
            height: '100%',
            borderRadius: radius.pill,
            backgroundColor: warn ? colors.warning : colors.primary,
          }}
        />
      </View>
    </View>
  );
}

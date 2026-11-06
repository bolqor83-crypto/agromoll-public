/**
 * RatingBadge — бейдж публичного рейтинга «4.7 · 42 сделки» (v0.5.0, ADR-013).
 *
 * Зелёный при score ≥ 4.0 («надёжный»), мягкий янтарный ниже — внимание
 * без тревоги. null-рейтинг (порог сделок не достигнут) не рендерится:
 * новичков не наказываем отсутствием цифры.
 */
import { Badge } from '@agromoll/ui';
import type { RatingSummaryDto } from '@agromoll/types';

export interface RatingBadgeProps {
  rating: RatingSummaryDto | null | undefined;
  /** Компактный вариант без числа сделок (для плотных карточек). */
  short?: boolean;
}

/** Порог «зелёного» рейтинга: ниже — янтарный акцент. */
const GOOD_SCORE = 4.0;

/** «42 сделки» — правильная форма для 1/21–24 и 25+; «сделки» для 2–4. */
function dealsLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return '1 сделка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} сделки`;
  }
  return `${count} сделок`;
}

export function RatingBadge({ rating, short = false }: RatingBadgeProps) {
  if (!rating || typeof rating.score !== 'number') {
    return null;
  }
  const variant = rating.score >= GOOD_SCORE ? 'success' : 'attention';
  const label = short
    ? rating.score.toFixed(1)
    : `${rating.score.toFixed(1)} · ${dealsLabel(rating.dealsCount)}`;
  return <Badge label={label} variant={variant} />;
}

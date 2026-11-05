/**
 * Форматирование цен, количеств и времени — единое для всех экранов.
 */
import type { BookingStatus, DebtStatus, ListingUnit } from '@agromoll/types';
import { LISTING_UNIT_LABELS } from '@agromoll/types';

/** «85,50 ₽/кг» — цена всегда с двумя знаками, копейки важны на опте. */
export function formatPrice(pricePerUnit: string, unit: ListingUnit): string {
  const value = Number.parseFloat(pricePerUnit);
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toFixed(2).replace('.', ',')} ₽/${LISTING_UNIT_LABELS[unit]}`;
}

/** «Осталось 40 кг» / «Осталось 3 ящ» — свободный остаток. */
export function formatAvailable(quantity: number, unit: ListingUnit): string {
  return `Осталось ${quantity} ${LISTING_UNIT_LABELS[unit]}`;
}

/** «20 кг» — количество в брони. */
export function formatQuantity(quantity: number, unit?: ListingUnit): string {
  const unitLabel = unit ? ` ${LISTING_UNIT_LABELS[unit]}` : '';
  return `${quantity}${unitLabel}`;
}

/** «9:42» — время истечения брони. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** Вариант бейджа статуса брони: серый → янтарный → зелёный (ADR-002). */
export function bookingBadgeVariant(status: BookingStatus): 'success' | 'attention' | 'neutral' {
  switch (status) {
    case 'confirmed':
      return 'success';
    case 'counter_offered':
      return 'attention';
    default:
      // requested / cancelled / expired — спокойный нейтральный
      return 'neutral';
  }
}

/**
 * «12 500 ₽» / «12 500,50 ₽» — сумма долга из строки Decimal:
 * пробел-разделитель тысяч, копейки — только если есть.
 */
export function formatMoney(amount: string): string {
  const value = Number.parseFloat(amount);
  const safe = Number.isFinite(value) ? value : 0;
  const hasKopecks = Math.round(safe * 100) % 100 !== 0;
  const fixed = hasKopecks
    ? safe.toFixed(2).replace('.', ',')
    : String(Math.round(safe));
  return `${fixed.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')} ₽`;
}

/**
 * Вариант бейджа статуса долга (ADR-010): settled — зелёный,
 * disputed — янтарный, active/cancelled — нейтральный.
 * Просроченный active получает янтарный прямо в карточке (isOverdue).
 */
export function debtBadgeVariant(status: DebtStatus): 'success' | 'attention' | 'neutral' {
  switch (status) {
    case 'settled':
      return 'success';
    case 'disputed':
      return 'attention';
    default:
      return 'neutral';
  }
}

/** Строка с описанием предложения продавца в брони. */
export function describeCounterOffer(offer: {
  offeredQuantity?: number;
  pickupTime?: string;
  note?: string;
}): string {
  const parts: string[] = [];
  if (offer.offeredQuantity !== undefined) parts.push(`${offer.offeredQuantity}`);
  if (offer.pickupTime !== undefined) parts.push(offer.pickupTime);
  if (offer.note !== undefined) parts.push(offer.note);
  return parts.join(' · ');
}

import {
  bookingBadgeVariant,
  formatAvailable,
  formatClock,
  formatPrice,
  formatQuantity,
} from './format';

describe('форматтеры', () => {
  it('formatPrice: «85,50 ₽/кг» — копейки обязательны', () => {
    expect(formatPrice('85.5', 'kg')).toBe('85,50 ₽/кг');
    expect(formatPrice('1250', 'box')).toBe('1250,00 ₽/ящик');
    expect(formatPrice('41.00', 'kg')).toBe('41,00 ₽/кг');
  });

  it('formatPrice: мусорная цена не роняет приложение', () => {
    expect(formatPrice('н/д', 'kg')).toBe('0,00 ₽/кг');
  });

  it('formatAvailable: свободный остаток с единицей', () => {
    expect(formatAvailable(40, 'kg')).toBe('Осталось 40 кг');
    expect(formatAvailable(3, 'box')).toBe('Осталось 3 ящик');
    expect(formatAvailable(12, 'piece')).toBe('Осталось 12 шт');
  });

  it('formatQuantity: количество брони', () => {
    expect(formatQuantity(20, 'kg')).toBe('20 кг');
    expect(formatQuantity(5)).toBe('5');
  });

  it('formatClock: время истечения брони', () => {
    expect(formatClock(new Date('2026-11-05T09:42:00').toISOString())).toBe('09:42');
  });

  it('bookingBadgeVariant: серый → янтарный → зелёный (ADR-002)', () => {
    expect(bookingBadgeVariant('requested')).toBe('neutral');
    expect(bookingBadgeVariant('counter_offered')).toBe('attention');
    expect(bookingBadgeVariant('confirmed')).toBe('success');
    expect(bookingBadgeVariant('cancelled')).toBe('neutral');
    expect(bookingBadgeVariant('expired')).toBe('neutral');
  });
});

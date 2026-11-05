/**
 * Демо-данные: показываются, когда API недоступен (офлайн-устойчивость v0.2.0).
 *
 * Данные размечены бейджем «Демо-данные» — пользователь всегда понимает,
 * что смотрит витрину без сервера. Форма полностью совпадает с DTO API.
 */
import type { BookingDto, ListingDto } from '@agromoll/types';
import { DEMO_ACCOUNTS } from '@agromoll/types';

const NOW = new Date();
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
const minutesFromNow = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();

export const DEMO_LISTINGS: ListingDto[] = [
  {
    id: 'demo-listing-1',
    sellerId: DEMO_ACCOUNTS.seller.id,
    sellerName: DEMO_ACCOUNTS.seller.displayName,
    title: 'Помидоры розовые',
    category: 'vegetables',
    unit: 'kg',
    pricePerUnit: '85.50',
    quantityAvailable: 120,
    quantityReserved: 30,
    quantityAvailableForBooking: 90,
    lineNumber: 12,
    isPerishable: true,
    status: 'active',
    createdAt: hoursFromNow(-6),
    updatedAt: hoursFromNow(-1),
  },
  {
    id: 'demo-listing-2',
    sellerId: DEMO_ACCOUNTS.seller.id,
    sellerName: DEMO_ACCOUNTS.seller.displayName,
    title: 'Лук репчатый, ящик',
    category: 'vegetables',
    unit: 'box',
    pricePerUnit: '640.00',
    quantityAvailable: 25,
    quantityReserved: 5,
    quantityAvailableForBooking: 20,
    lineNumber: 4,
    isPerishable: false,
    status: 'active',
    createdAt: hoursFromNow(-8),
    updatedAt: hoursFromNow(-8),
  },
  {
    id: 'demo-listing-3',
    sellerId: DEMO_ACCOUNTS.seller.id,
    sellerName: DEMO_ACCOUNTS.seller.displayName,
    title: 'Картофель молодой',
    category: 'vegetables',
    unit: 'kg',
    pricePerUnit: '41.00',
    quantityAvailable: 400,
    quantityReserved: 380,
    quantityAvailableForBooking: 20,
    lineNumber: 8,
    isPerishable: false,
    status: 'active',
    createdAt: hoursFromNow(-12),
    updatedAt: hoursFromNow(-2),
  },
  {
    id: 'demo-listing-4',
    sellerId: DEMO_ACCOUNTS.seller.id,
    sellerName: DEMO_ACCOUNTS.seller.displayName,
    title: 'Сухарики «Три корочки», коробка',
    category: 'snacks',
    unit: 'box',
    pricePerUnit: '1250.00',
    quantityAvailable: 10,
    quantityReserved: 0,
    quantityAvailableForBooking: 10,
    lineNumber: 21,
    isPerishable: false,
    status: 'active',
    createdAt: hoursFromNow(-24),
    updatedAt: hoursFromNow(-24),
  },
];

export const DEMO_BUYER_BOOKINGS: BookingDto[] = [
  {
    id: 'demo-booking-1',
    listingId: 'demo-listing-1',
    listingTitle: 'Помидоры розовые',
    listingUnit: 'kg',
    buyerId: DEMO_ACCOUNTS.buyer.id,
    buyerName: DEMO_ACCOUNTS.buyer.displayName,
    requestedQuantity: 20,
    confirmedQuantity: null,
    status: 'counter_offered',
    expiresAt: minutesFromNow(18),
    createdAt: minutesFromNow(-12),
    updatedAt: minutesFromNow(-4),
  },
  {
    id: 'demo-booking-2',
    listingId: 'demo-listing-2',
    listingTitle: 'Лук репчатый, ящик',
    listingUnit: 'box',
    buyerId: DEMO_ACCOUNTS.buyer.id,
    buyerName: DEMO_ACCOUNTS.buyer.displayName,
    requestedQuantity: 3,
    confirmedQuantity: 3,
    status: 'confirmed',
    expiresAt: minutesFromNow(42),
    createdAt: minutesFromNow(-30),
    updatedAt: minutesFromNow(-25),
  },
  {
    id: 'demo-booking-3',
    listingId: 'demo-listing-3',
    listingTitle: 'Картофель молодой',
    listingUnit: 'kg',
    buyerId: DEMO_ACCOUNTS.buyer.id,
    buyerName: DEMO_ACCOUNTS.buyer.displayName,
    requestedQuantity: 50,
    confirmedQuantity: null,
    status: 'requested',
    expiresAt: minutesFromNow(25),
    createdAt: minutesFromNow(-5),
    updatedAt: minutesFromNow(-5),
  },
];

/** Последнее корректировочное предложение для демо-брони counter_offered. */
export const DEMO_COUNTER_OFFERS: Record<
  string,
  { offeredQuantity?: number; pickupTime?: string; note?: string }
> = {
  'demo-booking-1': { offeredQuantity: 15, pickupTime: 'после 9:00' },
};

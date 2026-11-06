/**
 * Демо-данные: показываются, когда API недоступен (офлайн-устойчивость v0.2.0).
 *
 * Данные размечены янтарным баннером DemoBanner «Демо-режим. API недоступен.
 * Данные не настоящие» (v0.6.1-D, ADR-026) — пользователь всегда понимает,
 * что смотрит витрину без сервера. Форма полностью совпадает с DTO API.
 *
 * v0.6.1-D: демо-брони удалены — «Мои брони» и «Входящие» больше не
 * показывают выдуманных обязательств (вариант A, ADR-026). Остаются
 * только витринные сущности: лоты (лента/витрина), долги, детали лота.
 */
import type { DebtDto, ListingDto } from '@agromoll/types';
import { DEMO_ACCOUNTS } from '@agromoll/types';

const NOW = new Date();
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

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

// ─── Долги (v0.4.0, ADR-010) ────────────────────────────────────────────────

const daysFromNow = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

/** Демо-долги: продавец дал в долг покупателю (2 записи) и должен сам (1). */
export const DEMO_DEBTS: DebtDto[] = [
  {
    id: 'demo-debt-1',
    creditorId: DEMO_ACCOUNTS.seller.id,
    creditorName: DEMO_ACCOUNTS.seller.displayName,
    debtorId: DEMO_ACCOUNTS.buyer.id,
    debtorName: DEMO_ACCOUNTS.buyer.displayName,
    amount: '12500.00',
    currency: 'RUB',
    description: 'Помидоры розовые, 2 ящика',
    listingId: null,
    bookingId: null,
    status: 'active',
    isOverdue: true,
    canRemind: true,
    nextReminderAt: null,
    resolveRequestedById: null,
    createdAt: daysFromNow(34),
    updatedAt: daysFromNow(34),
    settledAt: null,
  },
  {
    id: 'demo-debt-2',
    creditorId: DEMO_ACCOUNTS.seller.id,
    creditorName: DEMO_ACCOUNTS.seller.displayName,
    debtorId: DEMO_ACCOUNTS.buyer.id,
    debtorName: DEMO_ACCOUNTS.buyer.displayName,
    amount: '4200.50',
    currency: 'RUB',
    description: 'Лук репчатый',
    listingId: null,
    bookingId: null,
    status: 'active',
    isOverdue: false,
    canRemind: false,
    nextReminderAt: hoursFromNow(20),
    resolveRequestedById: null,
    createdAt: daysFromNow(3),
    updatedAt: daysFromNow(3),
    settledAt: null,
  },
  {
    id: 'demo-debt-3',
    creditorId: DEMO_ACCOUNTS.driver.id,
    creditorName: DEMO_ACCOUNTS.driver.displayName,
    debtorId: DEMO_ACCOUNTS.seller.id,
    debtorName: DEMO_ACCOUNTS.seller.displayName,
    amount: '800.00',
    currency: 'RUB',
    description: 'Доставка до Левенцовки',
    listingId: null,
    bookingId: null,
    status: 'settled',
    isOverdue: false,
    canRemind: false,
    nextReminderAt: null,
    resolveRequestedById: null,
    createdAt: daysFromNow(10),
    updatedAt: daysFromNow(9),
    settledAt: daysFromNow(9),
  },
];

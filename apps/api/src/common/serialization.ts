/**
 * Мапперы Prisma-моделей в DTO из @agromoll/types.
 *
 * API всегда отвечает сериализуемыми DTO: даты — ISO-строки,
 * Decimal — строки (точность денег не теряется в JSON).
 */
import type { Booking, Listing } from '@prisma/client';
import type { BookingDto, ListingDto, RatingSummaryDto } from '@agromoll/types';

type ReputationView = { score: number | null; dealsCount: number } | null;

type ListingWithSeller = Listing & {
  seller?: ({ displayName: string } & { reputation?: ReputationView | null }) | null;
};

type BookingWithRelations = Booking & {
  listing?:
    | ({ title: string; unit: BookingDto['listingUnit'] } & {
        seller?: { reputation?: ReputationView | null } | null;
      })
    | null;
  buyer?: ({ displayName: string } & { reputation?: ReputationView | null }) | null;
};

/** Снимок рейтинга → сводка для бейджа. score=null не показываем (ADR-013). */
export function toRatingSummaryDto(snapshot: ReputationView): RatingSummaryDto | null {
  return snapshot && snapshot.score !== null
    ? { score: snapshot.score, dealsCount: snapshot.dealsCount }
    : null;
}

export function toListingDto(listing: ListingWithSeller): ListingDto {
  return {
    id: listing.id,
    sellerId: listing.sellerId,
    sellerName: listing.seller?.displayName,
    sellerRating: toRatingSummaryDto(listing.seller?.reputation ?? null),
    title: listing.title,
    category: listing.category,
    unit: listing.unit,
    pricePerUnit: listing.pricePerUnit.toString(),
    quantityAvailable: listing.quantityAvailable,
    quantityReserved: listing.quantityReserved,
    quantityAvailableForBooking: listing.quantityAvailable - listing.quantityReserved,
    lineNumber: listing.lineNumber,
    isPerishable: listing.isPerishable,
    status: listing.status,
    createdAt: listing.createdAt.toISOString(),
    updatedAt: listing.updatedAt.toISOString(),
  };
}

export function toBookingDto(booking: BookingWithRelations): BookingDto {
  return {
    id: booking.id,
    listingId: booking.listingId,
    listingTitle: booking.listing?.title,
    listingUnit: booking.listing?.unit,
    buyerId: booking.buyerId,
    buyerName: booking.buyer?.displayName,
    sellerRating: toRatingSummaryDto(booking.listing?.seller?.reputation ?? null),
    buyerRating: toRatingSummaryDto(booking.buyer?.reputation ?? null),
    requestedQuantity: booking.requestedQuantity,
    confirmedQuantity: booking.confirmedQuantity,
    status: booking.status,
    expiresAt: booking.expiresAt.toISOString(),
    confirmedAt: booking.confirmedAt?.toISOString() ?? null,
    deliveryConfirmedAt: booking.deliveryConfirmedAt?.toISOString() ?? null,
    receivedQuantity: booking.receivedQuantity,
    qualityNotes: booking.qualityNotes,
    qualityFlag: booking.qualityFlag,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
  };
}

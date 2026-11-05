/**
 * Мапперы Prisma-моделей в DTO из @agromoll/types.
 *
 * API всегда отвечает сериализуемыми DTO: даты — ISO-строки,
 * Decimal — строки (точность денег не теряется в JSON).
 */
import type { Booking, Listing } from '@prisma/client';
import type { BookingDto, ListingDto } from '@agromoll/types';

type ListingWithSeller = Listing & { seller?: { displayName: string } | null };

type BookingWithRelations = Booking & {
  listing?: { title: string; unit: BookingDto['listingUnit'] } | null;
  buyer?: { displayName: string } | null;
};

export function toListingDto(listing: ListingWithSeller): ListingDto {
  return {
    id: listing.id,
    sellerId: listing.sellerId,
    sellerName: listing.seller?.displayName,
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

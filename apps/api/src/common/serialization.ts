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

// ─── Арбитраж споров (v0.6.0-C, ADR-033) ───────────────────────────────────

import type {
  DisputeDetailDto,
  DisputeDto,
  DisputeEvidenceDto,
  DisputeMessageDto,
  UserRole,
} from '@agromoll/types';

/** Участник кейса с именем и ролью (без личных данных). */
type PartyView = { id: string; displayName: string; role: UserRole };

/** Связи кейса для DTO: стороны, автор, счётчики. */
type DisputeView = {
  id: string;
  type: DisputeDto['type'];
  referenceId: string;
  subject: string;
  status: DisputeDto['status'];
  firstPartyId: string;
  secondPartyId: string;
  openedById: string;
  openedAt: Date;
  assignedAt: Date | null;
  resolution: DisputeDto['resolution'];
  resolvedAt: Date | null;
  notes: string | null;
  firstParty: PartyView;
  secondParty: PartyView;
  openedBy: PartyView;
  assignedTo: PartyView | null;
  messages?: Array<{
    id: string;
    author: PartyView;
    body: string;
    isInternal: boolean;
    createdAt: Date;
  }>;
  evidence?: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedBy: PartyView;
    createdAt: Date;
  }>;
  _count?: { messages?: number; evidence?: number };
};

function partyDto(party: PartyView): DisputeDto['firstParty'] {
  return { id: party.id, displayName: party.displayName, role: party.role };
}

/** Кейс → DTO списка. Счётчики — из _count (include { _count }). */
export function toDisputeDto(dispute: DisputeView): DisputeDto {
  return {
    id: dispute.id,
    type: dispute.type,
    referenceId: dispute.referenceId,
    subject: dispute.subject,
    status: dispute.status,
    firstParty: partyDto(dispute.firstParty),
    secondParty: partyDto(dispute.secondParty),
    openedBy: partyDto(dispute.openedBy),
    openedAt: dispute.openedAt.toISOString(),
    assignedTo: dispute.assignedTo ? partyDto(dispute.assignedTo) : null,
    assignedAt: dispute.assignedAt?.toISOString() ?? null,
    resolution: dispute.resolution,
    resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
    notes: dispute.notes,
    messagesCount: dispute._count?.messages ?? dispute.messages?.length ?? 0,
    evidenceCount: dispute._count?.evidence ?? dispute.evidence?.length ?? 0,
  };
}

/** Кейс + переписка (isInternal уже отфильтрованы для не-арбитра). */
export function toDisputeDetailDto(dispute: DisputeView): DisputeDetailDto {
  return {
    ...toDisputeDto(dispute),
    messages: (dispute.messages ?? []).map((m): DisputeMessageDto => ({
      id: m.id,
      author: partyDto(m.author),
      body: m.body,
      isInternal: m.isInternal,
      createdAt: m.createdAt.toISOString(),
    })),
    evidence: (dispute.evidence ?? []).map((e): DisputeEvidenceDto => ({
      id: e.id,
      fileName: e.fileName,
      mimeType: e.mimeType,
      sizeBytes: e.sizeBytes,
      uploadedBy: partyDto(e.uploadedBy),
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

// ─── Апелляции на блокировки 289-ФЗ (v0.6.0-E, ADR-035) ────────────────────

import type { AppealDetailDto, AppealDto } from '@agromoll/types';

/** Связи кейса апелляции для DTO: пара, автор, арбитр. */
type AppealView = {
  id: string;
  blockedPairId: string;
  driverId: string;
  sellerId: string;
  appellantId: string;
  reason: string;
  status: AppealDto['status'];
  openedAt: Date;
  assignedAt: Date | null;
  resolvedAt: Date | null;
  notes: string | null;
  driver: PartyView;
  seller: PartyView;
  appellant: PartyView;
  assignedTo: PartyView | null;
};

/** Апелляция → DTO списка. */
export function toAppealDto(appeal: AppealView): AppealDto {
  return {
    id: appeal.id,
    blockedPairId: appeal.blockedPairId,
    driver: partyDto(appeal.driver),
    seller: partyDto(appeal.seller),
    appellant: partyDto(appeal.appellant),
    reason: appeal.reason,
    status: appeal.status,
    openedAt: appeal.openedAt.toISOString(),
    assignedTo: appeal.assignedTo ? partyDto(appeal.assignedTo) : null,
    assignedAt: appeal.assignedAt?.toISOString() ?? null,
    resolvedAt: appeal.resolvedAt?.toISOString() ?? null,
    notes: appeal.notes,
  };
}

/** Апелляция + история месяцев часов пары (доказательство арбитра). */
export function toAppealDetailDto(
  appeal: AppealView,
  months: Array<{ month: string; totalMinutes: number; monthCounted: boolean }>,
): AppealDetailDto {
  return {
    ...toAppealDto(appeal),
    months: months.map((m) => ({
      month: m.month,
      totalMinutes: m.totalMinutes,
      monthCounted: m.monthCounted,
    })),
  };
}

-- АгроМолл: миграция v0.2.0 «Модель бронирования».
--
-- User дополняется профилем (displayName, phone, reputationScore),
-- добавляются Listing (лот продавца), Booking (бронь покупателя) и
-- BookingEvent (append-only журнал — источник будущей репутации).
--
-- Примечание: колонка "displayName" NOT NULL без DEFAULT. На этапе v0.1.0
-- таблица users была пустой каркасом (без профилей), поэтому миграция
-- рассчитана на пустую таблицу — pre-production окружения пересоздаются.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "displayName" TEXT NOT NULL,
                     ADD COLUMN "phone" TEXT,
                     ADD COLUMN "reputationScore" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateEnum
CREATE TYPE "ListingCategory" AS ENUM ('vegetables', 'fruits', 'grocery', 'snacks', 'other');

-- CreateEnum
CREATE TYPE "ListingUnit" AS ENUM ('kg', 'box', 'piece');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('active', 'paused', 'sold_out', 'archived');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('requested', 'counter_offered', 'confirmed', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "BookingAction" AS ENUM ('created', 'counter_offered', 'accepted_counter', 'confirmed', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "ListingCategory" NOT NULL,
    "unit" "ListingUnit" NOT NULL,
    "pricePerUnit" DECIMAL(10,2) NOT NULL,
    "quantityAvailable" INTEGER NOT NULL,
    "quantityReserved" INTEGER NOT NULL DEFAULT 0,
    "lineNumber" INTEGER,
    "isPerishable" BOOLEAN NOT NULL DEFAULT false,
    "status" "ListingStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "requestedQuantity" INTEGER NOT NULL,
    "confirmedQuantity" INTEGER,
    "status" "BookingStatus" NOT NULL DEFAULT 'requested',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_events" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" "BookingAction" NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listings_sellerId_idx" ON "listings"("sellerId");

-- CreateIndex
CREATE INDEX "listings_status_idx" ON "listings"("status");

-- CreateIndex
CREATE INDEX "listings_category_idx" ON "listings"("category");

-- CreateIndex
CREATE INDEX "bookings_buyerId_idx" ON "bookings"("buyerId");

-- CreateIndex
CREATE INDEX "bookings_listingId_idx" ON "bookings"("listingId");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "booking_events_bookingId_idx" ON "booking_events"("bookingId");

-- CreateIndex
CREATE INDEX "booking_events_actorId_idx" ON "booking_events"("actorId");

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

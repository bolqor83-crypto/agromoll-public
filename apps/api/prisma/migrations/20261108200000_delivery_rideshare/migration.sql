-- Доставка попутчиками (v0.5.0-C, ADR-015): DeliveryRequest +
-- DeliveryEvent + операции outbox. Платформа НЕ агент: цены нет.

-- AlterEnum: операции доставки в идемпотентном журнале (ADR-006/015)
ALTER TYPE "OutboxOperationType" ADD VALUE 'create_delivery';
ALTER TYPE "OutboxOperationType" ADD VALUE 'assign_delivery';
ALTER TYPE "OutboxOperationType" ADD VALUE 'start_delivery';
ALTER TYPE "OutboxOperationType" ADD VALUE 'deliver_delivery';
ALTER TYPE "OutboxOperationType" ADD VALUE 'cancel_delivery';

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('open', 'assigned', 'in_transit', 'delivered', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "DeliveryEventAction" AS ENUM ('created', 'assigned', 'started', 'delivered', 'cancelled', 'expired', 'blocked_by_289fz');

-- CreateTable
CREATE TABLE "delivery_requests" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "bookingId" TEXT,
    "pickupPointId" TEXT NOT NULL,
    "dropoffPointId" TEXT NOT NULL,
    "weightKg" DECIMAL(8,2) NOT NULL,
    "description" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'open',
    "assignedDriverId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "pickupCode" TEXT NOT NULL,
    "dropoffCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_events" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" "DeliveryEventAction" NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_requests_buyerId_status_idx" ON "delivery_requests"("buyerId", "status");

-- CreateIndex
CREATE INDEX "delivery_requests_assignedDriverId_status_idx" ON "delivery_requests"("assignedDriverId", "status");

-- CreateIndex
CREATE INDEX "delivery_requests_status_expiresAt_idx" ON "delivery_requests"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "delivery_requests_createdAt_idx" ON "delivery_requests"("createdAt");

-- CreateIndex
CREATE INDEX "delivery_events_deliveryId_idx" ON "delivery_events"("deliveryId");

-- AddForeignKey
ALTER TABLE "delivery_requests" ADD CONSTRAINT "delivery_requests_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_requests" ADD CONSTRAINT "delivery_requests_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_requests" ADD CONSTRAINT "delivery_requests_pickupPointId_fkey" FOREIGN KEY ("pickupPointId") REFERENCES "geo_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_requests" ADD CONSTRAINT "delivery_requests_dropoffPointId_fkey" FOREIGN KEY ("dropoffPointId") REFERENCES "geo_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_requests" ADD CONSTRAINT "delivery_requests_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "delivery_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

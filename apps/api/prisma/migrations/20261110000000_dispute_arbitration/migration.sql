-- Арбитраж споров (v0.6.0-C, ADR-033): кейсы, сообщения, доказательства.
--
-- UserRole += arbitrator — арбитр рынка. Роль НЕ доступна через
-- PATCH /users/me/role (там только рыночные роли): арбитром назначают
-- вручную/сидом, чтобы исключить конфликт интересов.
--
-- NotificationType += dispute_* — события арбитража для in-app/push.
--
-- Ключевой инвариант — один АКТИВНЫЙ спор на объект: частичный
-- unique-индекс ниже пропускает закрытые (resolved/dismissed) кейсы,
-- поэтому по одному объекту можно спорить снова после закрытия,
-- но не дважды одновременно. Гонку двух одновременных POST /disputes
-- ловит именно индекс (сервис проверяет дубликат до вставки, индекс —
-- последний рубеж: P2002 → 409).

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'arbitrator';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'dispute_opened';
ALTER TYPE "NotificationType" ADD VALUE 'dispute_message';
ALTER TYPE "NotificationType" ADD VALUE 'dispute_assigned';
ALTER TYPE "NotificationType" ADD VALUE 'dispute_resolved';

-- AlterEnum: идемпотентные операции арбитража (ADR-006/033).
ALTER TYPE "OutboxOperationType" ADD VALUE 'open_dispute';
ALTER TYPE "OutboxOperationType" ADD VALUE 'dispute_message';
ALTER TYPE "OutboxOperationType" ADD VALUE 'dispute_evidence';
ALTER TYPE "OutboxOperationType" ADD VALUE 'assign_dispute';
ALTER TYPE "OutboxOperationType" ADD VALUE 'resolve_dispute';

-- CreateEnum
CREATE TYPE "DisputeType" AS ENUM ('booking', 'delivery', 'debt');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('open', 'under_review', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "DisputeResolution" AS ENUM ('favor_buyer', 'favor_seller', 'compromise', 'no_fault');

-- CreateTable
CREATE TABLE "dispute_cases" (
    "id" TEXT NOT NULL,
    "type" "DisputeType" NOT NULL,
    "referenceId" TEXT NOT NULL,
    "firstPartyId" TEXT NOT NULL,
    "secondPartyId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DisputeStatus" NOT NULL DEFAULT 'open',
    "assignedToId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "resolution" "DisputeResolution",
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispute_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_messages" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_evidence" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "dataBase64" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dispute_cases_status_openedAt_idx" ON "dispute_cases"("status", "openedAt");
CREATE INDEX "dispute_cases_firstPartyId_idx" ON "dispute_cases"("firstPartyId");
CREATE INDEX "dispute_cases_secondPartyId_idx" ON "dispute_cases"("secondPartyId");
CREATE INDEX "dispute_cases_type_referenceId_idx" ON "dispute_cases"("type", "referenceId");
CREATE INDEX "dispute_messages_disputeId_createdAt_idx" ON "dispute_messages"("disputeId", "createdAt");
CREATE INDEX "dispute_evidence_disputeId_idx" ON "dispute_evidence"("disputeId");

-- AddForeignKey
ALTER TABLE "dispute_cases" ADD CONSTRAINT "dispute_cases_firstPartyId_fkey" FOREIGN KEY ("firstPartyId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_cases" ADD CONSTRAINT "dispute_cases_secondPartyId_fkey" FOREIGN KEY ("secondPartyId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_cases" ADD CONSTRAINT "dispute_cases_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_cases" ADD CONSTRAINT "dispute_cases_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dispute_cases" ADD CONSTRAINT "dispute_cases_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "dispute_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "dispute_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex (частичный unique): один АКТИВНЫЙ спор на объект.
-- Закрытые кейсы (resolved/dismissed) не мешают открыть спор снова.
CREATE UNIQUE INDEX "dispute_cases_one_active_per_object"
ON "dispute_cases" ("type", "referenceId")
WHERE status IN ('open', 'under_review');

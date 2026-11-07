-- Блокировки 289-ФЗ: арбитражный разблок и апелляции (v0.6.0-E, ADR-035).
--
-- BlockedPair становится историей, а не приговором: строка при разблоке
-- не удаляется, а помечается (unblockedAt/unblockedById/unblockReason) —
-- аудит «кто, когда и почему снял» остаётся навсегда. Активна максимум
-- одна блокировка на пару: частичный unique-индекс заменяет полную
-- уникальность (driverId, sellerId) — снятые строки не мешают паре
-- заблокироваться снова, когда серия месяцев закроется опять.
--
-- AppealCase — обжалование АКТИВНОЙ блокировки пары водитель–продавец:
-- open → under_review → unblocked | rejected. Один АКТИВНЫЙ кейс на
-- блокировку — частичный unique-индекс (как «один активный спор на
-- объект», ADR-033); после закрытия подать снова можно.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'appeal_opened';
ALTER TYPE "NotificationType" ADD VALUE 'appeal_assigned';
ALTER TYPE "NotificationType" ADD VALUE 'appeal_resolved';

-- AlterEnum: идемпотентные операции апелляций (ADR-006/035).
ALTER TYPE "OutboxOperationType" ADD VALUE 'open_appeal';
ALTER TYPE "OutboxOperationType" ADD VALUE 'assign_appeal';
ALTER TYPE "OutboxOperationType" ADD VALUE 'resolve_appeal';

-- AlterTable: след разблока (NULL в unblockedAt — блокировка активна).
ALTER TABLE "blocked_pairs" ADD COLUMN     "unblockedAt"   TIMESTAMP(3);
ALTER TABLE "blocked_pairs" ADD COLUMN     "unblockedById" TEXT;
ALTER TABLE "blocked_pairs" ADD COLUMN     "unblockReason" TEXT;

-- DropIndex: полная уникальность пары → частичная (только активные).
-- Имя — из миграции 20261107010000_work_hours_289fz.
DROP INDEX "blocked_pairs_driverId_sellerId_key";

-- CreateIndex: обычный индекс — чтение всей истории блокировок пары.
CREATE INDEX "blocked_pairs_driverId_sellerId_idx" ON "blocked_pairs"("driverId", "sellerId");

-- CreateIndex (частичный unique): активная блокировка одна на пару.
CREATE UNIQUE INDEX "blocked_pairs_one_active_per_pair"
ON "blocked_pairs" ("driverId", "sellerId")
WHERE "unblockedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "blocked_pairs" ADD CONSTRAINT "blocked_pairs_unblockedById_fkey" FOREIGN KEY ("unblockedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('open', 'under_review', 'unblocked', 'rejected');

-- CreateTable
CREATE TABLE "appeal_cases" (
    "id" TEXT NOT NULL,
    "blockedPairId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "appellantId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'open',
    "assignedToId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appeal_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appeal_cases_status_openedAt_idx" ON "appeal_cases"("status", "openedAt");
CREATE INDEX "appeal_cases_driverId_sellerId_idx" ON "appeal_cases"("driverId", "sellerId");

-- CreateIndex (частичный unique): один АКТИВНЫЙ кейс на блокировку.
-- Закрытые (unblocked/rejected) не мешают подать снова — например,
-- после отклонения появились новые данные.
CREATE UNIQUE INDEX "appeal_cases_one_active_per_block"
ON "appeal_cases" ("blockedPairId")
WHERE status IN ('open', 'under_review');

-- AddForeignKey
ALTER TABLE "appeal_cases" ADD CONSTRAINT "appeal_cases_blockedPairId_fkey" FOREIGN KEY ("blockedPairId") REFERENCES "blocked_pairs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appeal_cases" ADD CONSTRAINT "appeal_cases_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appeal_cases" ADD CONSTRAINT "appeal_cases_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appeal_cases" ADD CONSTRAINT "appeal_cases_appellantId_fkey" FOREIGN KEY ("appellantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appeal_cases" ADD CONSTRAINT "appeal_cases_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "appeal_cases" ADD CONSTRAINT "appeal_cases_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

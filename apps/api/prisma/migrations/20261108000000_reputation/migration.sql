-- Публичный рейтинг (v0.5.0-A, ADR-013)
-- ReputationSnapshot: один актуальный снимок рейтинга на пользователя
-- (уникальный userId). ReputationEvent: append-only журнал изменений.

-- CreateEnum
CREATE TYPE "ReputationAction" AS ENUM ('deal_confirmed', 'dispute_opened', 'dispute_resolved', 'auto_confirmed', 'penalty_applied');

-- CreateTable
CREATE TABLE "reputation_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "dealsCount" INTEGER NOT NULL DEFAULT 0,
    "disputesCount" INTEGER NOT NULL DEFAULT 0,
    "autoConfirmedCount" INTEGER NOT NULL DEFAULT 0,
    "lastCalculatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reputation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reputation_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "ReputationAction" NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reputation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reputation_snapshots_userId_key" ON "reputation_snapshots"("userId");

-- CreateIndex
CREATE INDEX "reputation_events_userId_createdAt_idx" ON "reputation_events"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "reputation_snapshots" ADD CONSTRAINT "reputation_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation_events" ADD CONSTRAINT "reputation_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

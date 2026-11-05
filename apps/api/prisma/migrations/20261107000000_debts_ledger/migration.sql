-- АгроМолл: миграция v0.4.0 «Долги (Ledger)» (подэтап A, ADR-010).
--
-- Debt — записанная договорённость «товар отпущен в долг»: платформа НЕ
-- является платёжным агентом, строки — только учёт. DebtEvent — append-only
-- журнал переходов статуса: из него в v0.5.0 будет считаться «надёжность
-- оплаты» (репутация). Notification — минимальные in-app уведомления
-- (напоминание должнику); push через FCM — если есть токен и ключ сервера.
--
-- Новый статус спора решается обоюдно: resolveRequestedBy хранит, кто из
-- сторон ПЕРВЫМ подтвердил разрешение; подтверждение второй стороной
-- закрывает спор (status → settled). Оба действия пишутся в DebtEvent.
--
-- Индексы: (debtorId, status) и (creditorId, status) — списки «я должен» /
-- «мне должны» с фильтром статуса; createdAt — сортировка и выгрузки.
-- FK: users — RESTRICT (долг без участника не имеет смысла — это
-- договорённость), listings/bookings — SET NULL (лот/бронь могут уйти,
-- запись долга остаётся), debt_events.debt — CASCADE (журнал без долга
-- не нужен), actor — SET NULL (участник уехал с рынка — история остаётся).

-- AlterEnum
-- Новые значения OutboxOperationType (PG 12+: ADD VALUE в транзакции
-- допустим, значения в этой же транзакции не используются).
ALTER TYPE "OutboxOperationType" ADD VALUE 'settle_debt';
ALTER TYPE "OutboxOperationType" ADD VALUE 'dispute_debt';
ALTER TYPE "OutboxOperationType" ADD VALUE 'resolve_debt';

-- AlterTable
-- Токен FCM: NULL — push недоступен, уведомление доставляется только in-app.
ALTER TABLE "users" ADD COLUMN "fcmToken" TEXT;

-- CreateEnum
CREATE TYPE "DebtStatus" AS ENUM ('active', 'settled', 'disputed', 'cancelled');

-- CreateEnum
CREATE TYPE "DebtAction" AS ENUM ('created', 'settled', 'disputed', 'cancelled', 'reminder_sent', 'resolve_requested', 'resolve_confirmed');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('debt_reminder');

-- CreateTable
CREATE TABLE "debts" (
    "id" TEXT NOT NULL,
    "creditorId" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "description" TEXT,
    "listingId" TEXT,
    "bookingId" TEXT,
    "status" "DebtStatus" NOT NULL DEFAULT 'active',
    "resolveRequestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "debts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_events" (
    "id" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" "DebtAction" NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "debts_debtorId_status_idx" ON "debts"("debtorId", "status");
CREATE INDEX "debts_creditorId_status_idx" ON "debts"("creditorId", "status");
CREATE INDEX "debts_createdAt_idx" ON "debts"("createdAt");
CREATE INDEX "debt_events_debtId_idx" ON "debt_events"("debtId");
CREATE INDEX "debt_events_actorId_idx" ON "debt_events"("actorId");
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_creditorId_fkey" FOREIGN KEY ("creditorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "debts" ADD CONSTRAINT "debts_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "debts" ADD CONSTRAINT "debts_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "debts" ADD CONSTRAINT "debts_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "debt_events" ADD CONSTRAINT "debt_events_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "debts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "debt_events" ADD CONSTRAINT "debt_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

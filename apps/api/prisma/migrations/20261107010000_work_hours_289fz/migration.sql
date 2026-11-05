-- АгроМолл: миграция v0.4.0 «Учёт часов 289-ФЗ» (подэтап B, ADR-011).
--
-- Юридическая страховка платформы: самозанятый водитель, работающий
-- 60+ часов в месяц с одним продавцом 6 месяцев подряд, — признак
-- трудовых отношений (289-ФЗ, штраф до 500 тыс. ₽). Платформа считает
-- часы пар «водитель — продавец» и требует паузу. В интерфейсе НЕТ
-- денег — только часы.
--
-- WorkSession — сырые сессии (start/end), Month «YYYY-MM» денормализован
-- для агрегации. MonthlyPairTotal — материализованный помесячный счётчик
-- пары (unique driver+seller+month), monthCounted — месяц засчитан в
-- «опасную» серию. BlockedPair — активная блокировка пары (unique
-- driver+seller): создаётся кроном при 6 месяцах подряд, новые сессии
-- отклоняются 409. Снятие — вручную поддержкой (unblockAt — на будущее).
--
-- FK: users — RESTRICT (пара без участника не имеет смысла). Уникальные
-- ключи обеспечивают «один счётчик на пару-месяц» и «одна активная
-- блокировка на пару» (upsert-ы и проверки идут по ним).

-- CreateTable
CREATE TABLE "work_sessions" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "month" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_pair_totals" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "totalMinutes" INTEGER NOT NULL DEFAULT 0,
    "monthCounted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_pair_totals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_pairs" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "unblockAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_sessions_driverId_sellerId_month_idx" ON "work_sessions"("driverId", "sellerId", "month");
CREATE INDEX "work_sessions_month_idx" ON "work_sessions"("month");
CREATE UNIQUE INDEX "monthly_pair_totals_driverId_sellerId_month_key" ON "monthly_pair_totals"("driverId", "sellerId", "month");
CREATE INDEX "monthly_pair_totals_month_idx" ON "monthly_pair_totals"("month");
CREATE UNIQUE INDEX "blocked_pairs_driverId_sellerId_key" ON "blocked_pairs"("driverId", "sellerId");

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "monthly_pair_totals" ADD CONSTRAINT "monthly_pair_totals_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "monthly_pair_totals" ADD CONSTRAINT "monthly_pair_totals_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "blocked_pairs" ADD CONSTRAINT "blocked_pairs_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "blocked_pairs" ADD CONSTRAINT "blocked_pairs_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

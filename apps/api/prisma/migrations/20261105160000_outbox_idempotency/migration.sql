-- АгроМолл: миграция v0.3.0 «Офлайн-ядро» (подэтап B).
--
-- OutboxOperation — серверная сторона идемпотентности: клиент помечает
-- мутации заголовком X-Idempotency-Key (UUID), сервер сохраняет операцию
-- и её результат. Повторный запрос с тем же ключом получает сохранённый
-- ответ без повторного выполнения — «ровно один раз» между клиентом
-- и сервером. Обоснование — docs/adr/ADR-006.
--
-- create_debt и confirm_delivery пока не используются — enum расширен
-- сразу под будущее ядро долгов и попутной доставки.

-- CreateEnum
CREATE TYPE "OutboxOperationType" AS ENUM ('create_booking', 'cancel_booking', 'confirm_booking', 'counter_offer_booking', 'accept_counter_booking', 'create_debt', 'confirm_delivery');

-- CreateEnum
CREATE TYPE "OutboxState" AS ENUM ('received', 'processed', 'failed');

-- CreateTable
CREATE TABLE "outbox_operations" (
    "id" TEXT NOT NULL,
    "clientUuid" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operationType" "OutboxOperationType" NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "state" "OutboxState" NOT NULL DEFAULT 'received',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "outbox_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbox_operations_clientUuid_key" ON "outbox_operations"("clientUuid");

-- CreateIndex
CREATE INDEX "outbox_operations_userId_idx" ON "outbox_operations"("userId");

-- AddForeignKey
ALTER TABLE "outbox_operations" ADD CONSTRAINT "outbox_operations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

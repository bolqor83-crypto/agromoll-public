-- v0.7.0-C (ADR-037): переписка в апелляциях.
--
-- До этого апелляция была «reason + решение»: если арбитру нужно было
-- уточнить обстоятельства — только в голове. Теперь кейс — диалог
-- сторон пары и арбитра, как в спорах (DisputeMessage, ADR-033).
--
-- Таблица зеркалит dispute_messages: append-only (UPDATE/DELETE не
-- выдаём), isInternal — служебные заметки арбитра, скрытые от пары.

CREATE TABLE "appeal_messages" (
    "id" TEXT NOT NULL,
    "appealId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appeal_messages_pkey" PRIMARY KEY ("id")
);

-- Кейс удаляется (каскад) — переписка не переживает предмет разбирательства.
ALTER TABLE "appeal_messages"
    ADD CONSTRAINT "appeal_messages_appealId_fkey"
    FOREIGN KEY ("appealId") REFERENCES "appeal_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appeal_messages"
    ADD CONSTRAINT "appeal_messages_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "appeal_messages_appealId_createdAt_idx" ON "appeal_messages"("appealId", "createdAt");

-- Идемпотентность POST /appeals/:id/messages и тип уведомления о нём.
ALTER TYPE "OutboxOperationType" ADD VALUE 'appeal_message';
ALTER TYPE "NotificationType" ADD VALUE 'appeal_message';

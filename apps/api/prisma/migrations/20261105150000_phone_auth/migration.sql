-- АгроМолл: миграция v0.3.0 «Аутентификация по телефону» (подэтап A).
--
-- User получает phoneVerified (подтверждение номера SMS-кодом) и
-- passwordHash (опциональный запасной вход, в MVP не используется).
-- На phone вешается уникальный индекс: телефон — идентификатор входа.
-- NULL разрешён (несколько NULL не конфликтуют в Postgres) — на случай
-- старых строк; новые пользователи создаются только через
-- /auth/request-code, где телефон обязателен.
-- Обоснование — docs/adr/ADR-007.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "phoneVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- АгроМолл: миграция v0.3.1 «Отзыв refresh-токенов» (подэтап A).
--
-- Таблица sessions — аудит-запись «семьи» refresh-токенов (ADR-008):
-- одна строка на вход (POST /auth/verify). При каждом /auth/refresh
-- токен ротируется: currentJti заменяется новым, старый уходит в usedJtis.
-- Повторное использование старого jti — признак кражи: вся семья
-- отзывается (revokedAt). Решения об авторизации принимает Redis
-- (session-store.ts), эта таблица — журнал для аудита и поддержки.
--
-- Индексы: уникальные по familyId и currentJti (точечные чтения при
-- ротации и отзыве), обычный по userId (отзыв всех сессий при смене роли).
-- FK на users с каскадом: удаление пользователя очищает его сессии.

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "currentJti" TEXT NOT NULL,
    "usedJtis" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_familyId_key" ON "sessions"("familyId");
CREATE UNIQUE INDEX "sessions_currentJti_key" ON "sessions"("currentJti");
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");
CREATE INDEX "sessions_familyId_idx" ON "sessions"("familyId");
CREATE INDEX "sessions_currentJti_idx" ON "sessions"("currentJti");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

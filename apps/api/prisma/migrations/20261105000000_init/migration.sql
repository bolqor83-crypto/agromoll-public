-- АгроМолл: стартовая миграция (этап «фундамент»).
--
-- PostGIS ставим сразу: геозоны рынка и доставка попутчиками появятся
-- на следующих этапах, а расширение должно быть в миграции с первого дня,
-- чтобы любое окружение (локальное, CI, прод) поднималось одинаково.
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
-- RFC: тип enum должен полностью совпадать с USER_ROLES из @agromoll/types.
CREATE TYPE "UserRole" AS ENUM ('buyer', 'seller', 'driver');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'buyer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

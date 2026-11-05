/*
  Начальная миграция АгроМолл.

  Этап 1 (каркас): расширение PostGIS (задел под геозоны рынка и маршруты
  доставщиков — см. docs/adr/ADR-001-tech-stack.md) и таблица users с ролью.
  Бизнес-таблицы (заявки, брони, долги, доставки) — следующие этапы.
*/

-- Расширение PostGIS: безопасно выполняется повторно.
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('BUYER', 'SELLER', 'DRIVER');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'BUYER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

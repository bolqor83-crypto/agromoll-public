-- Push-уведомления (v0.6.0-A, ADR-031): токены устройств (FCM),
-- подписки Web Push (VAPID) и журнал доставок для аудита.
--
-- users.fcmToken удаляется: колонка была мёртвой с v0.4.0 — ни один
-- код её не записывал (push шёл по ней только при ручном занесении в БД).
-- Правильная модель — DeviceToken: много устройств на пользователя.
--
-- geo_points_geog_gist_idx НЕ трогаем: GIST-индекс PostGIS описан
-- только в миграции 20261108100000_geo_points (ADR-014), Prisma его
-- не видит и хочет удалить — это известная особенность, индекс остаётся.

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ios', 'android', 'web');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('fcm', 'web_push');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('sent', 'failed', 'delivered');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one enum value.
ALTER TYPE "NotificationType" ADD VALUE 'booking_counter_offered';
ALTER TYPE "NotificationType" ADD VALUE 'booking_confirmed';
ALTER TYPE "NotificationType" ADD VALUE 'booking_cancelled';
ALTER TYPE "NotificationType" ADD VALUE 'delivery_assigned';
ALTER TYPE "NotificationType" ADD VALUE 'delivery_started';
ALTER TYPE "NotificationType" ADD VALUE 'delivery_delivered';
ALTER TYPE "NotificationType" ADD VALUE 'delivery_cancelled';
ALTER TYPE "NotificationType" ADD VALUE 'reputation_score_dropped';

-- AlterTable
ALTER TABLE "users" DROP COLUMN "fcmToken";

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_userId_idx" ON "device_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_key" ON "web_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "web_push_subscriptions_userId_idx" ON "web_push_subscriptions"("userId");

-- CreateIndex
CREATE INDEX "notification_logs_userId_createdAt_idx" ON "notification_logs"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

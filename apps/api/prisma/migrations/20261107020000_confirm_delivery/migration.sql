-- АгроМолл: миграция v0.4.0 «Приёмка (confirm_delivery)» (подэтап C, ADR-012).
--
-- Закрытие жизненного цикла брони: покупатель получил товар и подтвердил —
-- бронь завершена. BookingStatus + completed (терминальный) и disputed
-- (спор по качеству); BookingAction + delivery_confirmed / delivery_disputed /
-- system_auto_confirmed (авто-подтверждение через 24 ч — защита от
-- «забыл подтвердить»). QualityFlag — оценка поставки: ok / minor_issue
-- (недостача — бронь всё равно завершается) / major_issue (спор).
--
-- confirmedAt — якорь авто-подтверждения: в v0.4.0 нет потока доставок
-- (delivered_at появится в v0.5.0), поэтому окно 24 ч отсчитывается от
-- подтверждения брони продавцом (ADR-012).
-- User.totalConfirmations/totalDisputes — репутационные счётчики-вид:
-- источник правды для рейтинга v0.5.0 — события, счётчики — быстрый view.

-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'completed';
ALTER TYPE "BookingStatus" ADD VALUE 'disputed';
ALTER TYPE "BookingAction" ADD VALUE 'delivery_confirmed';
ALTER TYPE "BookingAction" ADD VALUE 'delivery_disputed';
ALTER TYPE "BookingAction" ADD VALUE 'system_auto_confirmed';
ALTER TYPE "NotificationType" ADD VALUE 'booking_delivery_confirmed';
ALTER TYPE "NotificationType" ADD VALUE 'booking_delivery_disputed';

-- CreateEnum
CREATE TYPE "QualityFlag" AS ENUM ('ok', 'minor_issue', 'major_issue');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "confirmedAt" TIMESTAMP(3),
                       ADD COLUMN "deliveryConfirmedAt" TIMESTAMP(3),
                       ADD COLUMN "receivedQuantity" INTEGER,
                       ADD COLUMN "qualityNotes" TEXT,
                       ADD COLUMN "qualityFlag" "QualityFlag" NOT NULL DEFAULT 'ok';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "totalConfirmations" INTEGER NOT NULL DEFAULT 0,
                    ADD COLUMN "totalDisputes" INTEGER NOT NULL DEFAULT 0;

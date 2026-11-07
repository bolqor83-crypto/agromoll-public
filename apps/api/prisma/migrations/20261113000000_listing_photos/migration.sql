-- v0.7.0-D (ADR-038): реальные фото товаров.
--
-- До этого карточка лота обходилась иконкой-заглушкой по категории:
-- «Помидоры» и «Перец» выглядели одинаково, покупатель выбирал вслепую.
-- Теперь у лота до 5 фото; первое (position 0) — обложка в ленте.
--
-- fileUrl повторяет контракт доказательств споров (ADR-036):
--   s3://<objectKey>           — файл в хранилище (ключ listings/<listingId>/…);
--   data:<mime>;base64,<data>  — fallback ≤ 500 КБ, когда хранилище
--                                не настроено (dev/демо).
--
-- (listingId, position) — UNIQUE: обложка ищется по position 0 без
-- сортировки, дыр в нумерации не бывает (сервис пересобирает позиции
-- после удаления). Каскад: лот удалили — фото не остаются сиротами.

CREATE TABLE "listing_photos" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_photos_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "listing_photos"
    ADD CONSTRAINT "listing_photos_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "listing_photos_listingId_position_key" ON "listing_photos"("listingId", "position");

CREATE INDEX "listing_photos_listingId_idx" ON "listing_photos"("listingId");

-- Идемпотентность POST /listings/:id/photos (ADR-006/038): ретрай
-- загрузки не должен плодить дубликаты фото.
ALTER TYPE "OutboxOperationType" ADD VALUE 'listing_photo';

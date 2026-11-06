-- Геозоны (v0.5.0-B, ADR-014): точки покупателей, линии продавцов,
-- коридоры доставщиков. Пространственные запросы — PostGIS geography.

-- CreateEnum
CREATE TYPE "GeoPointKind" AS ENUM ('buyer_point', 'seller_line', 'delivery_corridor');

-- CreateEnum
CREATE TYPE "GeoVehicleType" AS ENUM ('car', 'van', 'refrigerated', 'flatbed');

-- CreateTable
CREATE TABLE "geo_points" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" "GeoPointKind" NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "geog" geography(Point,4326),
    "address" TEXT,
    "label" TEXT,
    "radiusMeters" INTEGER NOT NULL DEFAULT 50,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "corridorFrom" JSONB,
    "corridorTo" JSONB,
    "vehicleType" "GeoVehicleType" NOT NULL DEFAULT 'car',
    "maxWeightKg" INTEGER,
    "isRefrigerated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "geo_points_ownerId_kind_idx" ON "geo_points"("ownerId", "kind");

-- AddForeignKey
ALTER TABLE "geo_points" ADD CONSTRAINT "geo_points_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── PostGIS: GIST-индекс и синхронизация geography ← (lng, lat) ──────────
-- GIST на geography обслуживает ST_DWithin/ST_Distance по метрам без
-- пересчёта проекций (ADR-014). Prisma не описывает GIST-индексы —
-- индекс живёт только в миграции (CI-фильтр diff исключает его имя).
CREATE INDEX "geo_points_geog_gist_idx" ON "geo_points" USING GIST ("geog");

-- geography-колонку заполняет БД: приложение пишет только lat/lng,
-- триггер держит geog согласованном состоянии при INSERT и UPDATE.
CREATE OR REPLACE FUNCTION geo_points_sync_geog() RETURNS trigger AS $$
BEGIN
  NEW.geog := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER geo_points_geog_sync
  BEFORE INSERT OR UPDATE OF latitude, longitude ON "geo_points"
  FOR EACH ROW EXECUTE FUNCTION geo_points_sync_geog();
